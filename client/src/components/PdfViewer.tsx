"use client";

import { useEffect, useState } from "react";
import "../lib/promisePolyfill";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "../app/globals.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, ArrowRight, X, Minus, Plus } from "lucide-react";
import { addHighlightToNodes, findAllHighlightedPassages } from "./utils/PdfHighlightUtils";
import { usePdfSearch } from "./hooks/PdfSearch";
import { usePdfNavigation } from "./hooks/PdfNavigation";
import { usePdfLoader } from "./hooks/PdfLoader";
import InlineAnnotationMenu from "./InlineAnnotationMenu";
import { PaperHighlight, PaperHighlightAnnotation } from "@/app/paper/[id]/page";

interface PdfViewerProps {
	pdfUrl: string;
	explicitSearchTerm?: string;
	setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
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
	addHighlight: (selectedText: string, startOffset?: number, endOffset?: number) => void;
	removeHighlight: (highlight: PaperHighlight) => void;
	loadHighlights: () => Promise<void>;
	handleTextSelection: (e: React.MouseEvent) => void;
	renderAnnotations: (highlights: PaperHighlightAnnotation[]) => void;
	annotations: PaperHighlightAnnotation[];
}

export function PdfViewer(props: PdfViewerProps) {
	const {
		pdfUrl,
		explicitSearchTerm,
		setUserMessageReferences,
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
		loadHighlights,
		handleTextSelection,
		renderAnnotations,
		annotations,
	} = props;

	const [currentPage, setCurrentPage] = useState<number>(1);

	const { numPages, allPagesLoaded, onDocumentLoadSuccess, handlePageLoadSuccess } = usePdfLoader();
	const { scale, width, pagesRef, containerRef, goToPreviousPage, goToNextPage, zoomIn, zoomOut } = usePdfNavigation(numPages);

	// Search functionality
	const { searchText, setSearchText, searchResults, currentMatch, notFound, performSearch, goToNextMatch, goToPreviousMatch, setSearchResults, setNotFound, setCurrentMatch } = usePdfSearch(explicitSearchTerm);


	// Add this new effect for handling outside clicks
	useEffect(() => {
		if (!tooltipPosition) return; // Only add listener when tooltip is shown

		const handleOutsideClick = (e: MouseEvent) => {
			// Check if the click is outside both the tooltip and any highlighted text
			const tooltipElement = document.querySelector('.fixed.z-30'); // The tooltip element
			if (!tooltipElement) return;

			// If the click target is not inside the tooltip and not a highlight
			if (
				!tooltipElement.contains(e.target as Node) &&
				!(e.target as Element)?.classList?.contains('border-blue-500')
			) {
				// Reset everything with a slight delay to avoid conflicts
				setTimeout(() => {
					setIsHighlightInteraction(false);
					setSelectedText("");
					setTooltipPosition(null);
					setIsAnnotating(false);
				}, 10);
			}
		};

		// Add the listener after a brief delay to avoid it triggering immediately
		const timerId = setTimeout(() => {
			document.addEventListener('mousedown', handleOutsideClick);
		}, 100);

		return () => {
			clearTimeout(timerId);
			document.removeEventListener('mousedown', handleOutsideClick);
		};
	}, [tooltipPosition]);


	// Add an effect to update current page when scrolling
	useEffect(() => {
		const handleScroll = () => {
			if (!containerRef.current || pagesRef.current.length === 0) return;

			// Find the page that's most visible in the viewport
			let maxVisiblePage = 1;
			let maxVisibleArea = 0;

			pagesRef.current.forEach((pageRef, index) => {
				if (!pageRef) return;

				const rect = pageRef.getBoundingClientRect();
				const containerRect = containerRef.current!.getBoundingClientRect();

				// Calculate how much of the page is visible in the viewport
				const visibleTop = Math.max(rect.top, containerRect.top);
				const visibleBottom = Math.min(rect.bottom, containerRect.bottom);

				if (visibleBottom > visibleTop) {
					const visibleArea = visibleBottom - visibleTop;
					if (visibleArea > maxVisibleArea) {
						maxVisibleArea = visibleArea;
						maxVisiblePage = index + 1;
					}
				}
			});

			if (maxVisiblePage !== currentPage) {
				setCurrentPage(maxVisiblePage);
			}
		};

		containerRef.current?.addEventListener('scroll', handleScroll);
		return () => containerRef.current?.removeEventListener('scroll', handleScroll);
	}, [currentPage]);

	useEffect(() => {
		if (allPagesLoaded) {
			console.log("All pages loaded, checking text layers...");

			// Create a timer that repeatedly checks if text layers are ready
			const checkInterval = setInterval(() => {
				if (checkTextLayersReady()) {
					console.log("Text layers are ready, applying highlights");
					clearInterval(checkInterval);

					loadHighlights();
					renderAnnotations(annotations);

					// Highlighting logic
					// Apply highlights after loading
					setTimeout(() => {
						if (highlights.length > 0) {
							const allMatches = findAllHighlightedPassages(highlights);
							console.log("Found highlight matches:", allMatches.length);
							const handlers = {
								setIsHighlightInteraction,
								setSelectedText,
								setTooltipPosition,
								setIsAnnotating,
								setActiveHighlight
							};

							for (const match of allMatches) {
								addHighlightToNodes(match.nodes, match.sourceHighlight, handlers);
							}
						}
					}, 100);
				} else {
					console.log("Text layers not ready yet, waiting...");
				}
			}, 200); // Check every 200ms

			// Clean up the interval if component unmounts
			return () => clearInterval(checkInterval);
		}
	}, [allPagesLoaded]);

	// Add this effect to reset isHighlightInteraction when selectedText becomes empty
	useEffect(() => {
		if (!selectedText) {
			// If there is no selected text, we're not in a highlight interaction anymore
			setIsHighlightInteraction(false);
		}
	}, [selectedText]);

	useEffect(() => {
		renderAnnotations(annotations);
	}, [annotations]);

	const checkTextLayersReady = () => {
		const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
		let allReady = true;

		// A page's text layer is ready if it contains span elements
		textLayers.forEach(layer => {
			const textNodes = layer.querySelectorAll('span');
			if (textNodes.length === 0) {
				allReady = false;
			}
		});

		// Make sure we have the expected number of text layers
		if (textLayers.length !== numPages) {
			allReady = false;
		}

		return allReady && textLayers.length > 0;
	};


	return (
		<div ref={containerRef} className="flex flex-col items-center gap-4 w-full h-[calc(100vh-100px)] overflow-y-auto" id="pdf-container">
			{/* Toolbar */}
			<div className="sticky top-0 z-10 flex items-center justify-between bg-white/80 dark:bg-white/10 backdrop-blur-sm p-2 rounded-none w-full border-b border-gray-300">
				<div className="flex items-center gap-2 flex-grow max-w-md">
					<Input
						type="text"
						placeholder="Search..."
						value={searchText}
						onChange={(e) => {
							if (e.target.value.trim() === "") {
								setSearchResults([]);
								setCurrentMatch(-1);
								setSearchText("");
								setNotFound(false);
							} else {
								setSearchText(e.target.value);
								setNotFound(false);
							}
						}}
						onKeyDown={(e) => e.key === 'Enter' && performSearch()}
						className="h-8 text-sm"
					/>
					<Button onClick={() => performSearch()} size="sm" variant="ghost" className="h-8 px-2">
						<Search size={16} />
					</Button>
				</div>

				{searchResults.length > 0 && (
					<div className="flex items-center gap-1 mx-2">
						<span className="text-xs text-secondary-foreground">{currentMatch + 1}/{searchResults.length}</span>
						<Button onClick={goToPreviousMatch} size="sm" variant="ghost" className="h-8 w-8 p-0">
							<ArrowLeft size={16} />
						</Button>
						<Button onClick={goToNextMatch} size="sm" variant="ghost" className="h-8 w-8 p-0">
							<ArrowRight size={16} />
						</Button>
						<Button onClick={() => setSearchResults([])} size="sm" variant="ghost" className="h-8 w-8 p-0">
							<X size={16} />
						</Button>
					</div>
				)}

				{
					searchText && notFound && (
						<div className="flex items-center gap-1 mx-2">
							<span className="text-xs text-red-500">No results found</span>
							<Button onClick={() => setSearchText("")} size="sm" variant="ghost" className="h-8 w-8 p-0">
								<X size={16} />
							</Button>
						</div>
					)
				}

				{/* Add page navigation controls */}
				<div className="flex items-center gap-1 mx-2">
					<Button
						onClick={goToPreviousPage}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0"
						disabled={currentPage <= 1}
					>
						<ArrowLeft size={16} />
					</Button>
					<span className="text-xs text-secondary-foreground">
						{currentPage} of {numPages || '?'}
					</span>
					<Button
						onClick={goToNextPage}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0"
						disabled={!numPages || currentPage >= numPages}
					>
						<ArrowRight size={16} />
					</Button>
				</div>

				<div className="flex items-center gap-1">
					<Button
						onClick={() => {
							zoomOut();
						}}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0">
						<Minus size={16} />
					</Button>
					<span className="text-xs w-12 text-center">{Math.round(scale * 100)}%</span>
					<Button
						onClick={() => {
							zoomIn();
						}}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0">
						<Plus size={16} />
					</Button>
				</div>
			</div>
			<Document
				file={pdfUrl}
				onLoadSuccess={onDocumentLoadSuccess}
				onLoadProgress={({ loaded, total }) => {
					// Handle loading progress if needed
					console.log(`Loading PDF: ${Math.round((loaded / total) * 100)}%`);
				}}
				onMouseUp={handleTextSelection}
				onLoadError={(error) => console.error("Error loading PDF:", error)}
				onContextMenu={handleTextSelection}
			>
				{/* <Outline
					onItemClick={(item) => {
						if (item.dest) {
							const pageIndex = item.pageNumber - 1;
							setCurrentPage(pageIndex + 1);
							pagesRef.current[pageIndex]?.scrollIntoView({ behavior: 'smooth' });
						}
					}}
				/> */}
				{Array.from(new Array(numPages || 0), (_, index) => (
					<div
						ref={(el) => {
							pagesRef.current[index] = el;
						}}
						key={`page_container_${index + 1}`}
					>
						<Page
							key={`page_${index + 1}`}
							pageNumber={index + 1}
							className="mb-8 border-b border-gray-300"
							renderTextLayer={true}
							onLoadSuccess={() => handlePageLoadSuccess(index)}
							renderAnnotationLayer={false}
							scale={scale}
							width={width > 0 ? width : undefined}
						/>
					</div>
				))}
			</Document>

			{/* Replace the fixed position div with a tooltip */}
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
					addHighlight={addHighlight}
					removeHighlight={removeHighlight}
					setUserMessageReferences={setUserMessageReferences}
				/>
			)}
		</div>
	);
}
