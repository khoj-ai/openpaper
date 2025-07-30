
import {
    ChatMessage,
    PaperData,
    PaperHighlight,
    Reference,
    ResponseStyle,
    PaperHighlightAnnotation,
} from '@/lib/schema';
import {
    X,
    Eye,
    Edit,
    Loader,
    HelpCircle,
    ArrowUp,
    Feather,
    Share2Icon,
    LockIcon,
    Sparkle,
    Check,
    Route,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CommandShortcut, localizeCommandToOS } from '@/components/ui/command';
import { Toggle } from "@/components/ui/toggle";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AnnotationsView } from '@/components/AnnotationsView';
import { AudioOverview } from '@/components/AudioOverview';
import PaperMetadata from '@/components/PaperMetadata';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { AnimatedMarkdown } from '@/components/AnimatedMarkdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import Link from 'next/link';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

import { toast } from "sonner";

interface CreditUsage {
    used: number;
    remaining: number;
    total: number;
    usagePercentage: number;
    showWarning: boolean;
    isNearLimit: boolean;
    isCritical: boolean;
}

interface SidePanelContentProps {
    rightSideFunction: string;
    paperData: PaperData;
    paperNoteContent: string | undefined;
    handleNotesChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    lastPaperNoteSaveTime: number | null;
    isMarkdownPreview: boolean;
    setIsMarkdownPreview: (value: boolean) => void;
    annotations: PaperHighlightAnnotation[];
    highlights: PaperHighlight[];
    handleHighlightClick: (highlight: PaperHighlight) => void;
    addAnnotation: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
    activeHighlight: PaperHighlight | null;
    updateAnnotation: (annotationId: string, text: string) => void;
    removeAnnotation: (annotationId: string) => void;
    isSharing: boolean;
    handleShare: () => void;
    handleUnshare: () => void;
    id: string;
    memoizedOverviewContent: React.ReactNode;
    matchesCurrentCitation: (key: string, messageIndex: number) => boolean;
    handleCitationClickFromSummary: (citationKey: string, messageIndex: number) => void;
    setRightSideFunction: (value: string) => void;
    setExplicitSearchTerm: (value: string) => void;
    messages: ChatMessage[];
    hasMoreMessages: boolean;
    isLoadingMoreMessages: boolean;
    fetchMoreMessages: () => void;
    memoizedMessages: React.ReactNode;
    isStreaming: boolean;
    streamingChunks: string[];
    streamingReferences: Reference | undefined;
    handleCitationClick: (key: string, messageIndex: number) => void;
    displayedText: string;
    isTyping: boolean;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    handleSubmit: (e: React.FormEvent<HTMLFormElement> | null) => void;
    chatInputFormRef: React.RefObject<HTMLFormElement | null>;
    userMessageReferences: string[];
    setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
    currentMessage: string;
    setCurrentMessage: (value: string) => void;
    handleTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    inputMessageRef: React.RefObject<HTMLTextAreaElement | null>;
    creditUsage: CreditUsage | null;
    responseStyle: ResponseStyle | null;
    selectedModel: string;
    availableModels: Record<string, string>;
    setSelectedModel: (value: string) => void;
    setResponseStyle: (value: ResponseStyle) => void;
    nextMonday: Date;
    isMobile: boolean;
    messagesContainerRef: React.RefObject<HTMLDivElement | null>;
    setPendingStarterQuestion: (question: string) => void;
    handleScroll: () => void;
}

