
'use client';

import { useSubscription, isChatCreditAtLimit } from '@/hooks/useSubscription';
import { AnimatedMarkdown } from '@/components/AnimatedMarkdown';
import { Button } from '@/components/ui/button';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useState, useEffect, FormEvent, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// Reference to react-markdown documents: https://github.com/remarkjs/react-markdown?tab=readme-ov-file
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

import {
    Loader,
    ArrowUp,
    Recycle,
} from 'lucide-react';

import { Textarea } from '@/components/ui/textarea';
import { toast } from "sonner";
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import { ChatMessageActions } from '@/components/ChatMessageActions';

import {
    ChatMessage,
    Reference,
} from '@/lib/schema';
import { useAuth } from '@/lib/auth';
import { PaperItem } from "@/lib/schema";
import ReferencePaperCards from '@/components/ReferencePaperCards';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

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

function UnderstandPageContent() {
    const searchParams = useSearchParams();
    const { user, loading: authLoading } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [papers, setPapers] = useState<PaperItem[]>([]);


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

    const [isConversationLoading, setIsConversationLoading] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputMessageRef = useRef<HTMLTextAreaElement>(null);
    const chatInputFormRef = useRef<HTMLFormElement>(null);

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

    const handleCitationClick = useCallback((key: string, messageIndex: number) => {
        const message = messages[messageIndex];
        if (!message) return;

        const citation = message.references?.citations?.find(c => String(c.key) === key);
        if (!citation || !citation.paper_id) return;

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
        setIsConversationLoading(true);
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
            setIsConversationLoading(false);
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
        }
    }, [searchParams, user, fetchMessages, isStreaming]);

    useEffect(() => {
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all")
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setPapers(sortedPapers)
            } catch (error) {
                console.error("Error fetching papers:", error)
            }
        }

        fetchPapers();
    }, [])

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

    const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCurrentMessage(e.target.value);
    }, []);

    const memoizedMessages = useMemo(() => {
        return messages.map((msg, index) => (
            <div
                key={`${msg.id || `msg-${index}`}-${index}-${msg.role}-${msg.content.slice(0, 20).replace(/\s+/g, '')}`}
                className='flex flex-row gap-2 items-end'
            >
                <div
                    data-message-index={index}
                    className={`relative group prose dark:prose-invert !max-w-full ${msg.role === 'user'
                        ? 'text-lg w-fit animate-fade-in line-clamp-3 mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-600 px-2 py-2 rounded-xl border border-blue-100 dark:border-gray-600'
                        : 'w-full text-primary'
                        }`}
                >
                    <Markdown
                        remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                            p: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                                papers={papers}
                            />,
                            li: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                                papers={papers}
                            />,
                            div: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                                papers={papers}
                            />,
                            td: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                                papers={papers}
                            />,
                            table: (props) => (
                                <div className="overflow-x-auto">
                                    <table {...props} className="min-w-full border-collapse" />
                                </div>
                            ),
                        }}>{msg.content}</Markdown>
                    {msg.role === 'assistant' && (
                        <ChatMessageActions message={msg.content} references={msg.references} />
                    )}
                    {
                        msg.references && msg.references['citations']?.length > 0 && (
                            <div>
                                <div className="mt-0 pt-0 border-t border-gray-300 dark:border-gray-700" id="references-section">
                                        <h4 className="text-sm font-semibold mb-2">References</h4>
                                    </div>
                                <ReferencePaperCards citations={msg.references.citations} papers={papers} messageId={msg.id} messageIndex={index} />
                            </div>
                        )}
                </div>
            </div>
        ));
    }, [messages, user, handleCitationClick]);

    const [isCentered, setIsCentered] = useState(true);

    const handleNewSubmit = useCallback(async (e: FormEvent | null = null) => {
        if (e) {
            e.preventDefault();
        }
        if (isCentered) {
            setIsCentered(false);
        }
        await handleSubmit(e);
    }, [isCentered, handleSubmit]);

    return (
        <div className="flex flex-col w-full h-[calc(100vh-64px)]">
            <div className={`${isCentered ? 'flex-0' : 'flex-1'} w-full overflow-y-auto`} ref={messagesContainerRef}>
                <div className="mx-auto max-w-3xl space-y-4 p-4 w-full">
                    {papers.length === 0 && messages.length === 0 && !authLoading && (
                        <div className="text-center p-8">
                            <h2 className="text-xl font-semibold mb-2">No Papers Found</h2>
                            <p className="text-gray-600 dark:text-gray-400 mb-4">
                                You need to have at least one paper indexed to ask questions.
                            </p>
                            <Button onClick={() => window.location.href = '/'}>Index a Paper</Button>
                        </div>
                    )}
                    {isConversationLoading && (
                        <div className="space-y-4">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                        </div>
                    )}
                    {messages.length > 0 && memoizedMessages}
                    {
                        isStreaming && streamingChunks.length > 0 && (
                            <div className="relative group prose dark:prose-invert !max-w-full rounded-lg w-full text-primary dark:text-primary-foreground">
                                <AnimatedMarkdown
                                    className='!p-0'
                                    content={streamingChunks.join('')}
                                    remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
                                    rehypePlugins={[rehypeKatex]}
                                    components={{
                                        p: (props) => <CustomCitationLink
                                            {...props}
                                            handleCitationClick={handleCitationClick}
                                            messageIndex={messages.length}
                                            citations={streamingReferences?.citations || []}
                                        />,
                                        li: (props) => <CustomCitationLink
                                            {...props}
                                            handleCitationClick={handleCitationClick}
                                            messageIndex={messages.length}
                                            citations={streamingReferences?.citations || []}
                                        />,
                                        div: (props) => <CustomCitationLink
                                            {...props}
                                            handleCitationClick={handleCitationClick}
                                            messageIndex={messages.length}
                                            citations={streamingReferences?.citations || []}
                                        />,
                                        td: (props) => <CustomCitationLink
                                            {...props}
                                            handleCitationClick={handleCitationClick}
                                            messageIndex={messages.length}
                                            citations={streamingReferences?.citations || []}
                                        />,
                                        table: (props) => (
                                            <div className="w-full overflow-x-auto">
                                                <table {...props} className="min-w-full border-collapse" />
                                            </div>
                                        ),
                                    }}
                                />
                                <ChatMessageActions message={streamingChunks.join('')} references={streamingReferences} />
                            </div>
                        )
                    }
                    {
                        isStreaming && (
                            <div className="flex items-center gap-3 p-2">
                                <Loader className="animate-spin w-6 h-6 text-blue-500 flex-shrink-0" />
                                <div className="text-sm text-secondary-foreground">
                                    {displayedText}
                                    {isTyping && (
                                        <span className="animate-pulse">|</span>
                                    )}
                                    {statusMessage && <div className="text-xs text-gray-500">{statusMessage}</div>}
                                </div>
                            </div>
                        )
                    }
                    <div ref={messagesEndRef} />
                    {error && (
                        <div className="flex flex-col items-start gap-2 p-4 text-black dark:text-white">
                            <p>{error}</p>
                            <Button onClick={handleRetry} variant="outline">
                                <Recycle className="mr-2 h-4 w-4" />
                                Retry
                            </Button>
                        </div>
                    )}
                </div>
            </div>
            <div className={`p-4 transition-all duration-500 ${isCentered ? 'flex-1 flex flex-col justify-center items-center my-au' : ''}`}>
                {isCentered && (
                    <h1 className="text-2xl font-bold mb-4">What would you like to discover in your papers?</h1>
                )}
                <form onSubmit={handleNewSubmit} className="w-full" ref={chatInputFormRef}>
                    <div className="relative w-full md:max-w-3xl mx-auto">
                        <Textarea
                            value={currentMessage}
                            onChange={handleTextareaChange}
                            ref={inputMessageRef}
                            placeholder={isCentered ? "Discover something in your papers..." : "Ask a follow-up"}
                            className="pr-16 resize-none w-full"
                            disabled={isStreaming || papers.length === 0 || chatCreditLimitReached}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleNewSubmit(e);
                                }
                            }}
                        />
                        <Button
                            type="submit"
                            variant="ghost"
                            className="absolute top-1/2 right-2 -translate-y-1/2"
                            disabled={isStreaming || papers.length === 0 || chatCreditLimitReached}>
                            <ArrowUp className="h-5 w-5" />
                        </Button>
                    </div>
                    {chatCreditLimitReached && (
                        <div className="text-center text-sm text-secondary-foreground mt-2">
                            Nice! You have used your chat credits for the week. <Link href="/pricing" className='text-blue-500 hover:underline' >Upgrade your plan to use more.</Link>
                        </div>
                    )}
                </form>
            </div>
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
