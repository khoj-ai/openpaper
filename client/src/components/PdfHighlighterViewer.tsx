"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
	PdfLoader,
	PdfHighlighter,
	PdfHighlighterUtils,
} from "react-pdf-highlighter-extended";
import type {
	PdfSelection,
	GhostHighlight,
	ViewportHighlight,
} from "react-pdf-highlighter-extended";

import { Button } from "@/components/ui/button";
import { ChevronUp } from "lucide-react";
import {
	PaperHighlight,
	PaperHighlightAnnotation,
	ScaledPosition,
} from "@/lib/schema";
import EnigmaticLoadingExperience from "@/components/EnigmaticLoadingExperience";
import { PaperStatus } from "./utils/PdfStatus";
import InlineAnnotationMenu from "./InlineAnnotationMenu";

import {
	ExtendedHighlight,
	paperHighlightToExtended,
	extendedToPaperHighlight,
	HighlightContainer,
	usePdfSearch,
	PdfToolbar,
} from "./pdf-viewer";

// Re-export types for external use
export type { ExtendedHighlight };
export { paperHighlightToExtended, extendedToPaperHighlight };

interface PdfHighlighterViewerProps {
	pdfUrl: string;
	explicitSearchTerm?: string;
	highlights: PaperHighlight[];
	setHighlights: (highlights: PaperHighlight[]) => void;
	selectedText: string;
	setSelectedText: (text: string) => void;
	tooltipPosition: { x: number; y: number } | null;
	setTooltipPosition: (position: { x: number; y: number } | null) => void;
	setIsAnnotating: (isAnnotating: boolean) => void;
	isHighlightInteraction: boolean;
	setIsHighlightInteraction: (isHighlightInteraction: boolean) => void;
	activeHighlight: PaperHighlight | null;
	setActiveHighlight: (highlight: PaperHighlight | null) => void;
	addHighlight: (
		selectedText: string,
		position?: ScaledPosition,
		pageNumber?: number,
		doAnnotate?: boolean
	) => void;
	removeHighlight: (highlight: PaperHighlight) => void;
	loadHighlights: () => Promise<void>;
	renderAnnotations: (annotations: PaperHighlightAnnotation[]) => void;
	annotations: PaperHighlightAnnotation[];
	handleStatusChange?: (status: PaperStatus) => void;
	paperStatus?: PaperStatus;
	setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
}

