"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
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
import { InlineAnnotationCard } from "./InlineAnnotationCard";
import { BasicUser } from "@/lib/auth";

import {
	ExtendedHighlight,
	paperHighlightToExtended,
	extendedToPaperHighlight,
	HighlightContainer,
	activeHighlightStore,
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

/** Matches `w-[280px]` on margin annotation cards */
const ANNOTATION_CARD_WIDTH_PX = 280;
const ANNOTATION_CARD_MARGIN_GAP_PX = 8;

/**
 * Anchor for margin annotation cards: right gutter by default, left gutter if the
 * card would not fit to the right of the page in the scroll container.
 */
function getAnnotationCardAnchorForHighlight(
	highlight: PaperHighlight,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	viewer: any,
	scrollContainer: HTMLElement
): { top: number; left: number } | null {
	if (!highlight.position || !highlight.page_number) return null;

	const pageView = viewer.getPageView(highlight.page_number - 1);
	if (!pageView?.div || !pageView?.viewport) return null;

	const { div: pageDiv, viewport } = pageView;
	const { boundingRect } = highlight.position;
	const scaleY = viewport.height / boundingRect.height;

	const containerRect = scrollContainer.getBoundingClientRect();
	const pageRect = (pageDiv as HTMLElement).getBoundingClientRect();
	const scrollLeft = scrollContainer.scrollLeft;

	const top =
		pageRect.top -
		containerRect.top +
		scrollContainer.scrollTop +
		boundingRect.y1 * scaleY;

	const pageRightContent = pageRect.right - containerRect.left + scrollLeft;
	const pageLeftContent = pageRect.left - containerRect.left + scrollLeft;

	const rightGutterLeft = pageRightContent + ANNOTATION_CARD_MARGIN_GAP_PX;
	const leftGutterLeft = pageLeftContent - ANNOTATION_CARD_MARGIN_GAP_PX - ANNOTATION_CARD_WIDTH_PX;

	let left = rightGutterLeft;
	if (
		rightGutterLeft + ANNOTATION_CARD_WIDTH_PX > scrollContainer.scrollWidth &&
		leftGutterLeft >= 0
	) {
		left = leftGutterLeft;
	}

	return { top, left };
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
	isAnnotating: boolean;
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
	onRefreshUrl?: () => Promise<string | null>;
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
	updateAnnotation?: (annotationId: string, content: string) => Promise<unknown> | void;
	removeAnnotation?: (annotationId: string) => void;
	currentUser?: BasicUser | null;
	showAnnotationCards?: boolean;
	onToggleAnnotationCards?: () => void;
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
		isAnnotating,
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
		onRefreshUrl,
		addAnnotation,
		updateAnnotation,
		removeAnnotation,
		currentUser,
		annotations,
		showAnnotationCards = true,
		onToggleAnnotationCards,
	} = props;

	// Position anchors for inline annotation cards
	interface AnnotationCardEntry {
		highlightId: string;
		top: number;
		left: number;
		scrollContainer: Element;
		initialContent?: string;
		annotationId?: string;
	}
	const [annotationCards, setAnnotationCards] = useState<AnnotationCardEntry[]>([]);
	const [cardHeights, setCardHeights] = useState<Map<string, number>>(new Map());
	const [selectionRectTop, setSelectionRectTop] = useState<number | null>(null);
	// Holds position computed during onAnnotate when activeHighlight isn't set yet (new text selection)
	const [pendingAnnotationPos, setPendingAnnotationPos] = useState<{ top: number; left: number; scrollContainer: Element } | null>(null);
	// Guard: restore annotation cards from server data only once per mount
	const hasRestoredRef = useRef(false);

	// Track the effective PDF URL, which may be refreshed on 403 errors
	const [effectivePdfUrl, setEffectivePdfUrl] = useState(pdfUrl);
	const [isRefreshingUrl, setIsRefreshingUrl] = useState(false);
	const [pdfLoaderKey, setPdfLoaderKey] = useState(0);
	const refreshAttemptRef = useRef(0);
	const MAX_REFRESH_ATTEMPTS = 2;

	// Sync effective URL when parent provides a new pdfUrl
	useEffect(() => {
		setEffectivePdfUrl(pdfUrl);
		refreshAttemptRef.current = 0;
	}, [pdfUrl]);

	// Handle PDF load errors — refresh presigned URL on 403
	const handlePdfError = useCallback(
		async (error: Error) => {
			const is403 = error.message?.includes("403");
			if (
				is403 &&
				onRefreshUrl &&
				refreshAttemptRef.current < MAX_REFRESH_ATTEMPTS &&
				!isRefreshingUrl
			) {
				refreshAttemptRef.current += 1;
				setIsRefreshingUrl(true);
				try {
					const freshUrl = await onRefreshUrl();
					if (freshUrl) {
						setEffectivePdfUrl(freshUrl);
						// Force PdfLoader remount to clear its internal error state
						setPdfLoaderKey(prev => prev + 1);
					}
				} catch (e) {
					console.error("Failed to refresh PDF URL:", e);
				} finally {
					setIsRefreshingUrl(false);
				}
			}
		},
		[onRefreshUrl, isRefreshingUrl]
	);

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
	// Ref so ResizeObserver callbacks (which close over a stale scale) can re-apply the current scale
	const scaleRef = useRef(1.0);
	const [currentPage, setCurrentPage] = useState(1);
	const [numPages, setNumPages] = useState<number | null>(null);
	const [showScrollToTop] = useState(false);
	const [pdfReady, setPdfReady] = useState(false);
	/** Bumped on PDF.js `pagerendered` so annotation-card restore can retry when page views exist */
	const [pdfLayoutTick, setPdfLayoutTick] = useState(0);
	/**
	 * Bumped once the PDF.js PDFViewer instance is actually ready.
	 * The library initialises the viewer with a 100ms debounce inside a useLayoutEffect,
	 * so getViewer() returns null for a short window after pdfReady becomes true.
	 * Polling after pdfReady ensures both the pagerendered subscriber and the restore
	 * effect re-run once the viewer is genuinely available.
	 */
	const [viewerReadyTick, setViewerReadyTick] = useState(0);
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
		scaleRef.current = scale;
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

	const syncAnnotationCardPositions = useCallback(() => {
		setAnnotationCards((prev) => {
			if (prev.length === 0) return prev;
			const viewer = highlighterUtilsRef.current?.getViewer();
			const scrollContainer = viewer?.container as HTMLElement | undefined;
			if (!viewer || !scrollContainer) return prev;

			let changed = false;
			const next = prev.map((card) => {
				const h = highlights.find((x) => x.id === card.highlightId);
				if (!h?.position) return card;
				const anchor = getAnnotationCardAnchorForHighlight(h, viewer, scrollContainer);
				if (!anchor) return card;
				const same =
					Math.abs(anchor.top - card.top) < 0.5 &&
					Math.abs(anchor.left - card.left) < 0.5;
				if (same) return card;
				changed = true;
				return { ...card, top: anchor.top, left: anchor.left, scrollContainer };
			});
			return changed ? next : prev;
		});
	}, [highlights]);

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
					x: rect.left,
					y: rect.bottom,
				});
				setSelectionRectTop(rect.top);
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
			setSelectionRectTop(event.clientY);

			const originalHighlight = extendedHighlights.find(h => h.id === viewportHighlight.id);
			if (originalHighlight) {
				const paperHighlight = extendedToPaperHighlight(originalHighlight);
				// Don't scroll - the highlight is already in view since user just clicked it
				blockScrollOnNextHighlight.current = true;
				setActiveHighlight(paperHighlight);
			}

			// If this highlight already has an open annotation card, skip the context menu
			// and scroll to center the card (at its natural stored position) in the viewport
			const card = annotationCards.find(c => c.highlightId === viewportHighlight.id);
			if (!card) {
				const target = event.target as HTMLElement;
				const partsContainer = target.classList.contains('TextHighlight__parts')
					? target
					: (target.closest('.TextHighlight__parts') as HTMLElement | null);
				let anchorX = event.clientX;
				let anchorY = event.clientY + 20;
				if (partsContainer) {
					const parts = Array.from(partsContainer.querySelectorAll('.TextHighlight__part'));
					if (parts.length > 0) {
						const rects = parts.map(p => p.getBoundingClientRect());
						const bottomRect = rects.reduce((prev, curr) => curr.top > prev.top ? curr : prev);
						anchorX = bottomRect.left;
						anchorY = bottomRect.bottom;
					}
				}
				setTooltipPosition({ x: anchorX, y: anchorY });
			} else {
				const container = card.scrollContainer as HTMLElement;
				const targetScrollTop = card.top - container.clientHeight / 2;
				container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
			}
		},
		[
			setIsHighlightInteraction,
			setSelectedText,
			setTooltipPosition,
			setActiveHighlight,
			extendedHighlights,
			annotationCards,
		]
	);

	// Handle outside click to dismiss tooltip
	useEffect(() => {
		if (!tooltipPosition) return;

		const handleOutsideClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			// Let handleHighlightClick handle highlight clicks — don't close here
			if (target.closest?.('.TextHighlight__parts, .TextHighlight__part')) return;
			const tooltipElement = document.querySelector(".fixed.z-30");
			if (!tooltipElement) return;

			if (!tooltipElement.contains(target)) {
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

	// When a new highlight is saved after a text selection annotate, create the pending card
	useEffect(() => {
		if (!addAnnotation) return;
		const hid = activeHighlight?.id;
		if (isAnnotating && hid && pendingAnnotationPos) {
			setAnnotationCards(prev => {
				const exists = prev.find(c => c.highlightId === hid);
				return exists ? prev : [...prev, { highlightId: hid, ...pendingAnnotationPos }];
			});
			setPendingAnnotationPos(null);
		}
	}, [addAnnotation, isAnnotating, activeHighlight, pendingAnnotationPos]);

	// Poll for the PDF.js viewer instance becoming available.
	// The library initialises it with a 100ms debounce, so getViewer() returns null
	// immediately after pdfReady. We bump viewerReadyTick when it's actually set,
	// which re-triggers the pagerendered subscriber and the restore effect below.
	useEffect(() => {
		if (!pdfReady) return;
		let timerId: ReturnType<typeof setTimeout>;
		const check = () => {
			const viewer = highlighterUtilsRef.current?.getViewer();
			if (viewer) {
				setViewerReadyTick(t => t + 1);
			} else {
				timerId = setTimeout(check, 50);
			}
		};
		// Start polling slightly after the library's 100ms debounce
		timerId = setTimeout(check, 120);
		return () => clearTimeout(timerId);
	}, [pdfReady]);

	// Re-run restore attempts as each PDF page finishes rendering (page views may be missing before then)
	useEffect(() => {
		if (!pdfReady || numPages == null) return;
		const viewer = highlighterUtilsRef.current?.getViewer();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bus = (viewer as any)?.eventBus;
		if (!bus?.on) return;
		const onPageRendered = () => setPdfLayoutTick((t) => t + 1);
		bus.on("pagerendered", onPageRendered);
		return () => bus.off("pagerendered", onPageRendered);
	}, [pdfReady, numPages, viewerReadyTick]);

	// Restore annotation cards from server-persisted annotations on page load
	useEffect(() => {
		if (!pdfReady || hasRestoredRef.current) return;

		const viewer = highlighterUtilsRef.current?.getViewer();
		const scrollContainer = viewer?.container as HTMLElement | undefined;
		if (!viewer || !scrollContainer) return;

		// Wait until both data sources are ready before marking as restored.
		// Without this guard, if the PDF loads before server data arrives, hasRestoredRef
		// would be locked to true with empty arrays and the restore would never run.
		if (!annotations.length || !highlights.length) return;

		// Group annotations by highlight_id, keep the first (earliest) per highlight
		const byHighlight = new Map<string, { content: string; annotationId: string }>();
		for (const ann of annotations) {
			if (!byHighlight.has(ann.highlight_id)) {
				byHighlight.set(ann.highlight_id, { content: ann.content, annotationId: ann.id });
			}
		}

		const restored: AnnotationCardEntry[] = [];
		let missingPageView = 0;
		let attempted = 0;

		byHighlight.forEach(({ content, annotationId }, highlightId) => {
			const highlight = highlights.find(h => h.id === highlightId);
			if (!highlight?.position || !highlight.page_number) return;

			attempted++;

			const anchor = getAnnotationCardAnchorForHighlight(highlight, viewer, scrollContainer);
			if (!anchor) {
				missingPageView += 1;
				return;
			}

			restored.push({
				highlightId,
				top: anchor.top,
				left: anchor.left,
				scrollContainer,
				initialContent: content,
				annotationId,
			});
		});

		if (restored.length > 0) {
			setAnnotationCards(prev => {
				const existing = new Set(prev.map(c => c.highlightId));
				return [...prev, ...restored.filter(c => !existing.has(c.highlightId))];
			});
		}

		// Lock the ref only when we actually attempted restorations and all page views
		// were available. If attempted === 0 (no highlights had position data) or
		// missingPageView > 0, keep retrying on the next pdfLayoutTick.
		if (attempted > 0 && missingPageView === 0) {
			hasRestoredRef.current = true;
		} else if (attempted === 0 && byHighlight.size === 0) {
			// No annotations to restore at all — nothing to do, lock to stop retrying.
			hasRestoredRef.current = true;
		}
	}, [pdfReady, annotations, highlights, pdfLayoutTick, scale, numPages, viewerReadyTick]);

	// Keep margin card anchors in sync when zoom/layout changes (restore only sets initial positions once).
	useEffect(() => {
		if (!pdfReady) return;
		syncAnnotationCardPositions();
	}, [
		pdfReady,
		pdfLayoutTick,
		viewerReadyTick,
		annotationCards.length,
		syncAnnotationCardPositions,
	]);

	// PDF scroll/resize does not trigger React state — re-sync card positions from live page geometry.
	useEffect(() => {
		if (!pdfReady) return;
		const viewer = highlighterUtilsRef.current?.getViewer();
		const el = viewer?.container as HTMLElement | undefined;
		if (!el) return;

		let rafId = 0;
		const scheduleSync = () => {
			if (rafId !== 0) return;
			rafId = requestAnimationFrame(() => {
				rafId = 0;
				syncAnnotationCardPositions();
			});
		};

		el.addEventListener("scroll", scheduleSync, { passive: true });
		const ro = new ResizeObserver(() => {
			// Re-apply correct scale synchronously before browser can paint.
			// Our callback fires after the library's (registered earlier), so the library's stale
			// ResizeObserver has already reset currentScaleValue by this point. Overriding it here
			// (no setTimeout) ensures we correct it in the same rendering task, before any frame paint.
			const v = highlighterUtilsRef.current?.getViewer();
			if (v && v.currentScaleValue !== String(scaleRef.current)) {
				v.currentScaleValue = String(scaleRef.current);
			}
			scheduleSync();
		});
		ro.observe(el);
		window.addEventListener("resize", scheduleSync);

		return () => {
			el.removeEventListener("scroll", scheduleSync);
			ro.disconnect();
			window.removeEventListener("resize", scheduleSync);
			if (rafId !== 0) cancelAnimationFrame(rafId);
		};
	}, [pdfReady, viewerReadyTick, syncAnnotationCardPositions]);

	// Keep the module-level store in sync so HighlightContainer (in a separate React root) can react
	useEffect(() => {
		activeHighlightStore.set(activeHighlight?.id);
	}, [activeHighlight]);

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
					const rect = (e.target as HTMLElement).getBoundingClientRect();
				setTooltipPosition({ x: rect.left, y: (e as MouseEvent).clientY + 20 });
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
			className="flex flex-col w-full h-full min-h-0 overflow-x-visible overflow-y-hidden"
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
				showAnnotationCards={showAnnotationCards}
				onToggleAnnotationCards={onToggleAnnotationCards}
			/>

			{/* PDF Viewer — overflow-x-visible so margin annotation cards beside the page are not clipped */}
			<div className="flex-1 min-h-0 overflow-x-visible overflow-y-hidden relative">
				<PdfLoader
					key={pdfLoaderKey}
					document={effectivePdfUrl}
					workerSrc="/pdf.worker.mjs"
					beforeLoad={() => <EnigmaticLoadingExperience />}
					onError={handlePdfError}
					errorMessage={(error) =>
						isRefreshingUrl ? (
							<EnigmaticLoadingExperience />
						) : (
							<div className="p-4 text-red-500">
								Error loading PDF: {error.message}
							</div>
						)
					}
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
			onAnnotate={(y) => {
					if (!addAnnotation) return;
					const viewer = highlighterUtilsRef.current?.getViewer();
					const scrollContainer = viewer?.container as HTMLElement | undefined;
					if (!viewer || !scrollContainer) return;

					const containerRect = scrollContainer.getBoundingClientRect();
					const scrollTop = scrollContainer.scrollTop;
					const scrollLeft = scrollContainer.scrollLeft;

					let pos: { top: number; left: number; scrollContainer: Element };

					if (isHighlightInteraction && activeHighlight?.id) {
						const h = highlights.find((x) => x.id === activeHighlight.id);
						const anchor =
							h?.position && h.page_number
								? getAnnotationCardAnchorForHighlight(h, viewer, scrollContainer)
								: null;
						if (anchor) {
							pos = { ...anchor, scrollContainer };
						} else {
							const pdfPage =
								document.querySelector("#pdf-container .page") ??
								document.querySelector("#pdf-container [data-page-number]");
							const pageRect = pdfPage?.getBoundingClientRect();
							const top = (selectionRectTop ?? y) - containerRect.top + scrollTop;
							const left = pageRect
								? pageRect.right - containerRect.left + scrollLeft + ANNOTATION_CARD_MARGIN_GAP_PX
								: window.innerWidth * 0.6;
							pos = { top, left, scrollContainer };
						}
					} else {
						const pdfPage =
							document.querySelector("#pdf-container .page") ??
							document.querySelector("#pdf-container [data-page-number]");
						const pageRect = pdfPage?.getBoundingClientRect();
						pos = {
							top: (selectionRectTop ?? y) - containerRect.top + scrollTop,
							left: pageRect
								? pageRect.right - containerRect.left + scrollLeft + ANNOTATION_CARD_MARGIN_GAP_PX
								: window.innerWidth * 0.6,
							scrollContainer,
						};
					}

					if (isHighlightInteraction && activeHighlight?.id) {
						const hid = activeHighlight.id;
						// User clicked an existing highlight — ID is already known, create card immediately
						setAnnotationCards(prev => {
							const exists = prev.find(c => c.highlightId === hid);
							return exists ? prev : [...prev, { highlightId: hid, ...pos }];
						});
					} else {
						// New text selection — highlight not yet saved; wait for async server response
						setPendingAnnotationPos(pos);
					}
				}}
			/>
		)}

	{/* Inline Annotation Cards — one per annotated highlight, persists until closed */}
	{showAnnotationCards && (() => {
		const FALLBACK_HEIGHT = 120;
		const GAP = 8;
		const activeId = activeHighlight?.id;
		const sorted = [...annotationCards].sort((a, b) => a.top - b.top);
		const activeIdx = sorted.findIndex(c => c.highlightId === activeId);

		let adjusted: typeof sorted;
		if (activeIdx === -1) {
			// No active card — standard downward pass using real heights
			let prevBottom = -Infinity;
			adjusted = sorted.map(card => {
				const h = cardHeights.get(card.highlightId) ?? FALLBACK_HEIGHT;
				const top = Math.max(card.top, prevBottom + GAP);
				prevBottom = top + h;
				return { ...card, top };
			});
		} else {
			adjusted = [...sorted];
			// Active card sits at its exact top
			// Push cards ABOVE upward using each card's real height
			let nextCardTop = sorted[activeIdx].top;
			for (let i = activeIdx - 1; i >= 0; i--) {
				const h = cardHeights.get(sorted[i].highlightId) ?? FALLBACK_HEIGHT;
				const top = Math.min(sorted[i].top, Math.max(0, nextCardTop - GAP - h));
				adjusted[i] = { ...sorted[i], top };
				nextCardTop = adjusted[i].top;
			}
			// Push cards BELOW downward using real heights
			const activeH = cardHeights.get(sorted[activeIdx].highlightId) ?? FALLBACK_HEIGHT;
			let prevBottom = sorted[activeIdx].top + activeH;
			for (let i = activeIdx + 1; i < sorted.length; i++) {
				const h = cardHeights.get(sorted[i].highlightId) ?? FALLBACK_HEIGHT;
				const top = Math.max(sorted[i].top, prevBottom + GAP);
				adjusted[i] = { ...sorted[i], top };
				prevBottom = adjusted[i].top + h;
			}
		}
		return adjusted.map(card =>
			createPortal(
				<InlineAnnotationCard
					key={card.highlightId}
					highlightId={card.highlightId}
					topPosition={card.top}
					leftPosition={card.left}
					initialContent={card.initialContent}
					annotationId={card.annotationId}
					isActive={card.highlightId === activeId}
					user={currentUser ?? null}
				addAnnotation={addAnnotation}
				updateAnnotation={updateAnnotation}
				onHeightChange={(h) =>
						setCardHeights(prev => {
							const next = new Map(prev);
							next.set(card.highlightId, h);
							return next;
						})
					}
					onAnnotationSaved={(savedId) =>
						setAnnotationCards(prev => prev.map(c =>
							c.highlightId === card.highlightId ? { ...c, annotationId: savedId } : c
						))
					}
				onDelete={() => {
					if (card.annotationId && removeAnnotation) removeAnnotation(card.annotationId);
					setAnnotationCards(prev => prev.filter(c => c.highlightId !== card.highlightId));
					setCardHeights(prev => { const next = new Map(prev); next.delete(card.highlightId); return next; });
					setIsAnnotating(false);
					setSelectionRectTop(null);
				}}
				onClose={() => {
					setIsAnnotating(false);
					setSelectionRectTop(null);
					// Only remove unsaved cards — saved annotations persist until explicitly deleted
					if (!card.annotationId) {
						setAnnotationCards(prev => prev.filter(c => c.highlightId !== card.highlightId));
						setCardHeights(prev => { const next = new Map(prev); next.delete(card.highlightId); return next; });
					}
				}}
				/>,
				card.scrollContainer
			)
		);
	})()}

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
