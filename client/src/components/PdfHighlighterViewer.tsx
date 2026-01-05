"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
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
	HighlightColor,
} from "@/lib/schema";

// Map highlight color names to rgba values (shared with HighlightContainer)
const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, string> = {
	yellow: "rgba(255, 235, 59, 0.4)",
	green: "rgba(76, 175, 80, 0.4)",
	blue: "rgba(66, 165, 245, 0.4)",
	pink: "rgba(236, 64, 122, 0.4)",
	purple: "rgba(171, 71, 188, 0.4)",
};
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
	findTextPages,
	createTextHighlightOverlays,
} from "./pdf-viewer";

// Re-export types for external use
export type { ExtendedHighlight };
export { paperHighlightToExtended, extendedToPaperHighlight };

// Position data for highlights rendered via DOM overlays (assistant highlights)
export interface RenderedHighlightPosition {
	left: number;
	top: number;
	width: number;
	height: number;
	page: number;
}

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
		doAnnotate?: boolean,
		color?: HighlightColor
	) => void;
	removeHighlight: (highlight: PaperHighlight) => void;
	loadHighlights: () => Promise<void>;
	renderAnnotations: (annotations: PaperHighlightAnnotation[]) => void;
	annotations: PaperHighlightAnnotation[];
	handleStatusChange?: (status: PaperStatus) => void;
	paperStatus?: PaperStatus;
	setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
	onOverlaysCreated?: (positions: Map<string, RenderedHighlightPosition>) => void;
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
		onOverlaysCreated,
	} = props;

	// Refs
	const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const pdfDocumentRef = useRef<any>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	// When true, skip scrolling on the next activeHighlight change (e.g., when clicking directly on a highlight)
	const blockScrollOnNextHighlight = useRef(false);
	// Track previous scale to detect scale changes (for overlay recreation timing)
	const prevScaleRef = useRef<number | null>(null);

	// State
	const [currentSelection, setCurrentSelection] = useState<PdfSelection | null>(null);
	const [, setCurrentGhostHighlight] = useState<GhostHighlight | null>(null);
	const [scale, setScale] = useState(1.0);
	const [currentPage, setCurrentPage] = useState(1);
	const [numPages, setNumPages] = useState<number | null>(null);
	const [showScrollToTop] = useState(false);
	const [pdfReady, setPdfReady] = useState(false);
	const [highlightColor, setHighlightColor] = useState<HighlightColor>("blue");

	// Search hook
	const search = usePdfSearch({
		highlighterUtilsRef,
		pdfDocumentRef,
		setCurrentPage,
		explicitSearchTerm,
		pdfReady,
		activeHighlightId: activeHighlight?.id,
	});

	// Convert PaperHighlights to ExtendedHighlights
	// Memoize to prevent the scroll-to-highlight effect from re-running on every render
	const extendedHighlights: ExtendedHighlight[] = useMemo(
		() => highlights
			.map(paperHighlightToExtended)
			.filter((h): h is ExtendedHighlight => h !== null),
		[highlights]
	);

	// Zoom controls
	const zoomIn = useCallback(() => {
		setScale((prev) => Math.min(prev + 0.25, 3));
	}, []);

	const zoomOut = useCallback(() => {
		setScale((prev) => Math.max(prev - 0.25, 0.5));
	}, []);

	// Apply scale changes directly to the viewer
	// (workaround for react-pdf-highlighter-extended not responding to pdfScaleValue prop changes)
	useEffect(() => {
		const viewer = highlighterUtilsRef.current?.getViewer();
		if (viewer) {
			viewer.currentScaleValue = String(scale);
		}
	}, [scale]);

	// Re-apply scale after container resizes to override the library's stale ResizeObserver
	// (the library's ResizeObserver captures a stale pdfScaleValue due to missing dependency)
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const resizeObserver = new ResizeObserver(() => {
			// Use setTimeout to ensure our scale setting comes after the library's
			setTimeout(() => {
				const viewer = highlighterUtilsRef.current?.getViewer();
				if (viewer && viewer.currentScaleValue !== String(scale)) {
					viewer.currentScaleValue = String(scale);
				}
			}, 0);
		});

		resizeObserver.observe(container);
		return () => resizeObserver.disconnect();
	}, [scale]);

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
		(text: string, doAnnotate?: boolean) => {
			if (currentSelection) {
				// Block scroll-to-highlight since we're creating a new one at the current location
				blockScrollOnNextHighlight.current = true;
				// Clear active highlight to prevent scroll back when highlights array updates
				setActiveHighlight(null);

				const ghostHighlight = currentSelection.makeGhostHighlight();
				addHighlight(
					text,
					ghostHighlight.position as ScaledPosition,
					ghostHighlight.position.boundingRect.pageNumber,
					doAnnotate,
					highlightColor
				);
				setCurrentSelection(null);
				setSelectedText("");
				setTooltipPosition(null);
			}
		},
		[currentSelection, addHighlight, setSelectedText, setTooltipPosition, highlightColor, setActiveHighlight]
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
				// Don't scroll - the highlight is already in view since user just clicked it
				blockScrollOnNextHighlight.current = true;
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

	// Scroll to active highlight when it changes (unless blocked, e.g., when clicking directly on a highlight)
	useEffect(() => {
		if (activeHighlight?.id && highlighterUtilsRef.current) {
			if (blockScrollOnNextHighlight.current) {
				blockScrollOnNextHighlight.current = false;
				return;
			}
			const extendedHighlight = extendedHighlights.find(
				(h) => h.id === activeHighlight.id
			);
			if (extendedHighlight) {
				highlighterUtilsRef.current.scrollToHighlight(extendedHighlight);
			}
		}
	}, [activeHighlight, extendedHighlights]);

	// Update current page when user scrolls through the PDF
	useEffect(() => {
		if (!pdfReady) return;

		const pdfViewer = document.querySelector(".pdfViewer");
		if (!pdfViewer) return;

		// Track visibility ratio for each page
		const pageVisibility = new Map<number, number>();
		let lastReportedPage = 1;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					const pageNum = parseInt(
						entry.target.getAttribute("data-page-number") || "0",
						10
					);
					if (pageNum > 0) {
						if (entry.isIntersecting) {
							pageVisibility.set(pageNum, entry.intersectionRatio);
						} else {
							pageVisibility.delete(pageNum);
						}
					}
				});

				// Find the page with the highest visibility
				let maxVisibility = 0;
				let mostVisiblePage = lastReportedPage;
				pageVisibility.forEach((ratio, pageNum) => {
					if (ratio > maxVisibility) {
						maxVisibility = ratio;
						mostVisiblePage = pageNum;
					}
				});

				if (mostVisiblePage !== lastReportedPage && maxVisibility > 0) {
					lastReportedPage = mostVisiblePage;
					setCurrentPage(mostVisiblePage);
				}
			},
			{
				root: pdfViewer.closest(".pdfViewerContainer") || pdfViewer.parentElement,
				threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
			}
		);

		// Observe all page elements
		const pages = pdfViewer.querySelectorAll(".page[data-page-number]");
		pages.forEach((page) => observer.observe(page));

		// Also observe new pages as they're added (for lazy loading)
		const mutationObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node instanceof Element) {
						const newPages = node.matches(".page[data-page-number]")
							? [node]
							: node.querySelectorAll(".page[data-page-number]");
						newPages.forEach((page) => observer.observe(page));
					}
				});
			});
		});

		mutationObserver.observe(pdfViewer, { childList: true, subtree: true });

		return () => {
			observer.disconnect();
			mutationObserver.disconnect();
		};
	}, [pdfReady]);

	// Intercept external links in PDF annotations for security
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleLinkClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			const link = target.closest("a");

			if (!link) return;

			// Check if this is inside the annotation layer
			const annotationLayer = link.closest(".annotationLayer");
			if (!annotationLayer) return;

			const href = link.getAttribute("href");
			if (!href) return;

			// Internal document links start with # (page anchors, named destinations)
			if (href.startsWith("#")) {
				// Allow internal links to work normally
				return;
			}

			// External link detected - intercept and warn
			event.preventDefault();
			event.stopPropagation();

			// Mark it visually as external
			const linkSection = link.closest("section");
			if (linkSection) {
				linkSection.setAttribute("data-external-link", "true");
			}

			const proceed = window.confirm(
				`This PDF contains a link to an external website:\n\n${href}\n\nDo you want to open it in a new tab?`
			);

			if (proceed) {
				window.open(href, "_blank", "noopener,noreferrer");
			}
		};

		// Mark external links on render for visual styling
		const markExternalLinks = () => {
			const links = container.querySelectorAll(".annotationLayer a[href]");
			links.forEach((link) => {
				const href = link.getAttribute("href");
				if (href && !href.startsWith("#")) {
					const section = link.closest("section");
					if (section) {
						section.setAttribute("data-external-link", "true");
					}
				}
			});
		};

		// Use capture phase to intercept before PDF.js handles the click
		container.addEventListener("click", handleLinkClick, true);

		// Mark existing external links and watch for new ones
		markExternalLinks();
		const observer = new MutationObserver(markExternalLinks);
		observer.observe(container, { childList: true, subtree: true });

		return () => {
			container.removeEventListener("click", handleLinkClick, true);
			observer.disconnect();
		};
	}, [pdfReady]);

	// Cache for highlight page mappings
	const highlightPageMapRef = useRef<Map<string, number[]>>(new Map());

	// Create DOM-based overlays for highlights without position data
	// This handles both assistant highlights and legacy user highlights (backwards compatibility)
	// Uses MutationObserver to detect when text layers are added/recreated
	useEffect(() => {
		if (!pdfReady || !pdfDocumentRef.current) return;

		// Clear existing overlays (needed when scale changes so they can be recreated at new positions)
		document.querySelectorAll(".text-match-highlight-overlay").forEach((el) => el.remove());

		// Get all highlights without positions (assistant or legacy user highlights)
		const highlightsWithoutPosition = highlights.filter(
			(h) => !h.position && h.raw_text
		);

		if (highlightsWithoutPosition.length === 0) {
			highlightPageMapRef.current.clear();
			return;
		}

		// Function to create overlays for a specific text layer
		const createOverlaysForTextLayer = (textLayer: Element, pageNumber: number) => {
			for (const highlight of highlightsWithoutPosition) {
				const key = highlight.id || highlight.raw_text;
				const pages = highlightPageMapRef.current.get(key);

				// Check if this highlight belongs on this page
				if (!pages || !pages.includes(pageNumber)) continue;

				// Check if overlay already exists
				const existingOverlay = textLayer.querySelector(
					`.text-match-highlight-overlay[data-highlight-key="${CSS.escape(key)}"]`
				);
				if (existingOverlay) continue;

				// Use different colors based on role and user's color selection
				const backgroundColor = highlight.role === "assistant"
					? "rgba(168, 85, 247, 0.3)"  // Purple for assistant
					: HIGHLIGHT_COLOR_MAP[highlight.color || "blue"]; // User's selected color

				const overlays = createTextHighlightOverlays(
					textLayer,
					highlight.raw_text,
					"text-match-highlight-overlay",
					backgroundColor
				);

				// Make overlays clickable and navigate to annotation panel
				overlays.forEach((el) => {
					el.setAttribute("data-highlight-key", key);
					el.setAttribute("data-highlight-id", highlight.id || "");
					el.setAttribute("data-page-number", String(pageNumber));
					// Encode position from the overlay's computed style
					const left = el.style.left;
					const top = el.style.top;
					const width = el.style.width;
					const height = el.style.height;
					el.setAttribute("data-position", JSON.stringify({
						left: parseFloat(left),
						top: parseFloat(top),
						width: parseFloat(width),
						height: parseFloat(height),
						page: pageNumber,
					}));
					el.style.pointerEvents = "auto";
					el.style.cursor = "pointer";
					el.addEventListener("click", (e) => {
						e.stopPropagation();
						// Don't scroll - the highlight is already in view since user just clicked it
						blockScrollOnNextHighlight.current = true;
						setActiveHighlight(highlight);
						setIsHighlightInteraction(true);
						setSelectedText(highlight.raw_text);
						setTooltipPosition({ x: e.clientX, y: e.clientY });
					});
				});
			}
		};

		// Create overlays for all currently rendered text layers
		const createOverlaysForAllRenderedPages = () => {
			const textLayers = document.querySelectorAll(".page .textLayer");
			textLayers.forEach((textLayer) => {
				const pageEl = textLayer.closest(".page");
				const pageNum = pageEl?.getAttribute("data-page-number");
				if (pageNum) {
					createOverlaysForTextLayer(textLayer, parseInt(pageNum, 10));
				}
			});
		};

		// Collect all rendered highlight positions from the DOM and notify via callback
		const notifyOverlaysCreated = () => {
			if (!onOverlaysCreated) return;

			const positions = new Map<string, RenderedHighlightPosition>();
			const overlays = document.querySelectorAll(".text-match-highlight-overlay[data-highlight-id]");

			overlays.forEach((el) => {
				const highlightId = el.getAttribute("data-highlight-id");
				const positionData = el.getAttribute("data-position");

				if (highlightId && positionData && !positions.has(highlightId)) {
					try {
						const parsed = JSON.parse(positionData) as RenderedHighlightPosition;
						positions.set(highlightId, parsed);
					} catch (e) {
						console.warn("Failed to parse position data for highlight", highlightId, e);
					}
				}
			});

			onOverlaysCreated(positions);
		};

		// Populate page cache for highlights (needed for both immediate creation and MutationObserver)
		const ensurePageMappings = async () => {
			for (const highlight of highlightsWithoutPosition) {
				const key = highlight.id || highlight.raw_text;
				if (!highlightPageMapRef.current.has(key)) {
					const pages = await findTextPages(
						highlight.raw_text,
						pdfDocumentRef.current,
						highlight.page_number
					);
					highlightPageMapRef.current.set(key, pages);
				}
			}
		};

		// Track if this is a scale change for delayed overlay creation
		const isScaleChange = prevScaleRef.current !== null && prevScaleRef.current !== scale;
		prevScaleRef.current = scale;

		// On scale change, delay overlay creation to let pdf.js apply CSS transforms
		// On initial load or highlight changes, create immediately
		const creationDelay = isScaleChange ? 50 : 0;

		const timeoutId = setTimeout(() => {
			ensurePageMappings().then(() => {
				createOverlaysForAllRenderedPages();
				notifyOverlaysCreated();
			});
		}, creationDelay);

		// Track pending timeouts per page to debounce rapid mutations
		const pendingTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

		// Use MutationObserver to detect when text layers are added/modified
		const observer = new MutationObserver((mutations) => {
			const textLayersToProcess = new Set<Element>();

			for (const mutation of mutations) {
				// Check added nodes for text layers
				mutation.addedNodes.forEach((node) => {
					if (node instanceof Element) {
						// Check if the node itself is a textLayer
						if (node.classList?.contains("textLayer")) {
							textLayersToProcess.add(node);
						}
						// Check if any descendants are textLayers
						const textLayers = node.querySelectorAll?.(".textLayer");
						textLayers?.forEach((textLayer) => {
							textLayersToProcess.add(textLayer);
						});
						// Check if the node was added to an existing textLayer (spans being repopulated)
						const parentTextLayer = node.closest?.(".textLayer");
						if (parentTextLayer) {
							textLayersToProcess.add(parentTextLayer);
						}
					}
				});
			}

			// Process each unique textLayer once with debounced delay
			textLayersToProcess.forEach((textLayer) => {
				const pageEl = textLayer.closest(".page");
				const pageNum = pageEl?.getAttribute("data-page-number");
				if (pageNum) {
					const pageNumber = parseInt(pageNum, 10);
					// Clear any pending timeout for this page to debounce
					const existingTimeout = pendingTimeouts.get(pageNumber);
					if (existingTimeout) {
						clearTimeout(existingTimeout);
					}
					// Schedule overlay creation with delay to ensure spans are populated
					const timeout = setTimeout(() => {
						pendingTimeouts.delete(pageNumber);
						createOverlaysForTextLayer(textLayer, pageNumber);
						notifyOverlaysCreated();
					}, 100);
					pendingTimeouts.set(pageNumber, timeout);
				}
			});
		});

		// Observe the PDF viewer container for changes
		const pdfViewer = document.querySelector(".pdfViewer");
		if (pdfViewer) {
			observer.observe(pdfViewer, {
				childList: true,
				subtree: true,
			});
		}

		return () => {
			observer.disconnect();
			clearTimeout(timeoutId);
			// Clear any pending timeouts
			pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
			pendingTimeouts.clear();
		};
	}, [pdfReady, highlights, scale, onOverlaysCreated]);

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
				highlightColor={highlightColor}
				setHighlightColor={setHighlightColor}
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
							if (!pdfReady) {
								setPdfReady(true);
							}
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
