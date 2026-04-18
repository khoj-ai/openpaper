'use client';

import { PdfHighlighterViewer, RenderedHighlightPosition } from '@/components/PdfHighlighterViewer';
import { Button } from '@/components/ui/button';
import { fetchFromApi } from '@/lib/api';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';


import {
    AudioLines,
    Highlighter,
    Lightbulb,
    MessageCircle,
} from 'lucide-react';
import { toast } from "sonner";

import { useAnnotations } from '@/components/hooks/PdfAnnotation';
import { useHighlighterHighlights } from '@/components/hooks/PdfHighlighterHighlights';

import {
    PaperData,
    PaperHighlight,
    PaperUploadJobStatusResponse,
} from '@/lib/schema';

import { PaperSidebar } from '@/components/PaperSidebar';
import { PaperStatus, PaperStatusEnum } from '@/components/utils/PdfStatus';
import { useAuth } from '@/lib/auth';

import PaperViewSkeleton from '@/components/PaperViewSkeleton';
import ReportSkeleton from '@/components/ReportSkeleton';

import { SidePanelContent } from '@/components/SidePanelContent';
import { useIsMobile } from '@/hooks/use-mobile';
import { Book, Box } from 'lucide-react';

const OverviewTool = {
    name: "Overview",
    label: "Overview",
    icon: Lightbulb,
}

const ChatTool = {
    name: "Chat",
    label: "Show chat",
    icon: MessageCircle,
}

const AnnotationsTool = {
    name: "Annotations",
    label: "All annotations",
    icon: Highlighter,
}

const AudioTool = {
    name: "Audio",
    label: "Audio",
    icon: AudioLines,
}

const PaperToolset = {
    nav: [
        ChatTool,
        OverviewTool,
        AnnotationsTool,
        AudioTool,
    ],
}

