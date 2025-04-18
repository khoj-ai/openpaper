'use client';

import { PdfViewer } from '@/components/PdfViewer';
import { Button } from '@/components/ui/button';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import { useState, useEffect, FormEvent, Children, useRef, createElement, HTMLAttributes, ReactNode } from 'react';

// Reference to react-markdown documents: https://github.com/remarkjs/react-markdown?tab=readme-ov-file
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"

import { ChevronDown, ChevronUp, Highlighter, NotebookText, MessageCircle, Focus, X, Eye, Edit, Loader, HelpCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
} from "@/components/ui/sidebar";
import { AnnotationsView } from '@/components/AnnotationsView';
import { useHighlights } from '@/components/hooks/PdfHighlight';
import { useAnnotations } from '@/components/hooks/PdfAnnotation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CommandShortcut, localizeCommandToOS } from '@/components/ui/command';

interface PaperData {
    filename: string;
    file_url: string;
    authors: string[];
    title: string;
    abstract: string;
    publish_date: string;
    summary: string;
    institutions: string[];
    keywords: string[];
    starter_questions: string[];
}

interface PaperNoteData {
    content: string;
}

interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    references?: Reference;
}

export interface PaperHighlight {
    id?: string;
    raw_text: string;
    start_offset: number;
    end_offset: number;
}

export interface PaperHighlightAnnotation {
    id: string;
    highlight_id: string;
    document_id: string;
    content: string;
    created_at: string;
}

const isDateValid = (dateString: string) => {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
};

const googleScholarUrl = (searchTerm: string) => {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(searchTerm)}`;
}

interface Reference {
    citations: Citation[];
}

interface Citation {
    key: string;
    reference: string;
}

interface IPaperMetadata {
    paperData: PaperData;
    onClickStarterQuestion: (question: string) => void;
    hasMessages: boolean;
}

// Interface for the CustomCitationLink component props
interface CustomCitationLinkProps extends HTMLAttributes<HTMLElement> {
    children?: ReactNode;
    handleCitationClick: (key: string, messageIndex: number) => void;
    messageIndex: number;
    node?: {
        tagName?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties?: Record<string, any>;
    };
    className?: string;
}

const CustomCitationLink = ({ children, handleCitationClick, messageIndex, className, ...props }: CustomCitationLinkProps) => {
    // Create a clone of props to avoid mutating the original
    const elementProps = {
        ...props,
        className: `${className || ''}`
    };

    return createElement(
        // Use the original component type from props
        props.node?.tagName || 'span',
        elementProps,
        Children.map(children, (child) => {
            // If the child is a string, process it for citations
            if (typeof child === 'string') {
                const citationRegex = /\[\^(\d+|[a-zA-Z]+)\]/g;

                if (citationRegex.test(child)) {
                    // Reset regex state
                    citationRegex.lastIndex = 0;

                    // Create a React element array from the string with replaced citations
                    const parts: React.ReactNode[] = [];
                    let lastIndex = 0;
                    let match;

                    while ((match = citationRegex.exec(child)) !== null) {
                        // Add text before the citation
                        if (match.index > lastIndex) {
                            parts.push(child.substring(lastIndex, match.index));
                        }

                        // Add the citation link
                        const citationKey = match[1];

                        parts.push(
                            <a
                                key={`citation-${citationKey}-${match.index}`}
                                href={`#citation-${citationKey}`}
                                className="text-slate-600 font-medium hover:underline text-sm bg-slate-200 rounded-xl px-1 py-0.5"
                                id={`citation-ref-${citationKey}`}
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleCitationClick(citationKey, messageIndex);
                                }}
                            >
                                {match[1]}
                            </a>
                        );

                        // Update lastIndex to continue after current match
                        lastIndex = match.index + match[0].length;
                    }

                    // Add remaining text
                    if (lastIndex < child.length) {
                        parts.push(child.substring(lastIndex));
                    }

                    return <>{parts}</>;
                }
                return child;
            }
            return child;
        })
    );
};

