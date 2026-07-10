'use client';

import { useSubscription, isChatCreditAtLimit } from '@/hooks/useSubscription';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useState, useEffect, FormEvent, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ChatMessage,
    CitationArtifact,
    MessageTrace,
    Reference,
} from '@/lib/schema';
import { useAuth } from '@/lib/auth';
import { useProjectWorkspace } from '@/components/project/ProjectWorkspaceProvider';
import { PaperItem } from "@/lib/schema";
import { toast } from "sonner";
import { ConversationView } from '@/components/ConversationView';
import {
    MentionSelection,
    EMPTY_MENTION_SELECTION,
    mentionSelectionIsEmpty,
    selectionToScopeItems,
} from '@/components/chat/MentionAutocomplete';

interface ChatRequestBody {
    user_query: string;
    conversation_id: string | null;
    project_id?: string;
    mentioned_paper_ids?: string[];
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
    // Shared workspace data + reader panel — papers open beside the chat.
    const {
        papers: projectPapers,
        isPapersLoading,
        conversations,
        openPaper,
        openPaperIds,
        refreshPaperUrl,
        setCrumb,
        collapseArtifacts,
    } = useProjectWorkspace();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isOwner, setIsOwner] = useState<boolean>(true);
    const [mentionSelection, setMentionSelection] = useState<MentionSelection>(EMPTY_MENTION_SELECTION);

    const papers = useMemo(
        () =>
            [...projectPapers].sort(
                (a: PaperItem, b: PaperItem) =>
                    new Date(b.created_at || "").getTime() -
                    new Date(a.created_at || "").getTime(),
            ),
        [projectPapers],
    );

    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(conversationIdFromUrl);
    const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
    const [streamingReferences, setStreamingReferences] = useState<Reference | undefined>(undefined);
    const [streamingArtifacts, setStreamingArtifacts] = useState<CitationArtifact[]>([]);
    const [currentLoadingMessageIndex, setCurrentLoadingMessageIndex] = useState(0);
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [highlightedInfo, setHighlightedInfo] = useState<{ paperId: string; messageIndex: number } | null>(null);
    const [isCentered, setIsCentered] = useState(false);
    const [isSessionLoading, setIsSessionLoading] = useState(true);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const END_DELIMITER = "END_OF_STREAM";

    const { subscription, refetch: refetchSubscription } = useSubscription();
    const chatCreditLimitReached = isChatCreditAtLimit(subscription);

    const conversationName = useMemo(
        () => conversations.find((c) => c.id === conversationIdFromUrl)?.title ?? '',
        [conversations, conversationIdFromUrl],
    );

    // Surface the conversation title in the workspace breadcrumb.
    useEffect(() => {
        setCrumb(conversationName || 'Chat');
        return () => setCrumb(null);
    }, [conversationName, setCrumb]);

    // Chat scope mirrors the reader tabs: papers open in the reader join the
    // @-mention scope; closing a tab removes them. Diffing against the previous
    // tab set preserves mentions the user typed by hand.
    const prevOpenPaperIdsRef = useRef<string[]>([]);
    useEffect(() => {
        const prev = prevOpenPaperIdsRef.current;
        const added = openPaperIds.filter((id) => !prev.includes(id));
        const removed = prev.filter((id) => !openPaperIds.includes(id));
        prevOpenPaperIdsRef.current = openPaperIds;
        if (added.length === 0 && removed.length === 0) return;
        setMentionSelection((sel) => ({
            ...sel,
            paperIds: [
                ...sel.paperIds.filter((id) => !removed.includes(id)),
                ...added.filter((id) => !sel.paperIds.includes(id)),
            ],
        }));
    }, [openPaperIds]);

    useEffect(() => {
        const CHAT_CREDIT_TOAST_KEY = "chat_credit_limit_toast_shown";
        if (chatCreditLimitReached && !sessionStorage.getItem(CHAT_CREDIT_TOAST_KEY)) {
            toast.error("Nice! You've used your chat credits for the week. Upgrade your plan to continue chatting.", {
                action: {
                    label: "Upgrade",
                    onClick: () => window.location.href = "/pricing",
                },
            });
            sessionStorage.setItem(CHAT_CREDIT_TOAST_KEY, "true");
        }
    }, [chatCreditLimitReached]);

    const handleCitationClick = useCallback((key: string, messageIndex: number) => {
        setHighlightedInfo((prevHighlight) => {
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
    }, [messages]);


    const fetchMessages = useCallback(async (id: string) => {
        try {
            const response = await fetchFromApi(`/api/projects/conversations/${projectId}/${id}`);
            if (response && response.messages) {
                setMessages(response.messages);
                setIsOwner(response.is_owner);
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
                // Apply any @-mention scope carried over from the project page.
                const pendingMentionsRaw = localStorage.getItem(`pending-mentions-${conversationIdFromUrl}`);
                // If mentions were carried over, wait for project papers to load so
                // their titles resolve — otherwise they persist as "Untitled paper".
                // Keep the localStorage keys until then; this effect re-runs when
                // isPapersLoading flips to false.
                if (pendingMentionsRaw && isPapersLoading) {
                    return;
                }
                setIsSessionLoading(false);
                localStorage.removeItem(`pending-query-${conversationIdFromUrl}`);
                localStorage.removeItem(`pending-mentions-${conversationIdFromUrl}`);
                let pendingMentions: MentionSelection | undefined;
                if (pendingMentionsRaw) {
                    try {
                        const paperIds = JSON.parse(pendingMentionsRaw);
                        if (Array.isArray(paperIds) && paperIds.length > 0) {
                            pendingMentions = { paperIds, projectIds: [], highlights: [] };
                        }
                    } catch {
                        // ignore malformed pending mentions
                    }
                }
                handleSubmit(null, pendingQuery, pendingMentions);
            } else if (messages.length === 0 && isSessionLoading && !isStreaming) {
                fetchMessages(conversationIdFromUrl);
            }
        } else if (!authLoading) {
            // Only clear messages if we're not loading auth and definitely have no user
            setMessages([]);
            setConversationId(null);
            setIsCentered(true);
            setIsSessionLoading(false);
        }
    }, [conversationIdFromUrl, user, fetchMessages, router, projectId, authLoading, isSessionLoading, isPapersLoading]);

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

    const handleSubmit = useCallback(async (e: FormEvent | null = null, message?: string, mentionsOverride?: MentionSelection) => {
        if (e) {
            e.preventDefault();
        }

        const query = message || currentMessage;

        if (!query.trim() || isStreaming || !conversationId) return;

        // Get the artifacts panel out of the way so the reply is front-and-center.
        collapseArtifacts();

        // Snapshot @-mention scope for this send, then clear it from the input.
        const submittedMentions = mentionsOverride ?? mentionSelection;
        const userMessage: ChatMessage = {
            role: 'user',
            content: query,
            scope: mentionSelectionIsEmpty(submittedMentions)
                ? undefined
                : selectionToScopeItems(submittedMentions, papers, []),
        };
        setMessages(prev => [...prev, userMessage]);
        // Reset to the reader-tab scope (not empty): papers open in the reader
        // stay in scope until their tabs close; hand-typed mentions are one-shot.
        setMentionSelection({ ...EMPTY_MENTION_SELECTION, paperIds: [...openPaperIds] });

        if (!message) {
            setCurrentMessage('');
        }

        setIsStreaming(true);
        setStreamingChunks([]);
        setStreamingReferences(undefined);
        setStreamingArtifacts([]);
        setError(null);

        const requestBody: ChatRequestBody = {
            user_query: query,
            conversation_id: conversationId,
            project_id: projectId,
        };
        if (submittedMentions.paperIds.length > 0) {
            requestBody.mentioned_paper_ids = submittedMentions.paperIds;
        }

        try {
            const stream = await fetchStreamFromApi('/api/message/chat/everything', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }).catch(fetchError => {
                console.error('Fetch error details:', {
                    name: fetchError.name,
                    message: fetchError.message,
                    stack: fetchError.stack,
                    cause: fetchError.cause
                });
                throw fetchError;
            });

            if (!stream) {
                throw new Error('No stream received from server');
            }

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = '';
            let references: Reference | undefined = undefined;
            const artifacts: CitationArtifact[] = [];
            let trace: MessageTrace | undefined = undefined;
            let buffer = '';

            try {
                while (true) {
                    let result;
                    try {
                        result = await reader.read();
                    } catch (readerError) {
                        console.error('Stream reader error:', {
                            name: readerError instanceof Error ? readerError.name : 'Unknown',
                            message: readerError instanceof Error ? readerError.message : String(readerError),
                            stack: readerError instanceof Error ? readerError.stack : 'No stack',
                        });
                        throw readerError;
                    }

                    const { done, value } = result;

                    if (done) {
                        if (buffer.trim()) {
                            console.warn('Unprocessed buffer at end of stream:', buffer);
                        }
                        break;
                    }

                    if (!value) {
                        console.warn('Received empty value from stream');
                        continue;
                    }

                    let chunk;
                    try {
                        chunk = decoder.decode(value, { stream: true });
                    } catch (decodeError) {
                        console.error('Error decoding chunk:', decodeError);
                        console.error('Raw chunk value:', value);
                        continue;
                    }

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
                                } else if (chunkType === 'artifact') {
                                    artifacts.push(chunkContent as CitationArtifact);
                                    setStreamingArtifacts(prev => [...prev, chunkContent as CitationArtifact]);
                                } else if (chunkType === 'trace') {
                                    trace = chunkContent as MessageTrace;
                                } else if (chunkType === 'status') {
                                    setStatusMessage(chunkContent);
                                } else if (chunkType === 'error') {
                                    console.error('Server error in stream:', chunkContent);
                                    throw new Error(`Server error: ${chunkContent}`);
                                } else {
                                    console.warn(`Unknown chunk type: ${chunkType}`, parsedChunk);
                                }
                            } else if (parsedChunk) {
                                console.warn('Received unexpected chunk format:', parsedChunk);
                            }
                        } catch (parseError) {
                            console.error('Error parsing JSON event:', parseError);
                            console.error('Raw event that failed to parse:', JSON.stringify(event));
                            console.error('Event length:', event.length);
                            console.error('Event preview (first 200 chars):', event.substring(0, 200));
                            continue;
                        }
                    }
                }
            } finally {
                // Always release the reader
                try {
                    reader.releaseLock();
                } catch (lockError) {
                    console.warn('Error releasing reader lock:', lockError);
                }
            }

            if (accumulatedContent) {
                const finalMessage: ChatMessage = {
                    role: 'assistant',
                    content: accumulatedContent,
                    references: references,
                    artifacts: artifacts.length ? artifacts : undefined,
                    trace: trace,
                };
                setMessages(prev => {
                    const newMessages = [...prev, finalMessage];
                    return newMessages;
                });

                // Clear streaming state immediately after adding final message
                setStreamingChunks([]);
                setStreamingReferences(undefined);
                setStreamingArtifacts([]);
            }

        } catch (error) {
            console.error('Error during streaming:', error);

            // Enhanced error logging
            if (error instanceof Error) {
                console.error('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    cause: error.cause
                });
            }

            // Check for specific error types
            if (error instanceof TypeError) {
                if (error.message.includes('input stream') || error.message.includes('stream')) {
                    console.error('Stream-specific TypeError detected');
                    toast.error("Connection interrupted. Please try again.");
                } else if (error.message.includes('fetch')) {
                    console.error('Fetch-related TypeError detected');
                    toast.error("Network error: Please check your connection and try again.");
                } else {
                    console.error('Generic TypeError detected');
                    toast.error(`Type error: ${error.message}`);
                }
            } else if (error instanceof Error && error.name === 'AbortError') {
                console.error('Request was aborted');
                toast.error("Request was cancelled. Please try again.");
            } else if (error instanceof Error && error.message.includes('Server error:')) {
                // Server-sent error, don't wrap it
                toast.error(error.message);
            } else {
                // Generic error handling
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                toast.error(`An error occurred: ${errorMessage}`);
            }

            setMessages(prev => prev.slice(0, -1));
            setCurrentMessage(query);
            setError(`Streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsStreaming(false);
            setStreamingChunks([]);
            setStreamingReferences(undefined);
            setStreamingArtifacts([]);
            setStatusMessage('');
            refetchSubscription();
        }
    }, [currentMessage, isStreaming, conversationId, projectId, router, refetchSubscription, mentionSelection, papers, openPaperIds, collapseArtifacts]);

    const [error, setError] = useState<string | null>(null);

    const handleRetry = useCallback(() => {
        setError(null);
        handleSubmit();
    }, [handleSubmit]);


    return (
        <div className="flex min-h-0 w-full flex-1 flex-col p-2">
            <div className="flex-1 min-h-0">
                <ConversationView
                    messages={messages}
                    isOwner={isOwner}
                    papers={papers}
                    isStreaming={isStreaming}
                    streamingChunks={streamingChunks}
                    streamingReferences={streamingReferences}
                    streamingArtifacts={streamingArtifacts}
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
                    onRefreshPaperUrl={refreshPaperUrl}
                    onOpenPaperExternal={openPaper}
                    mentionSelection={mentionSelection}
                    onMentionSelectionChange={setMentionSelection}
                    mentionPapersOnly
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
