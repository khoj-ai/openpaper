'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PdfViewer } from '@/components/PdfViewer';
import { AnnotationsView } from '@/components/AnnotationsView';
import { fetchFromApi } from '@/lib/api';
import { PaperData, PaperHighlight, PaperHighlightAnnotation, ChatMessage } from '@/lib/schema';
import { useHighlights } from '@/components/hooks/PdfHighlight';
import PaperMetadata from '@/components/PaperMetadata';
import { useIsMobile } from '@/hooks/use-mobile';
import { Book, Box, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

import { PaperSidebar } from '@/components/PaperSidebar';
import { Lightbulb, Highlighter, MessageCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { CopyableTable } from '@/components/AnimatedMarkdown';
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { BasicUser } from '@/lib/auth';
import { Avatar } from '@/components/ui/avatar';
import EmptyConversationState from './EmptyConversationState';

// Define the expected structure of the response from the share endpoint
interface SharedPaperResponse {
    paper: PaperData;
    highlights: PaperHighlight[];
    annotations: PaperHighlightAnnotation[];
    owner: BasicUser;
}



export default function SharedPaperView() {
    const params = useParams();
    const shareId = params.id as string;

    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [highlights, setHighlights] = useState<PaperHighlight[]>([]);
    const [annotations, setAnnotations] = useState<PaperHighlightAnnotation[]>([]);
    const [owner, setOwner] = useState<BasicUser | undefined>(undefined);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const {
        activeHighlight,
        setActiveHighlight,
    } = useHighlights(shareId);
    const isMobile = useIsMobile();
    const [mobileView, setMobileView] = useState<'reader' | 'panel'>('reader');
    const [rightSideFunction, setRightSideFunction] = useState('Overview');
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
    const [activeCitationMessageIndex, setActiveCitationMessageIndex] = useState<number | null>(null);
    const [explicitSearchTerm, setExplicitSearchTerm] = useState<string>();

    const dynamicPaperToolset = useMemo(() => {
        const navItems = [
            { name: 'Chat', icon: MessageCircle },
            { name: 'Annotations', icon: Highlighter },
        ];
        if (paperData?.summary) {
            navItems.unshift({ name: 'Overview', icon: Lightbulb });
        }
        return { nav: navItems };
    }, [paperData?.summary]);


    const handleHighlightClick = useCallback((highlight: PaperHighlight) => {
        // Allow clicking highlights to potentially scroll/focus, but no editing
        setActiveHighlight(highlight);
    }, [setActiveHighlight]);

    const matchesCurrentCitation = useCallback((key: string, messageIndex: number) => {
        return activeCitationKey === key.toString() && activeCitationMessageIndex === messageIndex;
    }, [activeCitationKey, activeCitationMessageIndex]);

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
        }

        // Clear the highlight after a few seconds
        setTimeout(() => setActiveCitationKey(null), 3000);
    }, []);

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
                    table: CopyableTable,
                }}
            >
                {paperData.summary}
            </Markdown>
        );
    }, [paperData?.summary, paperData?.summary_citations, handleCitationClickFromSummary]);

    const memoizedMessages = useMemo(() => {
        return messages.map((msg, index) => (
            <div
                key={`${msg.id || `msg-${index}`}-${index}-${msg.role}-${msg.content.slice(0, 20).replace(/\s+/g, '')}`} // Use a stable and unique key
                className='flex flex-row gap-2 items-end'
            >
                {
                    msg.role === 'user' && owner && (
                        <Avatar className="h-6 w-6">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {owner.picture ? (<img src={owner.picture} alt={owner.name} />) : (<User size={16} />)}
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
                            table: CopyableTable,
                        }}>
                        {msg.content}
                    </Markdown>
                    {msg.references && msg.references.citations && msg.references.citations.length > 0 ? (
                        <div className="mt-0 pt-0 border-t border-gray-300 dark:border-gray-700" id="references-section">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold mb-2">References</h4>
                                {msg.role === 'assistant' && (
                                    <ChatMessageActions message={msg.content} references={msg.references} />
                                )}
                            </div>
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
                        ) : (
                            msg.role === 'assistant' && (
                                <ChatMessageActions message={msg.content} references={msg.references} />
                            )
                        )}
                </div>
            </div>
        ));
    }, [messages, handleCitationClick, matchesCurrentCitation]);

    useEffect(() => {
        if (!shareId) {
            setError("Share ID is missing.");
            setLoading(false);
            return;
        }

        const fetchSharedData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response: SharedPaperResponse = await fetchFromApi(`/api/paper/share?id=${shareId}`);
                setPaperData(response.paper);
                setHighlights(response.highlights || []);
                setAnnotations(response.annotations || []);
                setOwner(response.owner);
                // Set default rightSideFunction based on summary availability
                if (!response.paper.summary) {
                    setRightSideFunction('Chat');
                }
            } catch (err) {
                console.error("Error fetching shared paper data:", err);
                setError("Failed to load shared paper. The link might be invalid or expired.");
                setPaperData(null);
                setHighlights([]);
                setAnnotations([]);
                setOwner(undefined);
            } finally {
                setLoading(false);
            }
        };

        const fetchConversation = async () => {
            try {
                const response = await fetchFromApi(`/api/conversation/share/${shareId}`);
                setMessages(response.messages || []);
            } catch (err) {
                console.error("Error fetching shared conversation data:", err);
                setMessages([]);
            }
        };

        fetchSharedData();
        fetchConversation();
    }, [shareId]);


    if (loading) {
        return <div className="flex justify-center items-center h-screen">Loading shared paper...</div>;
    }

    if (error) {
        return <div className="flex justify-center items-center h-screen text-red-500">{error}</div>;
    }

    if (!paperData) {
        return <div className="flex justify-center items-center h-screen">Shared paper data not found.</div>;
    }


    const heightClass = isMobile ? "h-[calc(100vh-128px)]" : "h-[calc(100vh-64px)]";


    if (isMobile) {
        return (
            <div className="flex flex-col w-full h-[calc(100vh-64px)]">
                <div className="flex-grow overflow-auto min-h-0">
                    {mobileView === 'reader' ? (
                        <div className="w-full h-full">
                            {paperData.file_url ? (
                                <PdfViewer
                                    pdfUrl={paperData.file_url}
                                    highlights={highlights}
                                    activeHighlight={activeHighlight}
                                    setUserMessageReferences={() => { }}
                                    setSelectedText={() => { }}
                                    setTooltipPosition={() => { }}
                                    setIsAnnotating={() => { }}
                                    setIsHighlightInteraction={() => { }}
                                    isHighlightInteraction={false}
                                    setHighlights={() => { }}
                                    explicitSearchTerm={explicitSearchTerm}
                                    selectedText={''}
                                    tooltipPosition={null}
                                    setActiveHighlight={setActiveHighlight}
                                    addHighlight={async () => { throw new Error("Read-only"); }}
                                    loadHighlights={async () => { }}
                                    removeHighlight={() => { }}
                                    handleTextSelection={() => { }}
                                    renderAnnotations={() => { }}
                                    annotations={[]}
                                />
                            ) : (
                                <div className="flex justify-center items-center h-full">PDF could not be loaded.</div>
                            )}
                        </div>
                    ) : (
                        <div className="w-full h-full flex flex-row relative pr-[60px]">
                            <div className="flex-grow overflow-y-auto">
                                {rightSideFunction === 'Annotations' && owner && (
                                    <>
                                        <AnnotationsView
                                            highlights={highlights}
                                            annotations={annotations}
                                            onHighlightClick={handleHighlightClick}
                                            activeHighlight={activeHighlight}
                                            user={owner}
                                            readonly={true}
                                        />
                                    </>
                                )}
                                {rightSideFunction === 'Overview' && (
                                                                        <div className={'flex flex-col md:px-2 m-2 relative animate-fade-in'}>
                                                                             <PaperMetadata
                                                                                paperData={paperData}
                                                                             />                                        {paperData.summary && (
                                            <div className="prose dark:prose-invert !max-w-full text-sm mt-4">
                                                {memoizedOverviewContent}
                                                {paperData.summary_citations && paperData.summary_citations.length > 0 && (
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
                                                                    <div className={'text-xs text-secondary-foreground'}>
                                                                        <span>{citation.index}</span>
                                                                    </div>
                                                                    <div
                                                                        id={`citation-ref-${citation.index}-${index}`}
                                                                        className={'text-xs text-secondary-foreground'}
                                                                    >
                                                                        {citation.text}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {rightSideFunction === 'Chat' && (
                                    <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto m-2 relative animate-fade-in`}>
                                        {messages.length === 0 ? (
                                            <EmptyConversationState owner={owner} />
                                        ) : (
                                            memoizedMessages
                                        )}
                                    </div>
                                )}
                            </div>
                            <PaperSidebar
                                rightSideFunction={rightSideFunction}
                                setRightSideFunction={setRightSideFunction}
                                PaperToolset={dynamicPaperToolset}
                            />
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
            <div className="flex flex-row flex-1 overflow-hidden">
                {/* Left Side: PDF Viewer */}
                <div className="w-3/5 border-r dark:border-gray-800 border-gray-200 h-full overflow-hidden">
                    {paperData.file_url ? (
                        <PdfViewer
                            pdfUrl={paperData.file_url}
                            highlights={highlights}
                            activeHighlight={activeHighlight}
                            // Pass empty/dummy handlers or flags to disable interactions
                            // Assuming PdfViewer can operate read-only without these handlers
                            setUserMessageReferences={() => { }}
                            setSelectedText={() => { }}
                            setTooltipPosition={() => { }}
                            explicitSearchTerm={explicitSearchTerm}
                            setIsAnnotating={() => { }}
                            setIsHighlightInteraction={() => { }}
                            isHighlightInteraction={false}
                            setHighlights={() => { }}
                            selectedText={''}
                            tooltipPosition={null}
                            setActiveHighlight={setActiveHighlight} // Allow setting active for viewing
                            addHighlight={async () => { throw new Error("Read-only"); }}
                            loadHighlights={async () => { }} // Load is done initially
                            removeHighlight={() => { }}
                            handleTextSelection={() => { }} // Disable text selection interaction
                            renderAnnotations={() => { }}
                            annotations={[]} // Pass empty or actual annotations if viewer uses them
                        // Add a specific readOnly prop if your PdfViewer supports it
                        // readOnly={true}
                        />
                    ) : (
                        <div className="flex justify-center items-center h-full">PDF could not be loaded.</div>
                    )}
                </div>

                {/* Right Side: Sidebar and Content */}
                <div className="w-2/5 h-full flex flex-row relative pr-[60px]">
                    <div className="flex-grow">
                        {rightSideFunction === 'Annotations' && owner && (
                            <>
                                <PaperMetadata
                                    paperData={paperData}
                                />
                                <AnnotationsView
                                    highlights={highlights}
                                    annotations={annotations}
                                    onHighlightClick={handleHighlightClick}
                                    activeHighlight={activeHighlight}
                                    readonly={true}
                                    user={owner}
                                />
                            </>
                        )}
                        {rightSideFunction === 'Overview' && paperData.summary && (
                            <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto m-2 relative animate-fade-in`}>
                                {/* Paper Metadata Section */}
                                                                 <PaperMetadata
                                                                    paperData={paperData}
                                                                />                                <div className="prose dark:prose-invert !max-w-full text-sm">
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
                                </div>
                            </div>
                        )}
                        {rightSideFunction === 'Chat' && (
                            <div className={`flex flex-col ${heightClass} md:px-2 overflow-y-auto m-2 relative animate-fade-in`}>
                                {messages.length === 0 ? (
                                    <EmptyConversationState owner={owner} />
                                ) : (
                                    memoizedMessages
                                )}
                            </div>
                        )}
                    </div>
                    <PaperSidebar
                        rightSideFunction={rightSideFunction}
                        setRightSideFunction={setRightSideFunction}
                        PaperToolset={dynamicPaperToolset}
                    />
                </div>
            </div>
        </div>
    );
}