export function PdfHighlighterViewer(props: PdfHighlighterViewerProps) {
	const {
		pdfUrl,
		explicitSearchTerm,
		highlights,
		setHighlights,
		selectedText,
		setSelectedText,
		tooltipPosition,
		setTooltipPosition,
		setIsAnnotating,
		isHighlightInteraction,
		setIsHighlightInteraction,
		activeHighlight,
		setActiveHighlight,
		addHighlight,
		removeHighlight,
		paperStatus,
		handleStatusChange = () => { },
		setUserMessageReferences,
	} = props;

	// Refs
	const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const pdfDocumentRef = useRef<any>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// State
	const [currentSelection, setCurrentSelection] = useState<PdfSelection | null>(null);
	const [, setCurrentGhostHighlight] = useState<GhostHighlight | null>(null);
	const [scale, setScale] = useState(1.0);
	const [currentPage, setCurrentPage] = useState(1);
	const [numPages, setNumPages] = useState<number | null>(null);
	const [showScrollToTop] = useState(false);

	// Search hook
	const search = usePdfSearch({
		highlighterUtilsRef,
		pdfDocumentRef,
		setCurrentPage,
		explicitSearchTerm,
	});

	// Convert PaperHighlights to ExtendedHighlights
	const extendedHighlights: ExtendedHighlight[] = highlights
		.map(paperHighlightToExtended)
		.filter((h): h is ExtendedHighlight => h !== null);

	// Zoom controls
	const zoomIn = useCallback(() => {
		setScale((prev) => Math.min(prev + 0.25, 3));
	}, []);

	const zoomOut = useCallback(() => {
		setScale((prev) => Math.max(prev - 0.25, 0.5));
	}, []);

	// Page navigation
	const goToPreviousPage = useCallback(() => {
		if (currentPage > 1) {
			const viewer = highlighterUtilsRef.current?.getViewer();
			if (viewer) {
				viewer.currentPageNumber = currentPage - 1;
				setCurrentPage(currentPage - 1);
			}
		}
	}, [currentPage]);

	const goToNextPage = useCallback(() => {
		if (numPages && currentPage < numPages) {
			const viewer = highlighterUtilsRef.current?.getViewer();
			if (viewer) {
				viewer.currentPageNumber = currentPage + 1;
				setCurrentPage(currentPage + 1);
			}
		}
	}, [currentPage, numPages]);

	const scrollToTop = useCallback(() => {
		const viewer = highlighterUtilsRef.current?.getViewer();
		if (viewer) {
			viewer.currentPageNumber = 1;
			setCurrentPage(1);
		}
	}, []);

	// Handle selection
	const handleSelection = useCallback(
		(selection: PdfSelection) => {
			setCurrentSelection(selection);
			setSelectedText(selection.content.text || "");
			setIsHighlightInteraction(false);

			const domSelection = window.getSelection();
			if (domSelection && domSelection.rangeCount > 0) {
				const range = domSelection.getRangeAt(0);
				const rect = range.getBoundingClientRect();
				setTooltipPosition({
					x: rect.right,
					y: rect.top + rect.height / 2,
				});
			}
		},
		[setSelectedText, setTooltipPosition, setIsHighlightInteraction]
	);

	// Handle ghost highlight creation
	const handleCreateGhostHighlight = useCallback(
		(ghostHighlight: GhostHighlight) => {
			setCurrentGhostHighlight(ghostHighlight);
		},
		[]
	);

	// Handle ghost highlight removal
	const handleRemoveGhostHighlight = useCallback(() => {
		setCurrentGhostHighlight(null);
	}, []);

	// Handle adding a highlight from the menu
	const handleAddHighlightFromMenu = useCallback(
		(
			text: string,
			startOffset?: number,
			endOffset?: number,
			pageNumber?: number,
			doAnnotate?: boolean
		) => {
			if (currentSelection) {
				const ghostHighlight = currentSelection.makeGhostHighlight();
				addHighlight(
					text,
					ghostHighlight.position as ScaledPosition,
					ghostHighlight.position.boundingRect.pageNumber,
					doAnnotate
				);
				setCurrentSelection(null);
				setSelectedText("");
				setTooltipPosition(null);
			}
		},
		[currentSelection, addHighlight, setSelectedText, setTooltipPosition]
	);

	// Handle highlight click
	const handleHighlightClick = useCallback(
		(viewportHighlight: ViewportHighlight<ExtendedHighlight>, event: MouseEvent) => {
			setIsHighlightInteraction(true);
			setSelectedText(viewportHighlight.content?.text || viewportHighlight.raw_text || "");
			setTooltipPosition({ x: event.clientX, y: event.clientY });

			const originalHighlight = extendedHighlights.find(h => h.id === viewportHighlight.id);
			if (originalHighlight) {
				const paperHighlight = extendedToPaperHighlight(originalHighlight);
				setActiveHighlight(paperHighlight);
			}
		},
		[
			setIsHighlightInteraction,
			setSelectedText,
			setTooltipPosition,
			setActiveHighlight,
			extendedHighlights,
		]
	);

	// Handle outside click to dismiss tooltip
	useEffect(() => {
		if (!tooltipPosition) return;

		const handleOutsideClick = (e: MouseEvent) => {
			const tooltipElement = document.querySelector(".fixed.z-30");
			if (!tooltipElement) return;

			if (!tooltipElement.contains(e.target as Node)) {
				setTimeout(() => {
					setIsHighlightInteraction(false);
					setSelectedText("");
					setTooltipPosition(null);
					setIsAnnotating(false);
					setCurrentSelection(null);
				}, 10);
			}
		};

		const timerId = setTimeout(() => {
			document.addEventListener("mousedown", handleOutsideClick);
		}, 100);

		return () => {
			clearTimeout(timerId);
			document.removeEventListener("mousedown", handleOutsideClick);
		};
	}, [
		tooltipPosition,
		setIsHighlightInteraction,
		setSelectedText,
		setTooltipPosition,
		setIsAnnotating,
	]);

	// Scroll to active highlight when it changes
	useEffect(() => {
		if (activeHighlight?.id && highlighterUtilsRef.current) {
			const extendedHighlight = extendedHighlights.find(
				(h) => h.id === activeHighlight.id
			);
			if (extendedHighlight) {
				highlighterUtilsRef.current.scrollToHighlight(extendedHighlight);
			}
		}
	}, [activeHighlight, extendedHighlights]);

	return (
		<div
			ref={containerRef}
			className="flex flex-col w-full h-full overflow-hidden"
			id="pdf-container"
		>
			{/* Toolbar */}
			<PdfToolbar
				currentPage={currentPage}
				numPages={numPages}
				goToPreviousPage={goToPreviousPage}
				goToNextPage={goToNextPage}
				searchText={search.searchText}
				showSearchInput={search.showSearchInput}
				setShowSearchInput={search.setShowSearchInput}
				searchInputRef={search.searchInputRef}
				handleSearchChange={search.handleSearchChange}
				handleSearchSubmit={search.handleSearchSubmit}
				handleClearSearch={search.handleClearSearch}
				isSearching={search.isSearching}
				matchPages={search.matchPages}
				currentMatchIndex={search.currentMatchIndex}
				goToPreviousMatch={search.goToPreviousMatch}
				goToNextMatch={search.goToNextMatch}
				lastSearchTermRef={search.lastSearchTermRef}
				scale={scale}
				zoomIn={zoomIn}
				zoomOut={zoomOut}
				paperStatus={paperStatus}
				handleStatusChange={handleStatusChange}
			/>

			{/* PDF Viewer */}
			<div className="flex-1 overflow-hidden relative">
				<PdfLoader
					document={pdfUrl}
					workerSrc="/pdf.worker.mjs"
					beforeLoad={() => <EnigmaticLoadingExperience />}
					errorMessage={(error) => (
						<div className="p-4 text-red-500">
							Error loading PDF: {error.message}
						</div>
					)}
				>
					{(pdfDocument) => {
						// Store PDF document ref for text extraction
						if (pdfDocumentRef.current !== pdfDocument) {
							pdfDocumentRef.current = pdfDocument;
						}
						// Set numPages when document loads
						if (pdfDocument.numPages !== numPages) {
							setNumPages(pdfDocument.numPages);
						}

						return (
							<PdfHighlighter
								pdfDocument={pdfDocument}
								pdfScaleValue={scale}
								highlights={extendedHighlights}
								onSelection={handleSelection}
								onCreateGhostHighlight={handleCreateGhostHighlight}
								onRemoveGhostHighlight={handleRemoveGhostHighlight}
								enableAreaSelection={(event) => event.altKey}
								utilsRef={(utils) => {
									highlighterUtilsRef.current = utils;
								}}
								style={{
									height: "100%",
								}}
								textSelectionColor="rgba(59, 130, 246, 0.3)"
							>
								<HighlightContainer onHighlightClick={handleHighlightClick} />
							</PdfHighlighter>
						);
					}}
				</PdfLoader>
			</div>

			{/* Inline Annotation Menu */}
			{tooltipPosition && (
				<InlineAnnotationMenu
					selectedText={selectedText}
					tooltipPosition={tooltipPosition}
					setSelectedText={setSelectedText}
					setTooltipPosition={setTooltipPosition}
					setIsAnnotating={setIsAnnotating}
					highlights={highlights}
					setHighlights={setHighlights}
					isHighlightInteraction={isHighlightInteraction}
					activeHighlight={activeHighlight}
					addHighlight={handleAddHighlightFromMenu}
					removeHighlight={removeHighlight}
					setUserMessageReferences={setUserMessageReferences}
				/>
			)}

			{/* Scroll to top button */}
			{showScrollToTop && (
				<Button
					onClick={scrollToTop}
					size="sm"
					variant="secondary"
					className="fixed bottom-4 right-4 z-20 rounded-full w-10 h-10 p-0 shadow-lg"
				>
					<ChevronUp size={16} />
				</Button>
			)}
		</div>
	);
}
