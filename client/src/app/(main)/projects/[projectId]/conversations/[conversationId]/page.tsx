'use client';

import { useSubscription, isChatCreditAtLimit } from '@/hooks/useSubscription';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useState, useEffect, FormEvent, useRef, useCallback, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
    ChatMessage,
    Conversation,
    Reference,
} from '@/lib/schema';
import { useAuth } from '@/lib/auth';
import { PaperItem } from "@/lib/schema";
import { toast } from "sonner";
import { ConversationView } from '@/components/ConversationView';

interface ChatRequestBody {
    user_query: string;
    conversation_id: string | null;
    project_id?: string;
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

function ProjectConversationPageContent() {
    const router = useRouter();
    const params = useParams();
    const projectId = params.projectId as string;
    const conversationIdFromUrl = params.conversationId as string;

    const { user, loading: authLoading } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [papers, setPapers] = useState<PaperItem[]>([]);

    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(conversationIdFromUrl);
    const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
    const [streamingReferences, setStreamingReferences] = useState<Reference | undefined>(undefined);
    const [currentLoadingMessageIndex, setCurrentLoadingMessageIndex] = useState(0);
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [highlightedInfo, setHighlightedInfo] = useState<{ paperId: string; messageIndex: number } | null>(null);

    const [isSessionLoading, setIsSessionLoading] = useState(true);
    const [projectName, setProjectName] = useState<string>('');
    const [conversationName, setConversationName] = useState<string>('');

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const END_DELIMITER = "END_OF_STREAM";

    const { subscription, refetch: refetchSubscription } = useSubscription();
    const chatCreditLimitReached = isChatCreditAtLimit(subscription);

    useEffect(() => {
        if (projectId) {
            fetchFromApi(`/api/projects/${projectId}`)
                .then(data => {
                    setProjectName(data.title);
                })
                .catch(err => console.error("Failed to fetch project name", err));

            fetchFromApi(`/api/projects/conversations/${projectId}`)
                .then(data => {
                    const conversation: Conversation = data.find((c: Conversation) => c.id === conversationIdFromUrl);
                    if (conversation) {
                        setConversationName(conversation.title);
                    }
                })
                .catch(err => console.error("Failed to fetch conversation name", err));
        }
    }, [projectId, conversationIdFromUrl]);

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

    const handleCitationClick = useCallback((key: string, messageIndex: number) => {
        // Use a function to get the latest messages instead of relying on the closure
        setHighlightedInfo((prevHighlight) => {
            // Get the current messages from the component's props
            const message = messages[messageIndex];
            if (!message) return prevHighlight;

            const citation = message.references?.citations?.find(c => String(c.key) === key);
            if (!citation || !citation.paper_id) return prevHighlight;

            const newHighlight = { paperId: citation.paper_id, messageIndex };

            // Scroll to element
            setTimeout(() => {
                const elementId = message.id ? `${message.id}-reference-paper-card-${citation.paper_id}` : `${messageIndex}-reference-paper-card-${citation.paper_id}`;
                const element = document.getElementById(elementId);

                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 0);

            return newHighlight;
        });
    }, []);

    useEffect(() => {
        if (!authLoading && !user) {
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

    const fetchMessages = useCallback(async (id: string) => {
        try {
            const response = await fetchFromApi(`/api/projects/conversations/${projectId}/${id}`);
            if (response && response.messages) {
                setMessages(response.messages);
                setConversationId(id);
                setIsCentered(false);
            }
        } catch (error) {
            console.error("Error fetching messages:", error);
            // Go back to the project page
            router.push(`/projects/${projectId}`);
            toast.error("Failed to load conversation history.");
        } finally {
            setIsSessionLoading(false);
        }
    }, [projectId, router]);

    useEffect(() => {
        if (!conversationIdFromUrl) {
            router.push(`/projects/${projectId}`);
            return;
        }

        if (user) {
            const pendingQuery = localStorage.getItem(`pending-query-${conversationIdFromUrl}`);
            if (pendingQuery) {
                localStorage.removeItem(`pending-query-${conversationIdFromUrl}`);
                const userMessage: ChatMessage = { role: 'user', content: pendingQuery };
                setMessages([userMessage]);
                handleSubmit(null, pendingQuery);
                setIsSessionLoading(false);
            } else if (!isStreaming && messages.length === 0) {
                fetchMessages(conversationIdFromUrl);
            }

        } else {
            setMessages([]);
            setConversationId(null);
            setIsCentered(true);
            setIsSessionLoading(false);
        }
    }, [conversationIdFromUrl, user, fetchMessages, router, projectId]);

    useEffect(() => {
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi(`/api/projects/papers/${projectId}`)
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setPapers(sortedPapers)
            } catch (error) {
                console.error("Error fetching papers:", error)
            }
        }

        if (projectId) {
            fetchPapers();
        }
    }, [projectId])

    useEffect(() => {
        if (isStreaming) {
            setTimeout(() => {
                if (messagesEndRef.current) {
                    messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
                }
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

    const handleSubmit = useCallback(async (e: FormEvent | null = null, message?: string) => {
        if (e) {
            e.preventDefault();
        }

        const query = message || currentMessage;

        if (!query.trim() || isStreaming || !conversationId) return;

        if (!message) {
            const userMessage: ChatMessage = { role: 'user', content: query };
            // Use functional update to ensure we get the latest state
            setMessages(prev => {
                const newMessages = [...prev, userMessage];
                return newMessages;
            });
            setCurrentMessage('');
        }

        setIsStreaming(true);
        setStreamingChunks([]);
        setStreamingReferences(undefined);
        setError(null);

        const requestBody: ChatRequestBody = {
            user_query: query,
            conversation_id: conversationId,
            project_id: projectId,
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
                            } else {
                                console.warn(`Unknown chunk type: ${chunkType}`);
                            }
                        } else if (parsedChunk) {
                            console.warn('Received unexpected chunk:', parsedChunk);
                        }
                    } catch (error) {
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
                setMessages(prev => {
                    const newMessages = [...prev, finalMessage];
                    return newMessages;
                });
            }

        } catch (error) {
            console.error('Error during streaming:', error);
            toast.error("An error occurred while processing your request.");
            setMessages(prev => prev.slice(0, -1));
            setCurrentMessage(query);
            setError('An error occurred while processing your request.');
        } finally {
            setIsStreaming(false);
            setStatusMessage('');
            refetchSubscription();
        }
    }, [currentMessage, isStreaming, conversationId, projectId, router, refetchSubscription]);

    const [error, setError] = useState<string | null>(null);

    const handleRetry = useCallback(() => {
        setError(null);
        handleSubmit();
    }, [handleSubmit]);

    const [isCentered, setIsCentered] = useState(false);

    return (
        <div className="mx-none w-full p-4 flex flex-col h-[calc(100vh-64px)]">
            <Breadcrumb>
                <BreadcrumbList>
                    <BreadcrumbItem>
                        <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbLink href={`/projects/${projectId}`}>{projectName}</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbPage>{conversationName}</BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>
            <div className="flex-1 min-h-0 pt-4">
                <ConversationView
                    messages={messages}
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
        </div>
    );
}

export default function ProjectConversationPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ProjectConversationPageContent />
        </Suspense>
    );
}
