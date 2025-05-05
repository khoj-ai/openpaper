'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PdfViewer } from '@/components/PdfViewer';
import { AnnotationsView } from '@/components/AnnotationsView';
import { fetchFromApi } from '@/lib/api';
import { PaperData, PaperHighlight, PaperHighlightAnnotation } from '@/lib/schema';
import { useHighlights } from '@/components/hooks/PdfHighlight';
import PaperMetadata from '@/components/PaperMetadata';

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
                console.log("Fetched shared paper data:", response);
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
        // You might want to implement scrolling the PDF viewer to the highlight here
        // This depends on how PdfViewer handles focusing on specific highlights
        console.log("Clicked highlight (read-only):", highlight.id);
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
