'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PdfViewer } from '@/components/PdfViewer';
import { AnnotationsView } from '@/components/AnnotationsView';
import { fetchFromApi } from '@/lib/api';
import { PaperData, PaperHighlight, PaperHighlightAnnotation } from '@/lib/schema';
import { useHighlights } from '@/components/hooks/PdfHighlight';
import PaperMetadata from '@/components/PaperMetadata';
import { useIsMobile } from '@/hooks/use-mobile';
import { Book, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you

import { PaperSidebar } from '@/components/PaperSidebar';
import { Lightbulb, Highlighter } from 'lucide-react';
import Markdown from 'react-markdown';
import CustomCitationLink from '@/components/utils/CustomCitationLink';

// Define the expected structure of the response from the share endpoint
interface SharedPaperResponse {
    paper: PaperData;
    highlights: PaperHighlight[];
    annotations: PaperHighlightAnnotation[];
}

const SharedPaperToolset = {
    nav: [
        { name: 'Overview', icon: Lightbulb },
        { name: 'Annotations', icon: Highlighter },
    ],
};

export default function SharedPaperView() {
    const params = useParams();
    const shareId = params.id as string;

    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [highlights, setHighlights] = useState<PaperHighlight[]>([]);
    const [annotations, setAnnotations] = useState<PaperHighlightAnnotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const {
        activeHighlight,
        setActiveHighlight,
    } = useHighlights(shareId);
    const isMobile = useIsMobile();
    const [mobileView, setMobileView] = useState<'reader' | 'panel'>('reader');
    const [rightSideFunction, setRightSideFunction] = useState('Annotations');
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
    const [activeCitationMessageIndex, setActiveCitationMessageIndex] = useState<number | null>(null);
    const [explicitSearchTerm, setExplicitSearchTerm] = useState<string>();

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
            } catch (err) {
                console.error("Error fetching shared paper data:", err);
                setError("Failed to load shared paper. The link might be invalid or expired.");
                setPaperData(null);
                setHighlights([]);
                setAnnotations([]);
            } finally {
                setLoading(false);
            }
        };

        fetchSharedData();
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
                                    setAddedContentForPaperNote={() => { }}
                                />
                            ) : (
                                <div className="flex justify-center items-center h-full">PDF could not be loaded.</div>
                            )}
                        </div>
                    ) : (
                        <div className="w-full h-full flex flex-row relative pr-[60px]">
                            <div className="flex-grow overflow-y-auto">
                                {rightSideFunction === 'Annotations' && (
                                    <>
                                        <PaperMetadata
                                            paperData={paperData}
                                            hasMessages={false}
                                            readonly={true}
                                        />
                                        <AnnotationsView
                                            highlights={highlights}
                                            annotations={annotations}
                                            onHighlightClick={handleHighlightClick}
                                            activeHighlight={activeHighlight}
                                            readonly={true}
                                        />
                                    </>
                                )}
                                {rightSideFunction === 'Overview' && (
                                    <div className={'flex flex-col md:px-2 m-2 relative animate-fade-in'}>
                                        {paperData.summary && (
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
                            </div>
                            <PaperSidebar
                                rightSideFunction={rightSideFunction}
                                setRightSideFunction={setRightSideFunction}
                                PaperToolset={SharedPaperToolset}
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
                            setAddedContentForPaperNote={() => { }}
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
                        {rightSideFunction === 'Annotations' && (
                            <>
                                <PaperMetadata
                                    paperData={paperData}
                                    hasMessages={false}
                                    readonly={true}
                                />
                                <AnnotationsView
                                    highlights={highlights}
                                    annotations={annotations}
                                    onHighlightClick={handleHighlightClick}
                                    activeHighlight={activeHighlight}
                                    readonly={true}
                                />
                            </>
                        )}
                        {rightSideFunction === 'Overview' && paperData.summary && (
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
                                </div>
                            </div>
                        )}
                    </div>
                    <PaperSidebar
                        rightSideFunction={rightSideFunction}
                        setRightSideFunction={setRightSideFunction}
                        PaperToolset={SharedPaperToolset}
                    />
                </div>
            </div>
        </div>
    );
}
