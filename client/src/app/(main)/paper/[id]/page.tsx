'use client';

import { PdfViewer } from '@/components/PdfViewer';
import { Button } from '@/components/ui/button';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import { useState, useEffect, FormEvent, useRef, useCallback, useMemo } from 'react';
import { useSubscription, nextMonday, getChatCreditUsagePercentage, isChatCreditAtLimit, isChatCreditNearLimit } from '@/hooks/useSubscription';

// Reference to react-markdown documents: https://github.com/remarkjs/react-markdown?tab=readme-ov-file
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

import {
    Highlighter,
    NotebookText,
    MessageCircle,
    Focus,
    Loader2,
    Lightbulb,
    Share,
    AudioLines,
    User,
} from 'lucide-react';
import { toast } from "sonner";

import { useHighlights } from '@/components/hooks/PdfHighlight';
import { useAnnotations } from '@/components/hooks/PdfAnnotation';
import { ChatMessageActions } from '@/components/ChatMessageActions';

import {
    ChatMessage,
    PaperData,
    PaperNoteData,
    PaperHighlight,
    Reference,
    ResponseStyle,
    JobStatusResponse,
    CreditUsage,
} from '@/lib/schema';

import { PaperStatus, PaperStatusEnum } from '@/components/utils/PdfStatus';
import { useAuth } from '@/lib/auth';
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import { PaperSidebar } from '@/components/PaperSidebar';
import EnigmaticLoadingExperience from '@/components/EnigmaticLoadingExperience';
import PaperViewSkeleton from '@/components/PaperViewSkeleton';
import { Avatar } from "@/components/ui/avatar";
import { useIsMobile } from '@/hooks/use-mobile';
import { Book, Box } from 'lucide-react';
import { SidePanelContent } from '@/components/SidePanelContent';

interface ChatRequestBody {
    user_query: string;
    conversation_id: string | null;
    paper_id: string;
    user_references: string[];
    style?: ResponseStyle;
    llm_provider?: string;
}

const PaperToolset = {
    nav: [
        { name: "Overview", icon: Lightbulb },
        { name: "Chat", icon: MessageCircle },
        { name: "Notes", icon: NotebookText },
        { name: "Annotations", icon: Highlighter },
        { name: "Share", icon: Share },
        { name: "Audio", icon: AudioLines },
        // { name: "Figures", icon: ChartBar },
        { name: "Focus", icon: Focus },
    ],
}

const chatLoadingMessages = [
    "Thinking about your question...",
    "Analyzing the paper...",
    "Gathering citations...",
    "Double-checking references...",
    "Formulating a response...",
    "Verifying information...",
    "Crafting insights...",
    "Synthesizing findings...",
]