export default function PaperView() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const id = params.id as string;
    const { user, loading: authLoading } = useAuth();
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [loading, setLoading] = useState(true);

    const {
        highlights,
        setHighlights,
        selectedText,
        setSelectedText,
        tooltipPosition,
        setTooltipPosition,
        setIsAnnotating,
        isAnnotating,
        isHighlightInteraction,
        setIsHighlightInteraction,
        activeHighlight,
        setActiveHighlight,
        addHighlight,
        removeHighlight,
        fetchHighlights
    } = useHighlighterHighlights(id);

    const {
        annotations,
        addAnnotation,
        removeAnnotation,
        updateAnnotation,
        renderAnnotations,
        refreshAnnotations,
    } = useAnnotations(id);

    const [annotationCardsVisible, setAnnotationCardsVisible] = useState(false);
    /** When Annotations side panel is open, compose first note / reply here instead of margin cards */
    const [composeHighlightId, setComposeHighlightId] = useState<string | null>(null);
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
    const [activeCitationMessageIndex, setActiveCitationMessageIndex] = useState<number | null>(null);
    const [explicitSearchTerm, setExplicitSearchTerm] = useState<string | undefined>(undefined);
    const [isSharing, setIsSharing] = useState(false);
    const [userMessageReferences, setUserMessageReferences] = useState<string[]>([]);
    const [renderedHighlightPositions, setRenderedHighlightPositions] = useState<Map<string, RenderedHighlightPosition>>(new Map());

    // Callback for when PDF highlight overlays are created (for assistant highlights)
    // Merges new positions with existing ones so positions persist even when pages are unloaded
    const handleOverlaysCreated = useCallback((positions: Map<string, RenderedHighlightPosition>) => {
        setRenderedHighlightPositions(prev => {
            const merged = new Map(prev);
            positions.forEach((pos, id) => {
                merged.set(id, pos);
            });
            return merged;
        });
    }, []);

    const [jobId, setJobId] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [sidePanelDisplayedText, setSidePanelDisplayedText] = useState('');
    const [elapsedTime, setElapsedTime] = useState(0);

    const [rightSideFunction, setRightSideFunction] = useState<string>('Overview');
    const annotationsPanelActive = rightSideFunction === 'Annotations';
    useEffect(() => {
        if (rightSideFunction !== 'Annotations') {
            setComposeHighlightId(null);
        }
    }, [rightSideFunction]);

    const [toolset, setToolset] = useState(PaperToolset);
    const initialRsfRef = useRef<string | null>(null);
    const hasInitializedRsf = useRef(false);

    // Capture the initial rsf from URL on first render
    useEffect(() => {
        if (initialRsfRef.current === null) {
            let rsf = searchParams.get('rsf')?.toLowerCase() || null;
            if (rsf === 'focus') rsf = 'read'; // legacy URL param when tool was named Focus
            initialRsfRef.current = rsf;
        }
    }, [searchParams]);

    useEffect(() => {
        if (paperData) {
            // Use the captured initial rsf value, not the current searchParams
            const rsf = hasInitializedRsf.current ? null : initialRsfRef.current;

            // Derive the available tools first
            const hasOverview = paperData.summary_citations && paperData.summary_citations.length > 0;
            const newNav = PaperToolset.nav.filter(tool => tool.name !== 'Overview' || hasOverview);

            const validTools = newNav.map(tool => tool.name.toLowerCase());

            // Only set from URL on first initialization
            if (!hasInitializedRsf.current) {
                hasInitializedRsf.current = true;
                if (rsf === 'read') {
                    setRightSideFunction('Read');
                } else if (rsf && validTools.includes(rsf)) {
                    const toolName = newNav.find(tool => tool.name.toLowerCase() === rsf);
                    setRightSideFunction(toolName ? toolName.name : 'Chat');
                } else if (hasOverview) {
                    setRightSideFunction('Overview');
                } else {
                    setRightSideFunction('Chat');
                }
            }

            // Update the toolset state for the UI
            setToolset({ nav: newNav });
        }
    }, [paperData]);

    useEffect(() => {
        // Only update URL after we've initialized from the original rsf
        if (!hasInitializedRsf.current) return;

        const params = new URLSearchParams(window.location.search);
        params.set('rsf', rightSideFunction.toLowerCase());
        router.replace(`${window.location.pathname}?${params.toString()}`);
    }, [rightSideFunction, router]);
    const [leftPanelWidth, setLeftPanelWidth] = useState(60); // percentage
    const [isDragging, setIsDragging] = useState(false);
    const isMobile = useIsMobile();
    const [mobileView, setMobileView] = useState<'reader' | 'panel'>('reader');

    const showAnnotationCards = annotationCardsVisible;
    const isReadMode = rightSideFunction === 'Read';

    /** Tracks the last non-Read panel so we can restore it when exiting focus mode. */
    const lastNonReadFunctionRef = useRef<string>('Chat');
    const prevRightSideRef = useRef(rightSideFunction);
    useEffect(() => {
        if (rightSideFunction === 'Read' && prevRightSideRef.current !== 'Read') {
            setAnnotationCardsVisible(false);
        }
        if (prevRightSideRef.current !== 'Read') {
            lastNonReadFunctionRef.current = prevRightSideRef.current;
        }
        prevRightSideRef.current = rightSideFunction;
    }, [rightSideFunction]);

    const handleToggleReadMode = useCallback(() => {
        if (isReadMode) {
            const target = lastNonReadFunctionRef.current;
            const validTools = toolset.nav.map(t => t.name);
            setRightSideFunction(validTools.includes(target) ? target : 'Chat');
        } else {
            setRightSideFunction('Read');
        }
    }, [isReadMode, toolset.nav]);

    const prevMobileViewRef = useRef<'reader' | 'panel'>(mobileView);
    const mobileReaderInitialHideRef = useRef(false);
    useEffect(() => {
        if (!isMobile) {
            prevMobileViewRef.current = mobileView;
            return;
        }
        const prev = prevMobileViewRef.current;
        if (mobileView === 'reader' && prev === 'panel') {
            setAnnotationCardsVisible(false);
        }
        if (mobileView === 'reader' && !mobileReaderInitialHideRef.current) {
            mobileReaderInitialHideRef.current = true;
            setAnnotationCardsVisible(false);
        }
        prevMobileViewRef.current = mobileView;
    }, [isMobile, mobileView]);

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
            const response: PaperUploadJobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${jobId}`);
            setLoadingMessage(response.celery_progress_message);

            if (response.status === 'completed') {
                setJobId(null);
            } else if (response.status === 'failed') {
                setJobId(null);
                toast.error("Failed to process your paper", {
                    description: "There was an error indexing your paper. Please try uploading again.",
                    duration: 10000,
                    action: {
                        label: "Go Home",
                        onClick: () => router.push('/'),
                    },
                });
            } else {
                setTimeout(() => pollJobStatus(jobId), 2000);
            }
        } catch (error) {
            console.error('Error polling job status:', error);
        }
    };

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
                let searchTerm = refValueText.replace(/^\[\^(\d+|[a-zA-Z]+)\]/, '').trim();

                // Only remove quotes if the text is actually wrapped in quotes
                if ((searchTerm.startsWith('"') && searchTerm.endsWith('"')) ||
                    (searchTerm.startsWith("'") && searchTerm.endsWith("'"))) {
                    searchTerm = searchTerm.substring(1, searchTerm.length - 1);
                }
                setExplicitSearchTerm(searchTerm);
            }
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
        // Position-backed highlights: PdfHighlighterViewer scrolls via scrollToHighlight only.
        // Do not set explicitSearchTerm — it triggers usePdfSearch goToMatch(0) (first occurrence)
        // and fights correct alignment when raw_text appears multiple times.
        if (highlight.raw_text && !highlight.position) {
            setExplicitSearchTerm(highlight.raw_text);
        } else {
            setExplicitSearchTerm(undefined);
        }
    }, []);


    useEffect(() => {
        if (!authLoading && !user) {
            // Redirect to login if user is not authenticated
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

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

        if (jobId) return;

        fetchPaper();
        refreshAnnotations();
        fetchHighlights();
    }, [id, jobId]);

    useEffect(() => {
        if (userMessageReferences.length > 0) {
            setRightSideFunction('Chat');
        }
    }, [userMessageReferences]);

    const matchesCurrentCitation = useCallback((key: string, messageIndex: number) => {
        return activeCitationKey === key.toString() && activeCitationMessageIndex === messageIndex;
    }, [activeCitationKey, activeCitationMessageIndex]);


    const refreshPdfUrl = useCallback(async (): Promise<string | null> => {
        try {
            const response: PaperData = await fetchFromApi(`/api/paper?id=${id}`);
            if (response.file_url) {
                setPaperData(response);
                return response.file_url;
            }
            return null;
        } catch (error) {
            console.error('Error refreshing PDF URL:', error);
            return null;
        }
    }, [id]);

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

    const onAnnotateViaSidePanel = useCallback((payload: { highlightId: string }) => {
        setComposeHighlightId(payload.highlightId);
    }, []);

    const onComposeHighlightDismiss = useCallback(
        (cancelledHighlightId?: string | null) => {
            setComposeHighlightId(null);
            setIsAnnotating(false);
            // End PDF "selected" emphasis when compose closes — otherwise activeHighlightStore
            // stays set and the paragraph keeps the active (0.4) tint after Save.
            setActiveHighlight(null);
            if (cancelledHighlightId == null || cancelledHighlightId === '') return;
            if (annotations.some((a) => a.highlight_id === cancelledHighlightId)) return;
            const h = highlights.find((x) => x.id === cancelledHighlightId);
            if (h) removeHighlight(h);
        },
        [annotations, highlights, removeHighlight, setActiveHighlight]
    );

    if (loading) return <PaperViewSkeleton />;

    if (!paperData) return <div>Paper not found</div>;

    const sidePanelProps = {
        rightSideFunction,
        paperData,
        annotations,
        highlights,
        handleHighlightClick,
        activeHighlight,
        isSharing,
        handleShare,
        handleUnshare,
        id,
        matchesCurrentCitation,
        handleCitationClickFromSummary,
        setRightSideFunction,
        setExplicitSearchTerm,
        handleCitationClick,
        userMessageReferences,
        setUserMessageReferences,
        renderedHighlightPositions,
        composeHighlightId,
        onComposeHighlightDismiss,
        addAnnotation,
    };

    if (isMobile) {
        return (
            <div className="flex flex-col w-full h-[calc(100vh-64px)]">
                <div className="flex-grow overflow-auto min-h-0">
                    {mobileView === 'reader' ? (
                        <div className="w-full h-full">
                            {paperData.file_url && (
                                <PdfHighlighterViewer
                                    pdfUrl={paperData.file_url}
                                    explicitSearchTerm={explicitSearchTerm}
                                    setUserMessageReferences={setUserMessageReferences}
                                    setSelectedText={setSelectedText}
                                    setTooltipPosition={setTooltipPosition}
                                    isAnnotating={isAnnotating}
                                    setIsAnnotating={setIsAnnotating}
                                    setIsHighlightInteraction={setIsHighlightInteraction}
                                    isHighlightInteraction={isHighlightInteraction}
                                    highlights={highlights}
                                    selectedText={selectedText}
                                    tooltipPosition={tooltipPosition}
                                    setActiveHighlight={setActiveHighlight}
                                    activeHighlight={activeHighlight}
                                    addHighlight={addHighlight}
                                    loadHighlights={fetchHighlights}
                                    removeHighlight={removeHighlight}
                                    renderAnnotations={renderAnnotations}
                                    annotations={annotations}
                                    setHighlights={setHighlights}
                                    handleStatusChange={handleStatusChange}
                                    paperStatus={paperData.status}
                                    onOverlaysCreated={handleOverlaysCreated}
                                    onRefreshUrl={refreshPdfUrl}
                                    addAnnotation={addAnnotation}
                                    updateAnnotation={updateAnnotation}
                                    removeAnnotation={removeAnnotation}
                                    currentUser={user}
                                    showAnnotationCards={showAnnotationCards}
                                    onToggleAnnotationCards={() => setAnnotationCardsVisible((v) => !v)}
                                    annotationsPanelActive={annotationsPanelActive}
                                    onAnnotateViaSidePanel={onAnnotateViaSidePanel}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="w-full h-full">
                            <div
                                className="flex flex-row h-full relative"
                            >
                                {jobId ? (
                                    <div className="flex flex-col h-full w-full">
                                        <div className="flex items-center justify-center w-full px-6 py-4 border-b border-gray-100 dark:border-gray-800/50">
                                            <div className="flex items-center gap-3">
                                                <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                                                <p className="text-sm text-muted-foreground">{sidePanelDisplayedText}</p>
                                                <span className="text-xs text-muted-foreground/50 tabular-nums">{elapsedTime}s</span>
                                            </div>
                                        </div>
                                        <ReportSkeleton />
                                    </div>
                                ) : (
                                    <>
                                        <SidePanelContent {...sidePanelProps} isMobile={true} />
                                        <PaperSidebar
                                            rightSideFunction={rightSideFunction}
                                            setRightSideFunction={setRightSideFunction}
                                            PaperToolset={toolset}
                                            showAnnotationCards={showAnnotationCards}
                                            onToggleAnnotationCards={() => setAnnotationCardsVisible(v => !v)}
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
                            <span className="text-xs">Tools</span>
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
                        width: rightSideFunction === 'Read' ? '100%' : `${leftPanelWidth}%`
                    }}
                >
                    {paperData.file_url && (
                        <div className="w-full h-full">
                            <PdfHighlighterViewer
                                pdfUrl={paperData.file_url}
                                explicitSearchTerm={explicitSearchTerm}
                                setUserMessageReferences={setUserMessageReferences}
                                setSelectedText={setSelectedText}
                                setTooltipPosition={setTooltipPosition}
                                isAnnotating={isAnnotating}
                                setIsAnnotating={setIsAnnotating}
                                setIsHighlightInteraction={setIsHighlightInteraction}
                                isHighlightInteraction={isHighlightInteraction}
                                highlights={highlights}
                                selectedText={selectedText}
                                tooltipPosition={tooltipPosition}
                                setActiveHighlight={setActiveHighlight}
                                activeHighlight={activeHighlight}
                                addHighlight={addHighlight}
                                loadHighlights={fetchHighlights}
                                removeHighlight={removeHighlight}
                                renderAnnotations={renderAnnotations}
                                annotations={annotations}
                                setHighlights={setHighlights}
                                handleStatusChange={handleStatusChange}
                                paperStatus={paperData.status}
                                onOverlaysCreated={handleOverlaysCreated}
                                onRefreshUrl={refreshPdfUrl}
                                addAnnotation={addAnnotation}
                                updateAnnotation={updateAnnotation}
                                removeAnnotation={removeAnnotation}
                                currentUser={user}
                                showAnnotationCards={showAnnotationCards}
                                onToggleAnnotationCards={() =>
                                    setAnnotationCardsVisible((v) => !v)
                                }
                                annotationsPanelActive={annotationsPanelActive}
                                onAnnotateViaSidePanel={onAnnotateViaSidePanel}
                                sidePanelOpen={rightSideFunction !== 'Read'}
                                isReadMode={isReadMode}
                                onToggleReadMode={handleToggleReadMode}
                            />
                        </div>
                    )}
                </div>

                {/* Resizable Divider */}
                {rightSideFunction !== 'Read' && (
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
                    className="flex flex-row h-full relative"
                    style={rightSideFunction !== 'Read' ? { width: `${100 - leftPanelWidth}%` } : { width: 'auto' }}
                >
                    {jobId ? (
                        <div className="flex flex-col h-full w-full">
                            <div className="flex items-center justify-center w-full px-6 py-4 border-b border-gray-100 dark:border-gray-800/50">
                                <div className="flex items-center gap-3">
                                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                                    <p className="text-sm text-muted-foreground">{sidePanelDisplayedText}</p>
                                    <span className="text-xs text-muted-foreground/50 tabular-nums">{elapsedTime}s</span>
                                </div>
                            </div>
                            <ReportSkeleton />
                        </div>
                    ) : (
                        <>
                            <SidePanelContent {...sidePanelProps} isMobile={false} />
                            <PaperSidebar
                                rightSideFunction={rightSideFunction}
                                setRightSideFunction={setRightSideFunction}
                                PaperToolset={toolset}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
