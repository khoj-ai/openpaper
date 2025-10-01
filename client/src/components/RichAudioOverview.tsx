"use client";

import { useState, useRef } from "react";
import { useIsMobile } from "@/lib/useMobile";
import { Button } from "@/components/ui/button";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { X } from "lucide-react";
import CustomCitationLink from "@/components/utils/CustomCitationLink";
import { ChatMessageActions } from "@/components/ChatMessageActions";
import { AudioOverview, Reference, PaperItem } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import { PdfViewer } from "@/components/PdfViewer";

interface RichAudioOverviewProps {
    audioOverview: AudioOverview;
    papers?: PaperItem[];
    onClose?: () => void;
}

export const RichAudioOverview = ({
    audioOverview,
    papers,
    onClose,
}: RichAudioOverviewProps) => {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState<string | null>(null);
    const [isPdfVisible, setIsPdfVisible] = useState(false);
    const [highlightedInfo, setHighlightedInfo] = useState<{ paperId: string; messageIndex: number } | null>(null);
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const pdfContainerRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();

    const handleCitationClick = (key: string, messageIndex: number) => {
        const citationIndex = parseInt(key);
        const citation = audioOverview.citations.find(c => c.index === citationIndex);

        if (!citation) return;

        // If citation has paper_id, try to open the specific paper's PDF
        if (citation.paper_id && papers) {
            const paper = papers.find(p => p.id === citation.paper_id);
            if (paper && paper.file_url) {
                setPdfUrl(paper.file_url);
                setSearchTerm(citation.text);
                setIsPdfVisible(true);
                setHighlightedInfo({ paperId: citation.paper_id, messageIndex });

                // Ensure content is scrollable after PDF viewer opens
                setTimeout(() => {
                    if (scrollContainerRef.current) {
                        scrollContainerRef.current.scrollTop = 0;
                    }
                    // Reset PDF viewer scroll to show toolbar - delay to ensure PDF has loaded
                    setTimeout(() => {
                        const pdfContainer = document.getElementById('pdf-container');
                        if (pdfContainer) {
                            pdfContainer.scrollTop = 0;
                        }
                    }, 500);
                }, 100);
            }
        }

        setActiveCitationKey(key);
        setTimeout(() => setActiveCitationKey(null), 3000);
    };

    // Convert ReferenceCitation[] to Citation[] format for CustomCitationLink compatibility
    const convertedCitations = audioOverview.citations.map(c => ({
        key: String(c.index),
        reference: c.text,
        paper_id: c.paper_id
    }));

    // Create a reference object similar to chat messages for compatibility
    const references: Reference = {
        citations: convertedCitations
    };

    return (
        <div className="flex flex-row w-full h-full overflow-hidden">
            <div className={`flex flex-col h-full transition-all duration-500 ease-in-out ${isMobile ? (isPdfVisible ? 'hidden' : 'w-full') : (isPdfVisible ? 'w-1/3' : 'w-full')}`}>
                <div ref={scrollContainerRef} className="rich-audio-overview-scroll flex-1 w-full overflow-y-auto overflow-x-hidden transition-all duration-300 ease-in-out">
                    <div className={`space-y-4 w-full transition-all duration-300 ease-in-out ${isPdfVisible ? 'p-2' : 'p-6'}`}>
                    {/* Header */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="flex-1">
                            <h2 className="text-2xl font-bold text-primary mb-2">
                                {audioOverview.title}
                            </h2>
                        </div>
                        {onClose && (
                            <Button onClick={onClose} variant="ghost" size="icon" className="ml-4">
                                <X className="h-6 w-6" />
                            </Button>
                        )}
                    </div>

                    {/* Transcript Content */}
                    <div className="relative group prose dark:prose-invert !max-w-full transition-all duration-300 ease-in-out">
                        <Markdown
                            remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                p: (props) => (
                                    <CustomCitationLink
                                        {...props}
                                        handleCitationClick={handleCitationClick}
                                        messageIndex={0}
                                        citations={convertedCitations}
                                        papers={papers || []}
                                    />
                                ),
                                li: (props) => (
                                    <CustomCitationLink
                                        {...props}
                                        handleCitationClick={handleCitationClick}
                                        messageIndex={0}
                                        citations={convertedCitations}
                                        papers={papers || []}
                                    />
                                ),
                                div: (props) => (
                                    <CustomCitationLink
                                        {...props}
                                        handleCitationClick={handleCitationClick}
                                        messageIndex={0}
                                        citations={convertedCitations}
                                        papers={papers || []}
                                    />
                                ),
                                td: (props) => (
                                    <CustomCitationLink
                                        {...props}
                                        handleCitationClick={handleCitationClick}
                                        messageIndex={0}
                                        citations={convertedCitations}
                                        papers={papers || []}
                                    />
                                ),
                                table: (props) => (
                                    <div className="overflow-x-auto">
                                        <table {...props} className="min-w-full border-collapse" />
                                    </div>
                                ),
                            }}
                        >
                            {audioOverview.transcript}
                        </Markdown>

                        {/* Message Actions */}
                        <ChatMessageActions
                            message={audioOverview.transcript}
                            references={references}
                        />

                        {/* References Section */}
                        {audioOverview.citations && audioOverview.citations.length > 0 && (
                            <div>
                                <div
                                    className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-700"
                                    id="references-section"
                                >
                                    <h4 className="text-sm font-semibold mb-2">References</h4>
                                </div>
                                {papers && papers.length > 0 ? (
                                    <ReferencePaperCards
                                        citations={convertedCitations}
                                        papers={papers}
                                        messageId={audioOverview.id}
                                        messageIndex={0}
                                        highlightedPaper={
                                            highlightedInfo && highlightedInfo.messageIndex === 0
                                                ? highlightedInfo.paperId
                                                : null
                                        }
                                        onHighlightClear={() => setHighlightedInfo(null)}
                                    />
                                ) : (
                                    <div className="space-y-2">
                                        {audioOverview.citations.map((citation) => (
                                            <div
                                                key={citation.index}
                                                className={`p-3 rounded-lg border text-sm transition-colors ${
                                                    activeCitationKey === String(citation.index)
                                                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                                                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                                }`}
                                            >
                                                <span className="font-medium text-blue-600 dark:text-blue-400">
                                                    [{citation.index}]
                                                </span>{' '}
                                                {citation.text}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>

            {/* PDF Viewer Panel */}
            {isPdfVisible && (
                <div className={`${isMobile ? 'w-full relative' : 'w-2/3 border-l-2'} flex flex-col h-full overflow-hidden animate-in slide-in-from-right-5 duration-500 ease-in-out`}>
                    {isMobile && (
                        <Button
                            onClick={() => setIsPdfVisible(false)}
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 z-20 bg-background rounded-full"
                        >
                            <X className="h-6 w-6" />
                        </Button>
                    )}
                    <div className="flex-1 h-full overflow-hidden transition-all duration-300 ease-in-out">
                        {pdfUrl && (
                            <PdfViewer
                                pdfUrl={pdfUrl}
                                explicitSearchTerm={searchTerm || undefined}
                                highlights={[]}
                                activeHighlight={null}
                                setUserMessageReferences={() => { }}
                                setSelectedText={() => { }}
                                setTooltipPosition={() => { }}
                                setIsAnnotating={() => { }}
                                setIsHighlightInteraction={() => { }}
                                isHighlightInteraction={false}
                                setHighlights={() => { }}
                                selectedText={''}
                                tooltipPosition={null}
                                setActiveHighlight={() => { }}
                                addHighlight={async () => { throw new Error("Read-only"); }}
                                loadHighlights={async () => { }}
                                removeHighlight={() => { }}
                                handleTextSelection={() => { }}
                                renderAnnotations={() => { }}
                                annotations={[]}
                                setAddedContentForPaperNote={() => { }}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