export function SidePanelContent({
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
    isMobile,
    messagesContainerRef,
    setPendingStarterQuestion,
    handleScroll,
}: SidePanelContentProps) {
    const heightClass = isMobile ? "h-[calc(100vh-128px)]" : "h-[calc(100vh-64px)]";

    return (
        <>
            {
                rightSideFunction !== 'Focus' && (
                    <div className="flex-grow h-full overflow-hidden">
                        {
                            rightSideFunction === 'Notes' && (
                                <div className='p-2 w-full h-full flex flex-col'>
                                    <div className="flex justify-between items-center mb-2 flex-shrink-0">
                                        <div className="flex items-center gap-2">
                                            <div className="text-xs text-gray">
                                                Length: {paperNoteContent?.length} characters
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
                                                <div className="prose dark:prose-invert !max-w-full text-sm">
                                                    <Markdown
                                                        remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
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
                                            onChange={handleNotesChange}
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
                                <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto`}>
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
                            rightSideFunction === 'Share' && paperData && (
                                <div className={`flex flex-col ${heightClass} p-4 space-y-4`}>
                                    <h3 className="text-lg font-semibold">Share Paper</h3>
                                    {paperData.share_id ? (
                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground">This paper is currently public. Anyone with the link can view it.</p>
                                            <div className="flex items-center space-x-2">
                                                <Input
                                                    readOnly
                                                    value={`${window.location.origin}/paper/share/${paperData.share_id}`}
                                                    className="flex-1"
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={async () => {
                                                        await navigator.clipboard.writeText(`${window.location.origin}/paper/share/${paperData.share_id}`);
                                                        toast.success("Link copied!");
                                                    }}
                                                >
                                                    Copy Link
                                                </Button>
                                            </div>
                                            <Button
                                                variant="destructive"
                                                onClick={handleUnshare}
                                                disabled={isSharing}
                                                className="w-fit"
                                            >
                                                {isSharing ? <Loader className="animate-spin mr-2 h-4 w-4" /> : null}
                                                <LockIcon /> Make Private
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground">Make this paper public to share it with others via a unique link. All of your highlights and annotations will be visible to anyone with the link. Your chat and notes remain private.</p>
                                            <Button
                                                onClick={handleShare}
                                                disabled={isSharing}
                                                className="w-fit"
                                            >
                                                {isSharing ? <Loader className="animate-spin mr-2 h-4 w-4" /> : null}
                                                <Share2Icon /> Share
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )
                        }
                        {/* Paper Images Section - Disabled pending extraction improvements */}
                        {/* {
                rightSideFunction === 'Figures' && (
                    <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto`}>
                        <PaperImageView paperId={id} />
                    </div>
                )
            } */}
                        {
                            rightSideFunction === 'Overview' && paperData.summary && (
                                <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto m-2 relative animate-fade-in`}>
                                    {/* Paper Metadata Section */}
                                    <div className="prose dark:prose-invert !max-w-full text-sm">
                                        {paperData.title && (
                                            <h1 className="text-2xl font-bold">{paperData.title}</h1>
                                        )}
                                        {memoizedOverviewContent}
                                        {
                                            paperData.summary_citations && paperData.summary_citations.length > 0 && (
                                                <div className="mt-0 pt-0 border-t border-gray-300 dark:border-gray-700" id="references-section">
                                                    <h4 className="text-sm font-semibold mb-2">References</h4>
                                                    <ul className="list-none p-0">
                                                        {paperData.summary_citations.map((citation, index) => (
                                                            <div
                                                                key={index}
                                                                className={`flex flex-row gap-2 ${matchesCurrentCitation(`${citation.index}`, 0) ? 'bg-blue-100 dark:bg-blue-900 rounded p-1 transition-colors duration-300' : ''}`}
                                                                id={`citation-${citation.index}-${index}`}
                                                                onClick={() => handleCitationClickFromSummary(`${citation.index}`, 0)}
                                                            >
                                                                <div className={`text-xs text-secondary-foreground`}>
                                                                    <span>{citation.index}</span>
                                                                </div>
                                                                <div
                                                                    id={`citation-ref-${citation.index}-${index}`}
                                                                    className={`text-xs text-secondary-foreground
                                                    `}>
                                                                    {citation.text}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        <div className="sticky bottom-4 right-4 flex justify-end">
                                            <Button
                                                variant="default"
                                                className="w-fit bg-blue-500 hover:bg-blue-400 dark:hover:bg-blue-600 cursor-pointer z-10 shadow-md"
                                                onClick={() => {
                                                    setRightSideFunction('Chat');
                                                }}
                                            >
                                                <Sparkle className="mr-1" />
                                                Ask a Question
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )
                        }
                        {
                            rightSideFunction === 'Audio' && (
                                <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto`}>
                                    <AudioOverview
                                        paper_id={id}
                                        paper_title={paperData.title}
                                        setExplicitSearchTerm={setExplicitSearchTerm} />
                                </div>
                            )
                        }
                        {
                            rightSideFunction === 'Chat' && (
                                <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto`}>
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
                                        className={`flex-1 overflow-y-auto space-y-2 transition-all duration-300 ease-in-out ${isStreaming ? 'pb-24' : ''}`}
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
                                                <div className='grid grid-cols-1 gap-2 mt-2'>
                                                    {paperData.starter_questions && paperData.starter_questions.length > 0 ? (
                                                        paperData.starter_questions.slice(0, 5).map((question, i) => (
                                                            <Button
                                                                key={i}
                                                                variant="outline"
                                                                className="text-sm font-medium p-2 max-w-full whitespace-normal h-auto text-left justify-start break-words bg-background text-secondary-foreground hover:bg-secondary/50 border-1 hover:translate-y-0.5 transition-transform duration-200"
                                                                onClick={() => {
                                                                    setCurrentMessage(question);
                                                                    inputMessageRef.current?.focus();
                                                                    chatInputFormRef.current?.scrollIntoView({
                                                                        behavior: 'smooth',
                                                                        block: 'nearest',
                                                                        inline: 'nearest',
                                                                    });
                                                                    setPendingStarterQuestion(question);
                                                                }}
                                                            >
                                                                {question}
                                                            </Button>
                                                        ))
                                                    ) : null}
                                                </div>
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
                                                            // Apply the custom component to text nodes
                                                            p: (props) => <CustomCitationLink
                                                                {...props}
                                                                handleCitationClick={handleCitationClick}
                                                                messageIndex={messages.length} // Use the next message index
                                                                citations={streamingReferences?.citations || []}
                                                            />,
                                                            li: (props) => <CustomCitationLink
                                                                {...props}
                                                                handleCitationClick={handleCitationClick}
                                                                messageIndex={messages.length} // Use the next message index
                                                                citations={streamingReferences?.citations || []}
                                                            />,
                                                            div: (props) => <CustomCitationLink
                                                                {...props}
                                                                handleCitationClick={handleCitationClick}
                                                                messageIndex={messages.length} // Use the next message index
                                                                citations={streamingReferences?.citations || []}
                                                            />,
                                                            td: (props) => <CustomCitationLink
                                                                {...props}
                                                                handleCitationClick={handleCitationClickFromSummary}
                                                                messageIndex={0}
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
                                                    </div>
                                                </div>
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
                                        <div
                                            className='rounded-md p-0.5 flex flex-col gap-2 bg-secondary'
                                        >
                                            {/* User message input area */}
                                            <Textarea
                                                value={currentMessage}
                                                onChange={handleTextareaChange}
                                                ref={inputMessageRef}
                                                placeholder="Ask something about this paper."
                                                className="border-none bg-secondary dark:bg-secondary rounded-md resize-none hover:resize-y p-2 focus-visible:outline-none focus-visible:ring-0 shadow-none min-h-[2rem] max-h-32"
                                                disabled={isStreaming || (creditUsage?.usagePercentage ?? 0) >= 100}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleSubmit(null);
                                                    }
                                                }}
                                            />
                                            <div className="flex flex-row justify-between gap-2">
                                                <div className="flex flex-row gap-2">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                className="w-fit text-sm"
                                                                title='Settings - Configure model and response style'
                                                                disabled={isStreaming}
                                                            >
                                                                <Route
                                                                    className="h-4 w-4 text-secondary-foreground"
                                                                />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent className="w-56">
                                                            <DropdownMenuSub>
                                                                <DropdownMenuSubTrigger className="flex items-center">
                                                                    <Sparkle className="mr-2 h-4 w-4" />
                                                                    <span>Model {selectedModel ? `(${availableModels[selectedModel]})` : ''}</span>
                                                                </DropdownMenuSubTrigger>
                                                                <DropdownMenuSubContent>
                                                                    {Object.entries(availableModels).map(([key, value]) => (
                                                                        <DropdownMenuItem
                                                                            key={key}
                                                                            onClick={() => setSelectedModel(key)}
                                                                            className="flex items-center justify-between"
                                                                        >
                                                                            <span>{value}</span>
                                                                            {selectedModel === key && (
                                                                                <Check className="h-4 w-4 text-green-500" />
                                                                            )}
                                                                        </DropdownMenuItem>
                                                                    ))}
                                                                </DropdownMenuSubContent>
                                                            </DropdownMenuSub>

                                                            <DropdownMenuSub>
                                                                <DropdownMenuSubTrigger className="flex items-center">
                                                                    <Feather className="mr-2 h-4 w-4" />
                                                                    <span>Response Style {responseStyle ? `(${responseStyle})` : ''}</span>
                                                                </DropdownMenuSubTrigger>
                                                                <DropdownMenuSubContent>
                                                                    {Object.values(ResponseStyle).map((style) => (
                                                                        <DropdownMenuItem
                                                                            key={style}
                                                                            onClick={() => {
                                                                                setResponseStyle(style);
                                                                                setRightSideFunction('Chat');
                                                                            }}
                                                                            className="flex items-center justify-between"
                                                                        >
                                                                            <span>{style}</span>
                                                                            {style === responseStyle && (
                                                                                <Check className="h-4 w-4 text-green-500" />
                                                                            )}
                                                                        </DropdownMenuItem>
                                                                    ))}
                                                                </DropdownMenuSubContent>
                                                            </DropdownMenuSub>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                                <Button
                                                    type="submit"
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            handleSubmit(null);
                                                        }
                                                    }}
                                                    variant="default"
                                                    className="w-fit rounded-full h-fit !px-2 py-2 bg-blue-500 hover:bg-blue-400"
                                                    disabled={isStreaming}
                                                >
                                                    <ArrowUp
                                                        className="h-4 w-4 rounded-full"
                                                        aria-hidden="true"
                                                    />
                                                </Button>
                                            </div>
                                        </div>
                                        {/* Chat Credit Usage Display */}
                                        {creditUsage && creditUsage.showWarning && (
                                            <div className={`text-xs px-2 py-1 ${creditUsage.isCritical ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} justify-between flex`}>
                                                <div className="font-semibold">{creditUsage.used} credits used</div>
                                                <div className="font-semibold">
                                                    <HoverCard>
                                                        <HoverCardTrigger asChild>
                                                            <span>{creditUsage.remaining} credits remaining</span>
                                                        </HoverCardTrigger>
                                                        <HoverCardContent side="top" className="w-48">
                                                            <p className="text-sm">Resets on {nextMonday.toLocaleDateString()}</p>
                                                        </HoverCardContent>
                                                    </HoverCard>
                                                    <Link
                                                        href="/pricing"
                                                        className="text-blue-500 hover:text-blue-700 ml-1"
                                                    >
                                                        Upgrade
                                                    </Link>
                                                </div>
                                            </div>
                                        )}
                                    </form>
                                </div>
                            )
                        }
                    </div>
                )
            }
        </>
    )
}