const data = {
    nav: [
        { name: "Chat", icon: MessageCircle },
        { name: "Notes", icon: NotebookText },
        { name: "Annotations", icon: Highlighter },
        { name: "Focus", icon: Focus }
    ],
}

function PaperMetadata(props: IPaperMetadata) {
    const { paperData } = props;
    const [isOpen, setIsOpen] = useState(!props.hasMessages);

    const showAccordion = paperData.authors?.length > 0 || paperData.institutions?.length > 0;

    useEffect(() => {
        setIsOpen(!props.hasMessages);
    }, [props.hasMessages]);

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={setIsOpen}
            className="mb-4 border-b-2 border-secondary"
        >
            <div className="p-2">
                <CollapsibleTrigger className="flex flex-row w-full items-center justify-between">
                    <h2 className="text-xl font-bold">{paperData.title}</h2>
                    <div className="text-secondary-foreground text-xs flex items-center gap-2 bg-secondary p-1 rounded-md">
                        {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
                <div className="px-4 pb-4 space-y-4">
                    {
                        paperData.publish_date && isDateValid(paperData.publish_date) && (
                            <div className='text-secondary-foreground text-xs w-fit p-1 rounded-lg bg-secondary'>
                                {new Date(paperData.publish_date).toLocaleDateString()}
                            </div>
                        )
                    }
                    {
                        paperData.summary && (
                            <div className='text-sm'>
                                {paperData.summary}
                            </div>
                        )
                    }


                    {paperData.starter_questions && paperData.starter_questions.length > 0 && (
                        <div>
                            <ScrollArea className="max-h-1/2">
                                <div className="flex gap-2 flex-wrap">
                                    {paperData.starter_questions.map((question, i) => (
                                        <Button
                                            key={i}
                                            variant="outline"
                                            className="text-xs font-medium p-2 max-w-full whitespace-normal h-auto text-left justify-start break-words bg-secondary text-secondary-foreground hover:bg-secondary/50"
                                            onClick={() => {
                                                props.onClickStarterQuestion(question);
                                                setIsOpen(false);
                                            }}
                                        >
                                            {question}
                                        </Button>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    )}

                    {showAccordion && (
                        <Accordion type="single" collapsible className='text-sm'>
                            {paperData.authors && paperData.authors.length > 0 && (
                                <AccordionItem value="item-1">
                                    <AccordionTrigger className="flex justify-between items-center">
                                        Authors
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="flex gap-2 flex-wrap">
                                            {paperData.authors.map((author, i) => (
                                                <a
                                                    key={i}
                                                    href={googleScholarUrl(author)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-500 hover:underline mr-2"
                                                >
                                                    {author}
                                                </a>
                                            ))}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            )}
                            {paperData.institutions && paperData.institutions.length > 0 && (
                                <AccordionItem value="item-2">
                                    <AccordionTrigger className="flex justify-between items-center">
                                        Institutions
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="flex gap-2 flex-wrap">
                                            {paperData.institutions.map((institution, i) => (
                                                <a
                                                    key={i}
                                                    href={googleScholarUrl(institution)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-500 hover:underline mr-2"
                                                >
                                                    {institution}
                                                </a>
                                            ))}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            )}
                        </Accordion>
                    )}


                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

export default function PaperView() {
    const params = useParams();
    const id = params.id as string;
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
        loadHighlights
    } = useHighlights(id);

    const {
        annotations,
        addAnnotation,
        removeAnnotation,
        updateAnnotation,
        renderAnnotations,
    } = useAnnotations(id);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [currentMessage, setCurrentMessage] = useState('');
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

    const [rightSideFunction, setRightSideFunction] = useState<string>('Chat');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    // Reference to track the save timeout
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const inputMessageRef = useRef<HTMLTextAreaElement>(null);
    const chatInputFormRef = useRef<HTMLFormElement>(null);


    // Add this function to handle citation clicks
    const handleCitationClick = (key: string, messageIndex: number) => {

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
            element.scrollIntoView({ behavior: 'smooth' });
        }

        // Clear the highlight after a few seconds
        setTimeout(() => setActiveCitationKey(null), 3000);
    };

    const handleHighlightClick = (highlight: PaperHighlight) => {
        setActiveHighlight(highlight);
    };

    useEffect(() => {
        setRightSideFunction('Chat');
    }, [userMessageReferences]);

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
                    // Optionally update the server with this content
                }
            } catch (error) {
                console.error('Error retrieving from local storage:', error);
            }
        }
    }, [id]);

    // Add this effect to scroll to bottom when messages change or streaming is active
    useEffect(() => {
        // Only auto-scroll when messages are being added at the bottom (during streaming)
        if (isStreaming) {
            scrollToBottom();
        }
    }, [messages, isStreaming]);

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

        async function fetchPaperNote() {
            try {
                const response: PaperNoteData = await fetchFromApi(`/api/paper/note?document_id=${id}`);
                setPaperNoteData(response);
                setPaperNoteContent(response.content);
            } catch (error) {
                console.error('Error fetching paper note:', error);
            }
        }

        fetchPaperNote();
        fetchPaper();
    }, [id]);

    useEffect(() => {
        if (!paperData) return;

        // Initialize conversation once paper data is available
        async function fetchConversation() {
            let retrievedConversationId = null;
            try {
                const response = await fetchFromApi(`/api/paper/conversation?document_id=${id}`, {
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
        if (!conversationId) return;

        // Fetch initial messages for the conversation
        async function fetchMessages() {
            try {
                const response = await fetchFromApi(`/api/conversation/${conversationId}?page=${pageNumberConversationHistory}`, {
                    method: 'GET',
                });

                // Map the response messages to the expected format
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

                if (messages.length === 0) {
                    scrollToBottom();
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

    // Add useEffect to handle starter question submission
    useEffect(() => {
        if (pendingStarterQuestion) {
            handleSubmit(null);
            setPendingStarterQuestion(null);
        }
    }, [currentMessage]);

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

    // Update your existing updateNote function to include success handling
    const updateNote = async (note: string) => {
        if (!id) return;
        try {
            if (!paperNoteData) {
                const response = await fetchFromApi(`/api/paper/note?document_id=${id}`, {
                    method: 'POST',
                    body: JSON.stringify({ content: note }),
                    headers: { 'Content-Type': 'application/json' }
                });
                setPaperNoteData(response);
            } else {
                await fetchFromApi(`/api/paper/note?document_id=${id}`, {
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
    };

    useEffect(() => {
        if (paperNoteContent) {
            // Save to local storage
            try {
                localStorage.setItem(`paper-note-${id}`, paperNoteContent);
            } catch (error) {
                console.error('Error saving to local storage:', error);
            }

            // Clear existing timeout
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            // Set new timeout for server save
            saveTimeoutRef.current = setTimeout(() => {
                updateNote(paperNoteContent);
            }, 2000);
        }
    }, [paperNoteContent]);

    const transformReferencesToFormat = (references: string[]) => {
        const citations = references.map((ref, index) => ({
            key: `${index + 1}`,
            reference: ref,
        }));

        return {
            "citations": citations,
        }
    }

    const handleSubmit = async (e: FormEvent | null = null) => {
        if (e) {
            e.preventDefault();
        }

        if (!currentMessage.trim() || isStreaming) return;

        // Add user message to chat
        const userMessage: ChatMessage = { role: 'user', content: currentMessage, references: transformReferencesToFormat(userMessageReferences) };
        setMessages(prev => [...prev, userMessage]);

        // Clear input field
        setCurrentMessage('');

        // Create placeholder for assistant response
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        setIsStreaming(true);

        try {
            const stream = await fetchStreamFromApi('/api/message/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_query: userMessage.content,
                    conversation_id: conversationId,
                    paper_id: id,
                    user_references: userMessageReferences,
                })
            });

            setUserMessageReferences([]);

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = '';
            let references: Reference | undefined = undefined;

            // Debug counters
            let chunkCount = 0;
            let contentChunks = 0;
            let referenceChunks = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                // Decode the chunk
                const chunk = decoder.decode(value);
                chunkCount++;
                console.log(`Processing chunk #${chunkCount}:`, chunk);

                try {
                    // Parse the JSON chunk
                    const parsedChunk = JSON.parse(chunk);
                    const chunkType = parsedChunk.type;
                    const chunkContent = parsedChunk.content;

                    if (chunkType === 'content') {
                        contentChunks++;
                        console.log(`Processing content chunk #${contentChunks}:`, chunkContent);

                        // Add this content to our accumulated content
                        accumulatedContent += chunkContent;

                        // Update the message with the new content
                        setMessages(prev => {
                            const updatedMessages = [...prev];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...updatedMessages[updatedMessages.length - 1],
                                content: accumulatedContent,
                                references
                            };
                            return updatedMessages;
                        });
                    }
                    else if (chunkType === 'references') {
                        referenceChunks++;
                        console.log(`Processing references chunk #${referenceChunks}:`, chunkContent);

                        // Store the references
                        references = chunkContent;

                        // Update the message with the references
                        setMessages(prev => {
                            const updatedMessages = [...prev];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...updatedMessages[updatedMessages.length - 1],
                                content: accumulatedContent,
                                references
                            };
                            return updatedMessages;
                        });
                    }
                    else {
                        console.warn(`Unknown chunk type: ${chunkType}`);
                    }
                } catch (error) {
                    console.error('Error processing chunk:', error, 'Raw chunk:', chunk);
                    // Handle the error gracefully
                    setMessages(prev => {
                        const updatedMessages = [...prev];
                        updatedMessages[updatedMessages.length - 1] = {
                            ...updatedMessages[updatedMessages.length - 1],
                            content: "An error occurred while processing the response. Can you try again?",
                        };
                        return updatedMessages;
                    });
                    break;
                }
            }

            console.log(`Stream completed. Processed ${chunkCount} chunks (${contentChunks} content, ${referenceChunks} references).`);
            console.log("Final accumulated content:", accumulatedContent);
            console.log("Final references:", references);

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
    };

    const matchesCurrentCitation = (key: string, messageIndex: number) => {
        return activeCitationKey === key.toString() && activeCitationMessageIndex === messageIndex;
    }

    if (loading) return <div>Loading paper data...</div>;

    if (!paperData) return <div>Paper not found</div>;

    return (
        <div className="flex flex-row w-full h-[calc(100vh-64px)]">
            <div
                className={`w-full h-full grid ${rightSideFunction === 'Focus' ? 'grid-cols-2' : 'grid-cols-3'} items-center justify-center gap-0`}>

                <div className="border-r-2 dark:border-gray-800 border-gray-200 p-0 h-full col-span-2">
                    {/* PDF Viewer Section */}
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
                                isAnnotating={isAnnotating}
                                isHighlightInteraction={isHighlightInteraction}
                                highlights={highlights}
                                setHighlights={setHighlights}
                                selectedText={selectedText}
                                tooltipPosition={tooltipPosition}
                                setActiveHighlight={setActiveHighlight}
                                activeHighlight={activeHighlight}
                                addHighlight={addHighlight}
                                loadHighlights={loadHighlights}
                                removeHighlight={removeHighlight}
                                handleTextSelection={handleTextSelection}
                                renderAnnotations={renderAnnotations}
                                annotations={annotations}
                                setAddedContentForPaperNote={setAddedContentForPaperNote}
                            />
                        </div>
                    )}
                </div>
                {
                    rightSideFunction === 'Notes' && (
                        <div className='p-2 w-full h-full flex flex-col'>
                            <div className="flex justify-between items-center mb-2 flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="text-xs text-gray">
                                        Note length: {paperNoteContent?.length} characters
                                    </div>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger>
                                                <HelpCircle className="h-4 w-4 text-gray-500" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Supports Markdown formatting:</p>
                                                <ul className="text-xs mt-1">
                                                    <li>**bold**</li>
                                                    <li>*italic*</li>
                                                    <li># Heading</li>
                                                    <li>- List items</li>
                                                    <li>{">"} Blockquotes</li>
                                                </ul>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger>

                                            <Toggle
                                                aria-label="Toggle markdown preview"
                                                onPressedChange={(pressed) => setIsMarkdownPreview(pressed)}
                                                pressed={isMarkdownPreview}
                                            >
                                                <CommandShortcut>
                                                    {localizeCommandToOS('M')}
                                                </CommandShortcut>
                                                {isMarkdownPreview ? <Eye size={16} /> : <Edit size={16} />}
                                            </Toggle>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Toggle between edit and preview mode</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>

                            {isMarkdownPreview ? (
                                <div className="flex-1 min-h-0 relative">
                                    <div className="absolute inset-0 overflow-y-auto">
                                        <div className="prose dark:prose-invert max-w-none text-sm">
                                            <Markdown
                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                rehypePlugins={[rehypeKatex]}
                                            >
                                                {paperNoteContent || ''}
                                            </Markdown>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <Textarea
                                    className='w-full flex-1'
                                    value={paperNoteContent}
                                    onChange={(e) =>
                                        setPaperNoteContent(e.target.value)
                                    }
                                    placeholder="Start taking notes..."
                                />
                            )}

                            {paperNoteContent && lastPaperNoteSaveTime && (
                                <div className="text-xs text-green-500 mt-2 flex-shrink-0">
                                    Last saved: {new Date(lastPaperNoteSaveTime).toLocaleTimeString()}
                                </div>
                            )}
                        </div>
                    )
                }
                {
                    rightSideFunction === 'Annotations' && (
                        <div className="flex flex-col h-[calc(100vh-64px)] px-2 overflow-y-auto">
                            <AnnotationsView
                                annotations={annotations}
                                highlights={highlights}
                                onHighlightClick={handleHighlightClick}
                                addAnnotation={addAnnotation}
                                activeHighlight={activeHighlight}
                                updateAnnotation={updateAnnotation}
                                removeAnnotation={removeAnnotation}
                            />
                        </div>
                    )
                }
                {
                    rightSideFunction === 'Chat' && (
                        <div className="flex flex-col h-[calc(100vh-64px)] px-2 overflow-y-auto">
                            {/* Paper Metadata Section */}
                            {paperData && (
                                <PaperMetadata
                                    paperData={paperData}
                                    hasMessages={messages.length > 0}
                                    onClickStarterQuestion={(question) => {
                                        setCurrentMessage(question);
                                        inputMessageRef.current?.focus();
                                        chatInputFormRef.current?.scrollIntoView({
                                            behavior: 'smooth',
                                            block: 'nearest',
                                            inline: 'nearest',
                                        });
                                        setPendingStarterQuestion(question);
                                    }}
                                />
                            )}

                            <div
                                className="flex-1 overflow-y-auto mb-4 space-y-4"
                                ref={messagesContainerRef}
                                onScroll={handleScroll}
                            >
                                {hasMoreMessages && messages.length > 0 && (
                                    <div className="text-center py-2">
                                        {isLoadingMoreMessages ? (
                                            <div className="text-sm text-gray-500">Loading messages...</div>
                                        ) : (
                                            <button
                                                className="text-sm text-blue-500 hover:text-blue-700"
                                                onClick={fetchMoreMessages}
                                            >
                                                Load earlier messages
                                            </button>
                                        )}
                                    </div>
                                )}

                                {messages.length === 0 ? (
                                    <div className="text-center text-gray-500 my-4">
                                        What do you want to understand about this paper?
                                    </div>
                                ) : (
                                    messages.map((msg, index) => (
                                        <div
                                            key={index}
                                            className={`prose dark:prose-invert p-3 rounded-lg ${msg.role === 'user'
                                                ? 'bg-blue-200 text-blue-800 ml-12'
                                                : 'w-full text-primary'
                                                }`}
                                        >
                                            <Markdown
                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                rehypePlugins={[rehypeKatex]}
                                                components={{
                                                    // Apply the custom component to text nodes
                                                    p: (props) => <CustomCitationLink
                                                        {...props}
                                                        handleCitationClick={handleCitationClick}
                                                        messageIndex={index}
                                                    />,
                                                    li: (props) => <CustomCitationLink
                                                        {...props}
                                                        handleCitationClick={handleCitationClick}
                                                        messageIndex={index}
                                                    />,
                                                    div: (props) => <CustomCitationLink
                                                        {...props}
                                                        handleCitationClick={handleCitationClick}
                                                        messageIndex={index}
                                                    />,
                                                }}
                                            >
                                                {msg.content}
                                            </Markdown>
                                            {
                                                msg.references && msg.references['citations']?.length > 0 && (
                                                    <div className="mt-2" id="references-section">
                                                        <ul className="list-none p-0">
                                                            {Object.entries(msg.references['citations']).map(([refIndex, value]) => (
                                                                <div
                                                                    key={refIndex}
                                                                    className={`flex flex-row gap-2 ${matchesCurrentCitation(value.key, index) ? 'bg-blue-100 dark:bg-blue-900 rounded p-1 transition-colors duration-300' : ''}`}
                                                                    id={`citation-${value.key}-${index}`}
                                                                    onClick={() => handleCitationClick(value.key, index)}
                                                                >
                                                                    <div className="text-xs text-secondary-foreground">
                                                                        <a href={`#citation-ref-${value.key}`}>{value.key}</a>
                                                                    </div>
                                                                    <div
                                                                        id={`citation-ref-${value.key}-${index}`}
                                                                        className="text-xs text-secondary-foreground"
                                                                    >
                                                                        {value.reference}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                        </div>
                                    ))
                                )}
                                {
                                    isStreaming && (
                                        <Loader className="animate-spin w-6 h-6 text-blue-500" />
                                    )
                                }
                                <div ref={messagesEndRef} />
                            </div>
                            <form onSubmit={handleSubmit} className="flex flex-col gap-2" ref={chatInputFormRef}>
                                {
                                    userMessageReferences.length > 0 && (
                                        <div className='flex flex-row gap-2'>
                                            {userMessageReferences.map((ref, index) => (
                                                <div key={index} className="text-xs text-secondary-foreground flex bg-secondary p-2 rounded-lg">
                                                    <p
                                                        className='
                                                        overflow-hidden
                                                        text-ellipsis
                                                        whitespace-normal
                                                        max-w-[200px]
                                                        text-secondary-foreground
                                                        line-clamp-2
                                                        '
                                                        onClick={() =>
                                                            setExplicitSearchTerm(ref)
                                                        }
                                                    >
                                                        {ref}
                                                    </p>
                                                    <Button
                                                        variant='ghost'
                                                        className='h-auto w-fit p-0 !px-0'
                                                        onClick={() =>
                                                            setUserMessageReferences(prev => prev.filter((_, i) => i !== index))
                                                        }
                                                    >
                                                        <X size={2} />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )
                                }
                                <Textarea
                                    value={currentMessage}
                                    onChange={(e) => setCurrentMessage(e.target.value)}
                                    ref={inputMessageRef}
                                    placeholder="Ask something about this paper..."
                                    className="flex-1 border rounded-md resize-none p-2"
                                    disabled={isStreaming}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSubmit(e);
                                        }
                                    }}
                                />
                            </form>
                        </div>
                    )
                }

            </div>
            <div className="hidden md:flex flex-col w-fit h-[calc(100vh-64px)]">
                <SidebarProvider className="items-start h-[calc(100vh-64px)] min-h-fit w-fit">
                    <Sidebar collapsible="none" className="hidden md:flex w-fit">
                        <SidebarContent>
                            <SidebarGroup>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {data.nav.map((item) => (
                                            <SidebarMenuItem key={item.name}>
                                                <SidebarMenuButton
                                                    asChild
                                                    isActive={item.name === rightSideFunction}
                                                    title={item.name}
                                                    onClick={() => {
                                                        setRightSideFunction(item.name);
                                                    }}
                                                >
                                                    <item.icon />
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        </SidebarContent>
                    </Sidebar>
                </SidebarProvider>
            </div>
        </div>

    );
}
