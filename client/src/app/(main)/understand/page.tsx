
'use client';

import { useSubscription, isChatCreditAtLimit } from '@/hooks/useSubscription';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useState, useEffect, FormEvent, useRef, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePapers } from '@/hooks/usePapers';

import { toast } from "sonner";

import {
    ChatMessage,
    Reference,
} from '@/lib/schema';
import { useAuth } from '@/lib/auth';

interface ChatRequestBody {
    user_query: string;
    conversation_id: string | null;
}

const chatLoadingMessages = [
    "Thinking about your question...",
    "Analyzing your knowledge base...",
    "Gathering citations...",
    "Double-checking references...",
    "Formulating a response...",
    "Verifying information...",
    "Crafting insights...",
    "Synthesizing findings...",
]

import { ConversationView } from "@/components/ConversationView";

function UnderstandPageContent() {
    const searchParams = useSearchParams();
    const { user, loading: authLoading } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const { papers: fetchedPapers, error: papersError } = usePapers();

    const papers = useMemo(() => {
        if (!fetchedPapers) return [];
        return [...fetchedPapers].sort((a, b) => {
            return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
        });
    }, [fetchedPapers]);

    useEffect(() => {
        if (papersError) {
            console.error("Error fetching papers:", papersError);
            toast.error("Failed to fetch papers.");
        }
    }, [papersError]);


    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
    const [streamingReferences, setStreamingReferences] = useState<Reference | undefined>(undefined);
    const [currentLoadingMessageIndex, setCurrentLoadingMessageIndex] = useState(0);
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');

    const [isSessionLoading, setIsSessionLoading] = useState(true);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputMessageRef = useRef<HTMLTextAreaElement>(null);

    const END_DELIMITER = "END_OF_STREAM";

    const { subscription, refetch: refetchSubscription } = useSubscription();
    const chatCreditLimitReached = isChatCreditAtLimit(subscription);

    useEffect(() => {
        if (chatCreditLimitReached) {
            toast.info("Nice! You have used your chat credits for the week. Upgrade your plan to use more.", {
                action: {
                    label: "See plans",
                    onClick: () => window.location.href = "/pricing",
                },
            });
        }
    }, [chatCreditLimitReached]);

    const [highlightedInfo, setHighlightedInfo] = useState<{ paperId: string; messageIndex: number } | null>(null);

    const handleCitationClick = useCallback((key: string, messageIndex: number) => {
        const message = messages[messageIndex];
        if (!message) return;

        const citation = message.references?.citations?.find(c => String(c.key) === key);
        if (!citation || !citation.paper_id) return;

        setHighlightedInfo({ paperId: citation.paper_id, messageIndex });

        const elementId = message.id ? `${message.id}-reference-paper-card-${citation.paper_id}` : `${messageIndex}-reference-paper-card-${citation.paper_id}`;
        const element = document.getElementById(elementId);

        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [messages]);

    useEffect(() => {
        if (!authLoading && !user) {
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

    const fetchMessages = useCallback(async (id: string) => {
        try {
            const response = await fetchFromApi(`/api/conversation/${id}`);
            if (response && response.messages) {
                setMessages(response.messages);
                setConversationId(id);
                setIsCentered(false);
            }
        } catch (error) {
            console.error("Error fetching messages:", error);
            toast.error("Failed to load conversation history.");
        } finally {
            setIsSessionLoading(false); // New line
        }
    }, []);

    // We don't want to refetch the conversation history or reset the chat state
    // while an answer is being streamed, as this can cause jarring UI updates
    // (e.g., showing the loading skeleton unnecessarily).
    useEffect(() => {
        const id = searchParams.get('id');
        if (id && user && !isStreaming) {
            fetchMessages(id);
        } else if (!id && !isStreaming) {
            setMessages([]);
            setConversationId(null);
            setIsCentered(true);
            setIsSessionLoading(false);
        }
    }, [searchParams, user, fetchMessages, isStreaming]);

    useEffect(() => {
        if (isStreaming) {
            setTimeout(() => {
                scrollToBottom();
            }, 100);
        }
    }, [isStreaming]);

    useEffect(() => {
        if (!isStreaming) {
            setDisplayedText('');
            setIsTyping(false);
            return;
        }

        const currentMessage = chatLoadingMessages[currentLoadingMessageIndex];
        let charIndex = 0;
        setDisplayedText('');
        setIsTyping(true);

        const typingInterval = setInterval(() => {
            if (charIndex < currentMessage.length) {
                setDisplayedText(currentMessage.slice(0, charIndex + 1));
                charIndex++;
            } else {
                setIsTyping(false);
                clearInterval(typingInterval);
            }
        }, 50);

        return () => clearInterval(typingInterval);
    }, [isStreaming, currentLoadingMessageIndex]);

    useEffect(() => {
        if (!isStreaming) return;

        const messageInterval = setInterval(() => {
            setCurrentLoadingMessageIndex((prev) =>
                (prev + 1) % chatLoadingMessages.length
            );
        }, 11000);

        return () => clearInterval(messageInterval);
    }, [isStreaming]);

    useEffect(() => {
        if (isStreaming) {
            setCurrentLoadingMessageIndex(0);
        }
    }, [isStreaming]);

    const scrollToBottom = () => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        } else if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    };

    const handleSubmit = useCallback(async (e: FormEvent | null = null) => {
        if (e) {
            e.preventDefault();
        }

        if (!currentMessage.trim() || isStreaming) return;

        const userMessage: ChatMessage = { role: 'user', content: currentMessage };
        setMessages(prev => [...prev, userMessage]);
        setCurrentMessage('');

        setIsStreaming(true);
        setStreamingChunks([]);
        setStreamingReferences(undefined);
        setError(null);

        let currentConversationId = conversationId;

        if (!currentConversationId) {
            try {
                const newConversationResponse = await fetchFromApi('/api/conversation/everything', {
                    method: 'POST',
                });
                currentConversationId = newConversationResponse.id;
                setConversationId(currentConversationId);
                window.history.pushState(null, '', `/understand?id=${currentConversationId}`);
            } catch (error) {
                console.error('Error creating conversation:', error);
                toast.error("Failed to start a new conversation.");
                setMessages(prev => prev.slice(0, -1));
                setCurrentMessage(userMessage.content);
                setIsStreaming(false);
                setError('Failed to start a new conversation.');
                return;
            }
        }

        const requestBody: ChatRequestBody = {
            user_query: userMessage.content,
            conversation_id: currentConversationId,
        };

        try {
            const stream = await fetchStreamFromApi('/api/message/chat/everything', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = '';
            let references: Reference | undefined = undefined;
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    if (buffer.trim()) {
                        console.warn('Unprocessed buffer at end of stream:', buffer);
                    }
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const parts = buffer.split(END_DELIMITER);
                buffer = parts.pop() || '';

                for (const event of parts) {
                    if (!event.trim()) continue;

                    try {
                        const parsedChunk = JSON.parse(event.trim());

                        if (parsedChunk && typeof parsedChunk === 'object' && 'type' in parsedChunk) {
                            const chunkType = parsedChunk.type;
                            const chunkContent = parsedChunk.content;

                            if (chunkType === 'content') {
                                accumulatedContent += chunkContent;
                                setStreamingChunks(prev => [...prev, chunkContent]);
                            } else if (chunkType === 'references') {
                                references = chunkContent;
                                setStreamingReferences(chunkContent);
                            } else if (chunkType === 'status') {
                                setStatusMessage(chunkContent);
                            } else if (chunkType === 'error') {
                                console.error('Server error in stream:', chunkContent);
                                throw new Error(`Server error: ${chunkContent}`);
                            } else {
                                console.warn(`Unknown chunk type: ${chunkType}`);
                            }
                        } else if (parsedChunk) {
                            console.warn('Received unexpected chunk:', parsedChunk);
                        }
                    } catch (error) {
                        if (error instanceof Error) {
                            throw error;
                        }
                        console.error('Error processing event:', error, 'Raw event:', event);
                        continue;
                    }
                }
            }

            if (accumulatedContent) {
                const finalMessage: ChatMessage = {
                    role: 'assistant',
                    content: accumulatedContent,
                    references: references,
                };
                setMessages(prev => [...prev, finalMessage]);
            }

        } catch (error) {
            console.error('Error during streaming:', error);
            toast.error("An error occurred while processing your request.");
            setMessages(prev => prev.slice(0, -1));
            setCurrentMessage(userMessage.content);
            setError('An error occurred while processing your request.');
        } finally {
            setIsStreaming(false);
            setStatusMessage('');
            refetchSubscription();
        }
    }, [currentMessage, isStreaming, conversationId]);

    const [error, setError] = useState<string | null>(null);

    const handleRetry = useCallback(() => {
        setError(null);
        handleSubmit();
    }, [handleSubmit]);

    useEffect(() => {
        const focusInput = () => {
            if (inputMessageRef.current &&
                !isStreaming &&
                papers.length > 0 &&
                !chatCreditLimitReached) {
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    inputMessageRef.current?.focus();
                }, 100);
            }
        };

        focusInput();
    }, [papers.length, isStreaming, chatCreditLimitReached]); // Dependencies that affect focusability

    const [isCentered, setIsCentered] = useState(true);

    return (
        <div className="h-[calc(100vh-64px)] mx-2">
            <ConversationView
                messages={messages}
                isOwner={true}
                papers={papers}
                isStreaming={isStreaming}
                streamingChunks={streamingChunks}
                streamingReferences={streamingReferences}
                statusMessage={statusMessage}
                error={error}
                isSessionLoading={isSessionLoading}
                chatCreditLimitReached={chatCreditLimitReached}
                currentMessage={currentMessage}
                onCurrentMessageChange={setCurrentMessage}
                onSubmit={handleSubmit}
                onRetry={handleRetry}
                isCentered={isCentered}
                setIsCentered={setIsCentered}
                displayedText={displayedText}
                isTyping={isTyping}
                handleCitationClick={handleCitationClick}
                highlightedInfo={highlightedInfo}
                setHighlightedInfo={setHighlightedInfo}
                authLoading={authLoading}
            />
        </div>
    );
}

export default function UnderstandPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <UnderstandPageContent />
        </Suspense>
    );
}
