
'use client';

import { AnimatedMarkdown } from '@/components/AnimatedMarkdown';
import { Button } from '@/components/ui/button';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useState, useEffect, FormEvent, useRef, useCallback, useMemo } from 'react';

// Reference to react-markdown documents: https://github.com/remarkjs/react-markdown?tab=readme-ov-file
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

import {
    Loader,
    ArrowUp,
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
import { PaperItem } from '@/components/AppSidebar';
import ReferencePaperCards from '@/components/ReferencePaperCards';

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

export default function UnderstandPage() {
    const { user, loading: authLoading } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [papers, setPapers] = useState<PaperItem[]>([]);


    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
    const [activeCitationMessageIndex, setActiveCitationMessageIndex] = useState<number | null>(null);
    const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
    const [streamingReferences, setStreamingReferences] = useState<Reference | undefined>(undefined);
    const [currentLoadingMessageIndex, setCurrentLoadingMessageIndex] = useState(0);
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputMessageRef = useRef<HTMLTextAreaElement>(null);
    const chatInputFormRef = useRef<HTMLFormElement>(null);

    const END_DELIMITER = "END_OF_STREAM";

    const handleCitationClick = useCallback((key: string, messageIndex: number) => {
        setActiveCitationKey(key);
        setActiveCitationMessageIndex(messageIndex);

        const element = document.getElementById(`citation-${key}-${messageIndex}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }

        setTimeout(() => setActiveCitationKey(null), 3000);
    }, []);

    useEffect(() => {
        if (!authLoading && !user) {
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

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

        let currentConversationId = conversationId;

        if (!currentConversationId) {
            try {
                const newConversationResponse = await fetchFromApi('/api/conversation/everything', {
                    method: 'POST',
                });
                currentConversationId = newConversationResponse.id;
                setConversationId(currentConversationId);
            } catch (error) {
                console.error('Error creating conversation:', error);
                toast.error("Failed to start a new conversation.");
                setIsStreaming(false);
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
        } finally {
            setIsStreaming(false);
            setStatusMessage('');
        }
    }, [currentMessage, isStreaming, conversationId]);

    const matchesCurrentCitation = useCallback((key: string, messageIndex: number) => {
        return activeCitationKey === key.toString() && activeCitationMessageIndex === messageIndex;
    }, [activeCitationKey, activeCitationMessageIndex]);

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
                    className={`relative group prose dark:prose-invert p-2 !max-w-full rounded-lg ${msg.role === 'user'
                        ? 'text-blue-800 dark:text-blue-200 text-lg w-fit animate-fade-in line-clamp-3'
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
                                <ReferencePaperCards citations={msg.references.citations} papers={papers} />
                            </div>
                        )}
                </div>
            </div>
        ));
    }, [messages, user, handleCitationClick, matchesCurrentCitation]);

    return (
        <div className="flex flex-col w-full h-[calc(100vh-64px)] max-w-3xl mx-auto">
            <div
                className="flex-1 overflow-y-auto space-y-4 p-4"
                ref={messagesContainerRef}
            >
                {messages.length === 0 ? (
                    <div className="text-center text-gray-500 my-4">
                        Ask anything about your entire knowledge base.
                    </div>
                ) : (
                    memoizedMessages
                )}
                {
                    isStreaming && streamingChunks.length > 0 && (
                        <div className="relative group prose dark:prose-invert p-2 !max-w-full rounded-lg w-full text-primary dark:text-primary-foreground">
                            <AnimatedMarkdown
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
            </div>
            <form onSubmit={handleSubmit} className="p-4 border-t" ref={chatInputFormRef}>
                <div className="relative">
                    <Textarea
                        value={currentMessage}
                        onChange={handleTextareaChange}
                        ref={inputMessageRef}
                        placeholder="Ask something..."
                        className="pr-16 resize-none"
                        disabled={isStreaming}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                    />
                    <Button
                        type="submit"
                        variant="ghost"
                        className="absolute top-1/2 right-2 -translate-y-1/2"
                        disabled={isStreaming}
                    >
                        <ArrowUp className="h-5 w-5" />
                    </Button>
                </div>
            </form>
        </div>
    );
}