export default function PaperView() {
    const params = useParams();
    const id = params.id as string;
    const { user, loading: authLoading } = useAuth();
    const { subscription, refetch: refetchSubscription } = useSubscription();
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [loading, setLoading] = useState(true);
    const [paperNoteData, setPaperNoteData] = useState<PaperNoteData | null>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const {
        highlights,
        setHighlights,
        selectedText,
        setSelectedText,
        tooltipPosition,
        setTooltipPosition,
        isAnnotating,
        setIsAnnotating,
        isHighlightInteraction,
        setIsHighlightInteraction,
        activeHighlight,
        setActiveHighlight,
        handleTextSelection,
        addHighlight,
        removeHighlight,
        fetchHighlights
    } = useHighlights(id);

    const {
        annotations,
        addAnnotation,
        removeAnnotation,
        updateAnnotation,
        renderAnnotations,
        refreshAnnotations,
    } = useAnnotations(id);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [currentMessage, setCurrentMessage] = useState('');
    const [responseStyle, setResponseStyle] = useState<ResponseStyle | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
    const [activeCitationMessageIndex, setActiveCitationMessageIndex] = useState<number | null>(null);
    const [pageNumberConversationHistory, setPageNumberConversationHistory] = useState<number>(1);
    const [explicitSearchTerm, setExplicitSearchTerm] = useState<string | undefined>(undefined);
    const [paperNoteContent, setPaperNoteContent] = useState<string | undefined>(undefined);
    const [lastPaperNoteSaveTime, setLastPaperNoteSaveTime] = useState<number | null>(null);
    const [userMessageReferences, setUserMessageReferences] = useState<string[]>([]);
    const [addedContentForPaperNote, setAddedContentForPaperNote] = useState<string | null>(null);
    const [isMarkdownPreview, setIsMarkdownPreview] = useState(false);
    const [pendingStarterQuestion, setPendingStarterQuestion] = useState<string | null>(null);
    const [isSharing, setIsSharing] = useState(false);
    const [availableModels, setAvailableModels] = useState<Record<string, string>>({});
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
    const [streamingReferences, setStreamingReferences] = useState<Reference | undefined>(undefined);
    const [currentLoadingMessageIndex, setCurrentLoadingMessageIndex] = useState(0);
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    const [jobId, setJobId] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [sidePanelDisplayedText, setSidePanelDisplayedText] = useState('');
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        if (jobId) {
            const timer = setInterval(() => {
                setElapsedTime(prevTime => prevTime + 1);
            }, 1000);
            return () => clearInterval(timer);
        } else {
            setElapsedTime(0); // Reset timer when job is done
        }
    }, [jobId]);

    useEffect(() => {
        if (!jobId) {
            setSidePanelDisplayedText('');
            return;
        }
        if (!loadingMessage) {
            setSidePanelDisplayedText('Processing your paper...');
            return;
        }

        let charIndex = 0;
        setSidePanelDisplayedText('');

        const typingInterval = setInterval(() => {
            if (charIndex < loadingMessage.length) {
                setSidePanelDisplayedText(loadingMessage.slice(0, charIndex + 1));
                charIndex++;
            } else {
                clearInterval(typingInterval);
            }
        }, 50); // 50ms per character for smooth typing

        return () => clearInterval(typingInterval);
    }, [loadingMessage, jobId]);

    useEffect(() => {
        const url = new URL(window.location.href);
        const jobIdFromUrl = url.searchParams.get('job_id');
        if (jobIdFromUrl) {
            setJobId(jobIdFromUrl);
            pollJobStatus(jobIdFromUrl);
        }
    }, []);

    const pollJobStatus = async (jobId: string) => {
        try {
            const response: JobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${jobId}`);
            setLoadingMessage(response.celery_progress_message);

            if (response.status === 'completed') {
                setJobId(null);
            } else if (response.status === 'failed') {
                setJobId(null);
                // Handle failed job
                console.error('Upload job failed');
            } else {
                setTimeout(() => pollJobStatus(jobId), 2000);
            }
        } catch (error) {
            console.error('Error polling job status:', error);
        }
    };

    // Chat credit usage state
    const [creditUsage, setCreditUsage] = useState<CreditUsage | null>(null);

    const [rightSideFunction, setRightSideFunction] = useState<string>('Overview');
    const [leftPanelWidth, setLeftPanelWidth] = useState(60); // percentage
    const [isDragging, setIsDragging] = useState(false);
    const isMobile = useIsMobile();
    const [mobileView, setMobileView] = useState<'reader' | 'panel'>('reader');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    // Reference to track the save timeout
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const inputMessageRef = useRef<HTMLTextAreaElement>(null);
    const chatInputFormRef = useRef<HTMLFormElement>(null);

    const END_DELIMITER = "END_OF_STREAM";

    // Add this function to handle citation clicks
    const handleCitationClick = useCallback((key: string, messageIndex: number) => {
        setActiveCitationKey(key);
        setActiveCitationMessageIndex(messageIndex);

        // Scroll to the citation
        const element = document.getElementById(`citation-${key}-${messageIndex}`);
        if (element) {

            const refValueElement = document.getElementById(`citation-ref-${key}-${messageIndex}`);
            if (refValueElement) {
                const refValueText = refValueElement.innerText;
                const refValue = refValueText.replace(/^\[\^(\d+|[a-zA-Z]+)\]/, '').trim();

                // since the first and last terms are quotes, remove them
                const searchTerm = refValue.substring(1, refValue.length - 1);
                setExplicitSearchTerm(searchTerm);
            }
            // Disable scroll in chat window - might be too jittery when in flow of reading a chat message.
            // element.scrollIntoView({ behavior: 'smooth' });
        }

        // Clear the highlight after a few seconds
        setTimeout(() => setActiveCitationKey(null), 3000);
    }, []);

    const handleCitationClickFromSummary = useCallback((citationKey: string, messageIndex: number) => {
        const citationIndex = parseInt(citationKey);
        setActiveCitationKey(citationKey);
        setActiveCitationMessageIndex(messageIndex);

        // Look up the citations terms from the citationKey
        const citationMatch = paperData?.summary_citations?.find(c => c.index === citationIndex);
        setExplicitSearchTerm(citationMatch ? citationMatch.text : citationKey);

        // Clear the highlight after a few seconds
        setTimeout(() => setActiveCitationKey(null), 3000);
    }, [paperData?.summary_citations]);

    const handleHighlightClick = useCallback((highlight: PaperHighlight) => {
        setActiveHighlight(highlight);
    }, []);

    useEffect(() => {
        if (userMessageReferences.length == 0) return;
        setRightSideFunction('Chat');
    }, [userMessageReferences]);

    useEffect(() => {
        if (isAnnotating) {
            setRightSideFunction('Annotations');
        }
    }, [isAnnotating]);

    useEffect(() => {
        if (!authLoading && !user) {
            // Redirect to login if user is not authenticated
            window.location.href = `/login`;
        }
    }, [authLoading, user]);


    useEffect(() => {
        if (rightSideFunction === 'Chat') {
            inputMessageRef.current?.focus();
        }
    }, [rightSideFunction]);

    useEffect(() => {
        if (activeHighlight) {
            // Only open the associated annotation view if the highlight is from the assistant to reduce some user confusion?
            if (activeHighlight.role === 'assistant') {
                setRightSideFunction('Annotations');
            }
        }
    }, [activeHighlight]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            const containerWidth = window.innerWidth;
            const newLeftWidth = (e.clientX / containerWidth) * 100;

            // Constrain between 30% and 80%
            const constrainedWidth = Math.min(Math.max(newLeftWidth, 30), 80);
            setLeftPanelWidth(constrainedWidth);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };

        if (isDragging) {
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    useEffect(() => {
        // Add keybinding to toggle markdown preview
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
                setIsMarkdownPreview(prev => !prev);
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // Clear the paper note timeout on component unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Check for unsaved notes in local storage on load
    useEffect(() => {
        if (id) {
            try {
                const savedNote = localStorage.getItem(`paper-note-${id}`);
                if (savedNote && (!paperNoteContent || savedNote !== paperNoteContent)) {
                    setPaperNoteContent(savedNote);
                }
            } catch (error) {
                console.error('Error retrieving from local storage:', error);
            }
        }
    }, [id]);

    useEffect(() => {
        // When streaming starts, scroll to show the latest message at the top
        if (isStreaming) {
            setTimeout(() => {
                scrollToLatestMessage();
            }, 100);
        }
    }, [isStreaming]);

    // Handle typing effect for loading messages
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
        }, 50); // 50ms per character for smooth typing

        return () => clearInterval(typingInterval);
    }, [isStreaming, currentLoadingMessageIndex]);

    // Cycle through loading messages every 11 seconds
    useEffect(() => {
        if (!isStreaming) return;

        const messageInterval = setInterval(() => {
            setCurrentLoadingMessageIndex((prev) =>
                (prev + 1) % chatLoadingMessages.length
            );
        }, 11000); // 11 seconds

        return () => clearInterval(messageInterval);
    }, [isStreaming]);

    // Reset loading message index when streaming starts
    useEffect(() => {
        if (isStreaming) {
            setCurrentLoadingMessageIndex(0);
        }
    }, [isStreaming]);

    const scrollToLatestMessage = () => {
        // TODO: Should this be scroll to second to last message / user message instead of latest message? Used for loading from history and loading new message.
        if (messagesContainerRef.current && messages.length > 0) {
            // Find the last message element in the DOM
            const messageElements = messagesContainerRef.current.querySelectorAll('[data-message-index]');
            const lastMessageElement = messageElements[messageElements.length - 1];

            if (lastMessageElement) {
                lastMessageElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start' // This positions the element at the top of the viewport
                });
            }
        }
    };

    const scrollToBottom = () => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        } else if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    };

    useEffect(() => {
        // Only fetch data when id is available
        if (!id) return;

        async function fetchPaper() {
            try {
                const response: PaperData = await fetchFromApi(`/api/paper?id=${id}`);
                setPaperData(response);
            } catch (error) {
                console.error('Error fetching paper:', error);
            } finally {
                setLoading(false);
            }
        }

        async function fetchAvailableModels() {
            try {
                const response = await fetchFromApi(`/api/message/models`);
                if (response.models && Object.keys(response.models).length > 0) {
                    setAvailableModels(response.models);
                }
            } catch (error) {
                console.error('Error fetching available models:', error);
            }
        }

        async function fetchPaperNote() {
            try {
                const response: PaperNoteData = await fetchFromApi(`/api/paper/note?paper_id=${id}`);
                setPaperNoteData(response);
                setPaperNoteContent(response.content);
            } catch (error) {
                console.error('Error fetching paper note:', error);
            }
        }

        if (jobId) return;

        fetchPaperNote();
        fetchAvailableModels();
        fetchPaper();
        refreshAnnotations();
        fetchHighlights();
    }, [id, jobId]);

    useEffect(() => {
        if (!paperData) return;

        // Initialize conversation once paper data is available
        async function fetchConversation() {
            let retrievedConversationId = null;
            try {
                const response = await fetchFromApi(`/api/paper/conversation?paper_id=${id}`, {
                    method: 'GET',
                });

                if (response && response.id) {
                    retrievedConversationId = response.id;
                }
                setConversationId(retrievedConversationId);
            } catch (error) {
                console.error('Error fetching conversation ID:', error);

                try {

                    if (!retrievedConversationId) {
                        // If no conversation ID is returned, create a new one
                        const newConversationResponse = await fetchFromApi(`/api/conversation/paper/${id}`, {
                            method: 'POST',
                        });
                        retrievedConversationId = newConversationResponse.id;
                    }

                    setConversationId(retrievedConversationId);
                } catch (error) {
                    console.error('Error fetching conversation:', error);
                }
            }
        }

        fetchConversation();
    }, [paperData, id]);

    useEffect(() => {
        if (!conversationId) return;

        // Fetch initial messages for the conversation
        async function fetchMessages() {
            try {
                const response = await fetchFromApi(`/api/conversation/${conversationId}?page=${pageNumberConversationHistory}`, {
                    method: 'GET',
                });

                // Map the response messages to the expected format
                const fetchedMessages: ChatMessage[] = response.messages.map((msg: ChatMessage) => ({
                    role: msg.role,
                    content: msg.content,
                    id: msg.id,
                    references: msg.references || {}
                }));

                if (fetchedMessages.length === 0) {
                    setHasMoreMessages(false);
                    return;
                }

                if (messages.length === 0) {
                    scrollToBottom();
                } else {
                    // Add a 1/2 second delay before scrolling to the latest message
                    setTimeout(() => {
                        scrollToLatestMessage();
                    }, 500);
                }

                setMessages(prev => [...fetchedMessages, ...prev]);
                setPageNumberConversationHistory(pageNumberConversationHistory + 1);
            } catch (error) {
                console.error('Error fetching messages:', error);
            }
        }
        fetchMessages();
    }, [conversationId, pageNumberConversationHistory]);

    useEffect(() => {
        if (!paperData) return;

        // Initialize conversation once paper data is available
        async function fetchConversation() {
            let retrievedConversationId = null;
            try {
                const response = await fetchFromApi(`/api/paper/conversation?paper_id=${id}`, {
                    method: 'GET',
                });

                if (response && response.id) {
                    retrievedConversationId = response.id;
                }
                setConversationId(retrievedConversationId);
            } catch (error) {
                console.error('Error fetching conversation ID:', error);

                try {

                    if (!retrievedConversationId) {
                        // If no conversation ID is returned, create a new one
                        const newConversationResponse = await fetchFromApi(`/api/conversation/${id}`, {
                            method: 'POST',
                        });
                        retrievedConversationId = newConversationResponse.id;
                    }

                    setConversationId(retrievedConversationId);
                } catch (error) {
                    console.error('Error fetching conversation:', error);
                }
            }
        }

        fetchConversation();
    }, [paperData, id]);

    useEffect(() => {
        if (addedContentForPaperNote) {
            const newNoteContent = paperNoteContent ? `${paperNoteContent}` + `\n\n` + `> ${addedContentForPaperNote}` : `> ${addedContentForPaperNote}`;

            setPaperNoteContent(newNoteContent);

            // Set local storage
            try {
                localStorage.setItem(`paper-note-${id}`, newNoteContent);
            } catch (error) {
                console.error('Error saving to local storage:', error);
            }

            setAddedContentForPaperNote(null);
            setRightSideFunction('Notes');
        }
    }, [addedContentForPaperNote]);

    // Handle scroll to load more messages
    const handleScroll = () => {
        if (!messagesContainerRef.current) return;

        const { scrollTop } = messagesContainerRef.current;

        // If user has scrolled close to the top (within 50px), load more messages
        if (scrollTop < 50 && hasMoreMessages && !isLoadingMoreMessages && conversationId) {
            fetchMoreMessages();
        }
    };

    const fetchMoreMessages = async () => {
        if (!hasMoreMessages || isLoadingMoreMessages) return;

        setIsLoadingMoreMessages(true);
        try {
            const response = await fetchFromApi(`/api/conversation/${conversationId}?page=${pageNumberConversationHistory}`, {
                method: 'GET',
            });

            const fetchedMessages = response.messages.map((msg: ChatMessage) => ({
                role: msg.role,
                content: msg.content,
                id: msg.id,
                references: msg.references || {}
            }));

            if (fetchedMessages.length === 0) {
                setHasMoreMessages(false);
                return;
            }

            // Store current scroll position and height
            const container = messagesContainerRef.current;
            const scrollHeight = container?.scrollHeight || 0;

            // Add new messages to the top
            setMessages(prev => [...fetchedMessages, ...prev]);
            setPageNumberConversationHistory(pageNumberConversationHistory + 1);

            // After the component re-renders with new messages
            setTimeout(() => {
                if (container) {
                    // Scroll to maintain the same relative position
                    const newScrollHeight = container.scrollHeight;
                    container.scrollTop = newScrollHeight - scrollHeight;
                }
            }, 0);
        } catch (error) {
            console.error('Error fetching more messages:', error);
        } finally {
            setIsLoadingMoreMessages(false);
        }
    };

    const updateNote = useCallback(async (note: string) => {
        if (!id) return;
        try {
            if (!paperNoteData) {
                const response = await fetchFromApi(`/api/paper/note?paper_id=${id}`, {
                    method: 'POST',
                    body: JSON.stringify({ content: note }),
                    headers: { 'Content-Type': 'application/json' }
                });
                setPaperNoteData(response);
            } else {
                await fetchFromApi(`/api/paper/note?paper_id=${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ content: note }),
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            setLastPaperNoteSaveTime(Date.now());

            // On successful save, clear the local storage version
            localStorage.removeItem(`paper-note-${id}`);
        } catch (error) {
            console.error('Error updating note:', error);
            // Keep the local storage version for retry later
        }
    }, [id, paperNoteData]);

    // Debounced save to prevent excessive local storage writes and re-renders
    const debouncedSaveNote = useCallback((content: string) => {
        // Save to local storage
        try {
            localStorage.setItem(`paper-note-${id}`, content);
        } catch (error) {
            console.error('Error saving to local storage:', error);
        }

        // Clear existing timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Set new timeout for server save
        saveTimeoutRef.current = setTimeout(() => {
            updateNote(content);
        }, 2000);
    }, [id, updateNote]);

    useEffect(() => {
        if (paperNoteContent) {
            debouncedSaveNote(paperNoteContent);
        }
    }, [paperNoteContent, debouncedSaveNote]);

    const transformReferencesToFormat = useCallback((references: string[]) => {
        const citations = references.map((ref, index) => ({
            key: `${index + 1}`,
            reference: ref,
        }));

        return {
            "citations": citations,
        }
    }, []);

    const handleSubmit = useCallback(async (e: FormEvent | null = null) => {
        if (e) {
            e.preventDefault();
        }

        if (!currentMessage.trim() || isStreaming) return;

        // Add user message to chat
        const userMessage: ChatMessage = { role: 'user', content: currentMessage, references: transformReferencesToFormat(userMessageReferences) };
        setMessages(prev => [...prev, userMessage]);

        // Clear input field
        setCurrentMessage('');

        // Clear user message references
        setUserMessageReferences([]);

        // Create placeholder for assistant response
        // setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        setIsStreaming(true);
        setStreamingChunks([]); // Clear previous chunks
        setStreamingReferences(undefined); // Clear previous references

        const requestBody: ChatRequestBody = {
            user_query: userMessage.content,
            conversation_id: conversationId,
            paper_id: id,
            user_references: userMessageReferences,
        };

        if (selectedModel) {
            requestBody.llm_provider = selectedModel;
        }

        if (responseStyle) {
            requestBody.style = responseStyle;
        }

        try {
            const stream = await fetchStreamFromApi('/api/message/chat/paper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            setUserMessageReferences([]);

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = '';
            let references: Reference | undefined = undefined;
            let buffer = ''; // Buffer to accumulate partial chunks

            // Debug counters
            let chunkCount = 0;
            let contentChunks = 0;
            let referenceChunks = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    // Process any remaining buffer content
                    if (buffer.trim()) {
                        console.warn('Unprocessed buffer at end of stream:', buffer);
                    }
                    break;
                }

                // Decode the chunk and add to buffer
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                chunkCount++;
                console.log(`Processing chunk #${chunkCount}:`, chunk);

                // Split buffer by delimiter and process complete events
                const parts = buffer.split(END_DELIMITER);

                // Keep the last part (potentially incomplete) in the buffer
                buffer = parts.pop() || '';

                // Process all complete parts
                for (const event of parts) {
                    if (!event.trim()) continue;

                    try {
                        // Parse the JSON chunk
                        const parsedChunk = JSON.parse(event.trim());
                        const chunkType = parsedChunk.type;
                        const chunkContent = parsedChunk.content;

                        if (chunkType === 'content') {
                            contentChunks++;
                            console.log(`Processing content chunk #${contentChunks}:`, chunkContent);

                            // Add this content to our accumulated content
                            accumulatedContent += chunkContent;

                            // Update the message with the new content
                            setStreamingChunks(prev => {
                                const newChunks = [...prev, chunkContent];
                                // Update previous content for animation tracking
                                return newChunks;
                            });
                        }
                        else if (chunkType === 'references') {
                            referenceChunks++;
                            console.log(`Processing references chunk #${referenceChunks}:`, chunkContent);

                            // Store the references
                            references = chunkContent;

                            // Update the message with the references
                            setStreamingReferences(chunkContent);
                        }
                        else {
                            console.warn(`Unknown chunk type: ${chunkType}`);
                        }
                    } catch (error) {
                        console.error('Error processing event:', error, 'Raw event:', event);
                        // Continue processing other events rather than breaking
                        continue;
                    }
                }
            }

            console.log(`Stream completed. Processed ${chunkCount} chunks (${contentChunks} content, ${referenceChunks} references).`);
            console.log("Final accumulated content:", accumulatedContent);
            console.log("Final references:", references);

            // After streaming is complete, add the full message to the state
            if (accumulatedContent) {
                const finalMessage: ChatMessage = {
                    role: 'assistant',
                    content: accumulatedContent,
                    references: references,
                };
                setMessages(prev => [...prev, finalMessage]);
            }

            // Refetch subscription data to update credit usage
            try {
                await refetchSubscription();
            } catch (error) {
                console.error('Error refetching subscription:', error);
            }

        } catch (error) {
            console.error('Error during streaming:', error);
            setMessages(prev => {
                const updatedMessages = [...prev];
                updatedMessages[updatedMessages.length - 1] = {
                    ...updatedMessages[updatedMessages.length - 1],
                    content: "An error occurred while processing your request.",
                };
                return updatedMessages;
            });
        } finally {
            setIsStreaming(false);
        }
    }, [currentMessage, isStreaming, conversationId, id, userMessageReferences, selectedModel, responseStyle, transformReferencesToFormat, refetchSubscription]);

    // Add useEffect to handle starter question submission
    useEffect(() => {
        if (pendingStarterQuestion) {
            handleSubmit(null);
            setPendingStarterQuestion(null);
        }
    }, [currentMessage, pendingStarterQuestion, handleSubmit]);

    const matchesCurrentCitation = useCallback((key: string, messageIndex: number) => {
        return activeCitationKey === key.toString() && activeCitationMessageIndex === messageIndex;
    }, [activeCitationKey, activeCitationMessageIndex]);

    // Memoize expensive markdown components to prevent re-renders
    const memoizedOverviewContent = useMemo(() => {
        if (!paperData?.summary) return null;

        return (
            <Markdown
                remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    // Apply the custom component to text nodes
                    p: (props) => <CustomCitationLink
                        {...props}
                        handleCitationClick={handleCitationClickFromSummary}
                        messageIndex={0}
                        // Map summary citations to the citation format
                        citations={
                            paperData.summary_citations?.map(citation => ({
                                key: String(citation.index),
                                reference: citation.text
                            })) || []
                        }
                    />,
                    li: (props) => <CustomCitationLink
                        {...props}
                        handleCitationClick={handleCitationClickFromSummary}
                        messageIndex={0}
                        citations={
                            paperData.summary_citations?.map(citation => ({
                                key: String(citation.index),
                                reference: citation.text
                            })) || []
                        }
                    />,
                    div: (props) => <CustomCitationLink
                        {...props}
                        handleCitationClick={handleCitationClickFromSummary}
                        messageIndex={0}
                        citations={
                            paperData.summary_citations?.map(citation => ({
                                key: String(citation.index),
                                reference: citation.text
                            })) || []
                        }
                    />,
                    td: (props) => <CustomCitationLink
                        {...props}
                        handleCitationClick={handleCitationClickFromSummary}
                        messageIndex={0}
                        citations={
                            paperData.summary_citations?.map(citation => ({
                                key: String(citation.index),
                                reference: citation.text
                            })) || []
                        }
                    />,
                    table: (props) => (
                        <div className="overflow-x-auto">
                            <table {...props} className="min-w-full border-collapse" />
                        </div>
                    ),
                }}
            >
                {paperData.summary}
            </Markdown>
        );
    }, [paperData?.summary, paperData?.summary_citations, handleCitationClickFromSummary]);

    // Optimize textarea change handler to prevent excessive re-renders
    const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCurrentMessage(e.target.value);
    }, []);

    // Optimize notes textarea change handler
    const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPaperNoteContent(e.target.value);
    }, []);

    // Memoize message rendering to prevent unnecessary re-renders
    const memoizedMessages = useMemo(() => {
        return messages.map((msg, index) => (
            <div
                key={`${msg.id || `msg-${index}`}-${index}-${msg.role}-${msg.content.slice(0, 20).replace(/\s+/g, '')}`} // Use a stable and unique key
                className='flex flex-row gap-2 items-end'
            >
                {
                    msg.role === 'user' && user && (
                        <Avatar className="h-6 w-6">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {user.picture ? (<img src={user.picture} alt={user.name} />) : (<User size={16} />)}
                        </Avatar>
                    )
                }
                <div
                    data-message-index={index}
                    className={`relative group prose dark:prose-invert p-2 !max-w-full rounded-lg ${msg.role === 'user'
                        ? 'bg-blue-200 text-blue-800 w-fit animate-fade-in'
                        : 'w-full text-primary'
                        }`}
                >
                    <Markdown
                        remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                            // Apply the custom component to text nodes
                            p: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                            />,
                            li: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                            />,
                            div: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClick}
                                messageIndex={index}
                                citations={msg.references?.citations || []}
                            />,
                            td: (props) => <CustomCitationLink
                                {...props}
                                handleCitationClick={handleCitationClickFromSummary}
                                messageIndex={0}
                                citations={msg.references?.citations || []}
                            />,
                            table: (props) => (
                                <div className="overflow-x-auto">
                                    <table {...props} className="min-w-full border-collapse" />
                                </div>
                            ),
                        }}>
                        {msg.content}
                    </Markdown>
                    {msg.role === 'assistant' && (
                        <ChatMessageActions message={msg.content} references={msg.references} />
                    )}
                    {
                        msg.references && msg.references.citations && msg.references.citations.length > 0 && (
                            <div className="mt-0 pt-0 border-t border-gray-300 dark:border-gray-700" id="references-section">
                                <h4 className="text-sm font-semibold mb-2">References</h4>
                                <ul className="list-none p-0">
                                    {msg.references.citations.map((value, refIndex) => (
                                        <div
                                            key={refIndex}
                                            className={`flex flex-row gap-2 animate-fade-in ${matchesCurrentCitation(value.key, index) ? 'bg-blue-100 dark:bg-blue-900 rounded p-1 transition-colors duration-300' : ''}`}
                                            id={`citation-${value.key}-${index}`}
                                            onClick={() => handleCitationClick(value.key, index)}
                                        >
                                            <div className={`text-xs ${msg.role === 'user'
                                                ? 'bg-blue-200 text-blue-800'
                                                : 'text-secondary-foreground'
                                                }`}>
                                                <a href={`#citation-ref-${value.key}`}>{value.key}</a>
                                            </div>
                                            <div
                                                id={`citation-ref-${value.key}-${index}`}
                                                className={`text-xs ${msg.role === 'user'
                                                    ? 'bg-blue-200 text-blue-800 line-clamp-1'
                                                    : 'text-secondary-foreground'
                                                    }`}
                                            >
                                                {value.reference}
                                            </div>
                                        </div>
                                    ))}
                                </ul>
                            </div>
                        )}
                </div>
            </div>
        ));
    }, [messages, user, handleCitationClick, handleCitationClickFromSummary, matchesCurrentCitation]);

    const handleShare = useCallback(async () => {
        if (!id || !paperData || isSharing) return;
        setIsSharing(true);
        try {
            const response = await fetchFromApi(`/api/paper/share?id=${id}`, {
                method: 'POST',
            });
            setPaperData(prev => prev ? { ...prev, share_id: response.share_id } : null);
            const shareUrl = `${window.location.origin}/paper/share/${response.share_id}`;
            await navigator.clipboard.writeText(shareUrl);
            toast.success("Sharing link copied to clipboard!");
        } catch (error) {
            console.error('Error sharing paper:', error);
            toast.error("Failed to share paper.");
        } finally {
            setIsSharing(false);
        }
    }, [id, paperData, isSharing]);

    const handleUnshare = useCallback(async () => {
        if (!id || !paperData || !paperData.share_id || isSharing) return;
        setIsSharing(true);
        try {
            await fetchFromApi(`/api/paper/unshare?id=${id}`, {
                method: 'POST',
            });
            setPaperData(prev => prev ? { ...prev, share_id: "" } : null);
            toast.success("Paper is now private.");
        } catch (error) {
            console.error('Error unsharing paper:', error);
            toast.error("Failed to make paper private.");
        } finally {
            setIsSharing(false);
        }
    }, [id, paperData, isSharing]);

    const handleStatusChange = useCallback((status: PaperStatus) => {
        try {
            const url = `/api/paper/status?status=${status}&paper_id=${id}`;
            fetchFromApi(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            setPaperData(prev => prev ? { ...prev, status: status } : null);
            if (status === PaperStatusEnum.COMPLETED) {
                toast.success(
                    "Completed reading! 🎉",
                    {
                        description: `Congrats on finishing ${paperData?.title}!`,
                        duration: 5000,
                    }
                )
            }
        } catch (error) {
            console.error('Error updating paper status:', error);
            toast.error("Failed to update paper status.");
        }
    }, [id, paperData]);

    // useCallback to calculate chat credit usage
    const updateCreditUsage = useCallback(() => {
        if (!subscription) {
            setCreditUsage(null);
            return;
        }

        const { chat_credits_used, chat_credits_remaining } = subscription.usage;
        const total = chat_credits_used + chat_credits_remaining;
        const usagePercentage = getChatCreditUsagePercentage(subscription);

        if (isChatCreditAtLimit(subscription)) {
            console.log("Chat credits exceeded 100% usage, showing upgrade toast.");
            toast.info('Nice! You have used your chat credits for the week. Upgrade your plan to use more.', {
                duration: 5000,
                action: {
                    label: 'Upgrade',
                    onClick: () => {
                        window.location.href = '/pricing';
                    }
                }
            })
        };

        setCreditUsage({
            used: chat_credits_used,
            remaining: chat_credits_remaining,
            total,
            usagePercentage,
            showWarning: isChatCreditNearLimit(subscription),
            isNearLimit: isChatCreditNearLimit(subscription),
            isCritical: isChatCreditNearLimit(subscription, 95)
        });
    }, [subscription]);

    // Update credit usage whenever subscription changes
    useEffect(() => {
        updateCreditUsage();
    }, [updateCreditUsage]);


    if (loading) return <PaperViewSkeleton />;

    if (!paperData) return <div>Paper not found</div>;

    const sidePanelProps = {
        rightSideFunction,
        paperData,
        paperNoteContent,
        handleNotesChange,
        lastPaperNoteSaveTime,
        isMarkdownPreview,
        setIsMarkdownPreview,
        annotations,
        highlights,
        handleHighlightClick,
        addAnnotation,
        activeHighlight,
        updateAnnotation,
        removeAnnotation,
        isSharing,
        handleShare,
        handleUnshare,
        id,
        memoizedOverviewContent,
        matchesCurrentCitation,
        handleCitationClickFromSummary,
        setRightSideFunction,
        setExplicitSearchTerm,
        messages,
        hasMoreMessages,
        isLoadingMoreMessages,
        fetchMoreMessages,
        memoizedMessages,
        isStreaming,
        streamingChunks,
        streamingReferences,
        handleCitationClick,
        displayedText,
        isTyping,
        messagesEndRef,
        handleSubmit,
        chatInputFormRef,
        userMessageReferences,
        setUserMessageReferences,
        currentMessage,
        setCurrentMessage,
        handleTextareaChange,
        inputMessageRef,
        creditUsage,
        responseStyle,
        selectedModel,
        availableModels,
        setSelectedModel,
        setResponseStyle,
        nextMonday,
        handleScroll,
        messagesContainerRef,
        setPendingStarterQuestion,
    };

    if (isMobile) {
        return (
            <div className="flex flex-col w-full h-[calc(100vh-64px)]">
                <div className="flex-grow overflow-auto min-h-0">
                    {mobileView === 'reader' ? (
                        <div className="w-full h-full">
                            {paperData.file_url && (
                                <PdfViewer
                                    pdfUrl={paperData.file_url}
                                    explicitSearchTerm={explicitSearchTerm}
                                    setUserMessageReferences={setUserMessageReferences}
                                    setSelectedText={setSelectedText}
                                    setTooltipPosition={setTooltipPosition}
                                    setIsAnnotating={setIsAnnotating}
                                    setIsHighlightInteraction={setIsHighlightInteraction}
                                    isHighlightInteraction={isHighlightInteraction}
                                    highlights={highlights}
                                    setHighlights={setHighlights}
                                    selectedText={selectedText}
                                    tooltipPosition={tooltipPosition}
                                    setActiveHighlight={setActiveHighlight}
                                    activeHighlight={activeHighlight}
                                    addHighlight={addHighlight}
                                    loadHighlights={fetchHighlights}
                                    removeHighlight={removeHighlight}
                                    handleTextSelection={handleTextSelection}
                                    renderAnnotations={renderAnnotations}
                                    annotations={annotations}
                                    setAddedContentForPaperNote={setAddedContentForPaperNote}
                                    handleStatusChange={handleStatusChange}
                                    paperStatus={paperData.status}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="w-full h-full">
                            <div
                                className={`flex flex-row h-full relative ${!jobId ? "pr-[60px]" : ""}`}
                            >
                                {jobId ? (
                                    <div className="flex items-center justify-center h-full w-full">
                                        <div className="flex flex-col items-center">
                                            <EnigmaticLoadingExperience />
                                            <div className="flex items-center justify-center gap-1 font-mono text-lg w-full">
                                                <div className="flex items-center gap-1 w-14">
                                                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                                    <p className="text-gray-400 w-12">
                                                        {elapsedTime}s
                                                    </p>
                                                </div>
                                                <p className="text-primary text-right flex-1">{sidePanelDisplayedText}</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <SidePanelContent {...sidePanelProps} isMobile={true} />
                                        <PaperSidebar
                                            rightSideFunction={rightSideFunction}
                                            setRightSideFunction={setRightSideFunction}
                                            PaperToolset={PaperToolset}
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex justify-around items-center h-16">
                        <Button variant="ghost" onClick={() => setMobileView('reader')} className={`flex flex-col items-center gap-1 ${mobileView === 'reader' ? 'text-blue-500' : ''}`}>
                            <Book size={24} />
                            <span className="text-xs">Reader</span>
                        </Button>
                        <Button variant="ghost" onClick={() => setMobileView('panel')} className={`flex flex-col items-center gap-1 ${mobileView === 'panel' ? 'text-blue-500' : ''}`}>
                            <Box size={24} />
                            <span className="text-xs">Panel</span>
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-row w-full h-[calc(100vh-64px)]">
            <div className="w-full h-full flex items-center justify-center gap-0">
                {/* PDF Viewer Section */}
                <div
                    className="border-r-2 dark:border-gray-800 border-gray-200 p-0 h-full"
                    style={{
                        width: rightSideFunction === 'Focus' ? '100%' : `${leftPanelWidth}%`
                    }}
                >
                    {paperData.file_url && (
                        <div className="w-full h-full">
                            <PdfViewer
                                pdfUrl={paperData.file_url}
                                explicitSearchTerm={explicitSearchTerm}
                                setUserMessageReferences={setUserMessageReferences}
                                setSelectedText={setSelectedText}
                                setTooltipPosition={setTooltipPosition}
                                setIsAnnotating={setIsAnnotating}
                                setIsHighlightInteraction={setIsHighlightInteraction}
                                isHighlightInteraction={isHighlightInteraction}
                                highlights={highlights}
                                setHighlights={setHighlights}
                                selectedText={selectedText}
                                tooltipPosition={tooltipPosition}
                                setActiveHighlight={setActiveHighlight}
                                activeHighlight={activeHighlight}
                                addHighlight={addHighlight}
                                loadHighlights={fetchHighlights}
                                removeHighlight={removeHighlight}
                                handleTextSelection={handleTextSelection}
                                renderAnnotations={renderAnnotations}
                                annotations={annotations}
                                setAddedContentForPaperNote={setAddedContentForPaperNote}
                                handleStatusChange={handleStatusChange}
                                paperStatus={paperData.status}
                            />
                        </div>
                    )}
                </div>

                {/* Resizable Divider */}
                {rightSideFunction !== 'Focus' && (
                    <div
                        className="w-2 bg-background hover:bg-blue-100 dark:hover:bg-blue-400 cursor-col-resize transition-colors duration-200 flex-shrink-0 h-full rounded-2xl"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                    />
                )}

                {/* Right Side Panel */}
                <div
                    className={`flex flex-row h-full relative ${!jobId ? "pr-[60px]" : ""}`}
                    style={rightSideFunction !== 'Focus' ? { width: `${100 - leftPanelWidth}%` } : { width: 'auto' }}
                >
                    {jobId ? (
                        <div className="flex items-center justify-center h-full w-full">
                            <div className="flex flex-col items-center">
                                <EnigmaticLoadingExperience />
                                <div className="flex items-center justify-center gap-1 font-mono text-lg w-full">
                                    <div className="flex items-center gap-1 w-14">
                                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                        <p className="text-gray-400 w-12">
                                            {elapsedTime}s
                                        </p>
                                    </div>
                                    <p className="text-primary text-right flex-1">{sidePanelDisplayedText}</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <SidePanelContent {...sidePanelProps} isMobile={false} />
                            <PaperSidebar
                                rightSideFunction={rightSideFunction}
                                setRightSideFunction={setRightSideFunction}
                                PaperToolset={PaperToolset}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
