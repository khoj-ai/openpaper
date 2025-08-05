'use client';

import { useEffect, useState } from 'react';
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

// Define the expected structure of the response from the share endpoint
interface SharedPaperResponse {
    paper: PaperData;
    highlights: PaperHighlight[];
    annotations: PaperHighlightAnnotation[];
}

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

    const handleHighlightClick = (highlight: PaperHighlight) => {
        // Allow clicking highlights to potentially scroll/focus, but no editing
        setActiveHighlight(highlight);
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen">Loading shared paper...</div>;
    }

    if (error) {
        return <div className="flex justify-center items-center h-screen text-red-500">{error}</div>;
    }

    if (!paperData) {
        return <div className="flex justify-center items-center h-screen">Shared paper data not found.</div>;
    }


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
                        <div className="w-full h-full overflow-y-auto p-4">
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
                <div className="flex-1 border-r dark:border-gray-800 border-gray-200 h-full overflow-hidden">
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

                {/* Right Side: Annotations View */}
                <div className="w-1/3 h-full overflow-y-auto p-4">
                    <PaperMetadata
                        paperData={paperData}
                        hasMessages={false} // Assuming no messages in read-only mode
                        readonly={true} // Set to true for read-only mode
                    />
                    <AnnotationsView
                        highlights={highlights}
                        annotations={annotations}
                        onHighlightClick={handleHighlightClick}
                        activeHighlight={activeHighlight}
                        readonly={true}
                    />
                </div>
            </div>
        </div>
    );
}
