"use client";

import { useEffect, useState } from "react";
import "../lib/promisePolyfill";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "../app/globals.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, ArrowRight, X, Minus, Plus, Highlighter } from "lucide-react";
import { CommandShortcut } from "@/components/ui/command";
import { PaperHighlight } from "@/app/paper/[id]/page";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { addHighlightToNodes, findAllHighlightedPassages } from "./utils/PdfHighlightUtils";
import { usePdfSearch } from "./hooks/PdfSearch";
import { usePdfNavigation } from "./hooks/PdfNavigation";
import { usePdfLoader } from "./hooks/PdfLoader";
import { useHighlights } from "./hooks/PdfHighlight";

interface PdfViewerProps {
	pdfUrl: string;
	explicitSearchTerm?: string;
}

function InlineAnnotationMenu({
	selectedText,
	tooltipPosition,
	setSelectedText,
	setTooltipPosition,
	setIsAnnotating,
	highlights,
	setHighlights,
	isHighlightInteraction,
	activeHighlight,
	addHighlight
}: {
	selectedText: string;
	tooltipPosition: { x: number; y: number } | null;
	setSelectedText: (text: string) => void;
	setTooltipPosition: (position: { x: number; y: number } | null) => void;
	setIsAnnotating: (isAnnotating: boolean) => void;
	highlights: Array<PaperHighlight>;
	setHighlights: (highlights: Array<PaperHighlight>) => void;
	isHighlightInteraction: boolean;
	activeHighlight: PaperHighlight | null;
	addHighlight: (selectedText: string, annotation?: string) => void;
}) {

	const localizeCommandToOS = (key: string) => {
		// Check if the user is on macOS using userAgent
		const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
		if (isMac) {
			return `⌘ ${key}`;
		} else {
			return `Ctrl ${key}`;
		}
	}

	const [annotationText, setAnnotationText] = useState<string>("");

	if (!tooltipPosition) return null;

	return (
		<div
			className="fixed z-30 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-2 border border-gray-200 dark:border-gray-700"
			style={{
				left: `${Math.min(tooltipPosition.x, window.innerWidth - 200)}px`,
				top: `${tooltipPosition.y + 20}px`, // Position slightly below the cursor
			}}
			onClick={(e) => e.stopPropagation()} // Stop click events from bubbling
			onMouseDown={(e) => e.stopPropagation()} // Also prevent mousedown from bubbling
		>
			<div className="flex flex-col gap-2 text-sm">
				<Button
					variant={'ghost'}
					onClick={() => {
						navigator.clipboard.writeText(selectedText);
						setSelectedText("");
						setTooltipPosition(null);
						setIsAnnotating(false);
					}}
				>
					<CommandShortcut>
						<span className="text-secondary-foreground">
							{localizeCommandToOS('C')}
						</span>
					</CommandShortcut>
				</Button>
				<Button
					className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
					onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
					onClick={(e) => {
						e.stopPropagation();
						console.log("Adding highlight:", selectedText);

						// Use the new addHighlight function that uses offsets
						addHighlight(selectedText, "");
					}}
				>
					<Highlighter size={16} />
					<span className="text-white">Highlight</span>
				</Button>
				{
					isHighlightInteraction && (
						<Button
							variant={'ghost'}
							onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
							onClick={(e) => {
								e.stopPropagation();

								// Remove the highlight based on offsets
								if (activeHighlight) {
									const newHighlights = highlights.filter((highlight) => {
										// Remove the highlight if it matches the active highlight based on offsets
										return !(highlight.start_offset === activeHighlight.start_offset &&
											highlight.end_offset === activeHighlight.end_offset);
									});

									setHighlights(newHighlights);
									setSelectedText("");
									setTooltipPosition(null);
									setIsAnnotating(false);
								}
							}}
						>
							<Minus size={16} />
						</Button>
					)
				}
				<Popover>
					<PopoverTrigger
						asChild>
						<Button
							variant={'ghost'}
							onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
							onClick={(e) => {
								e.stopPropagation();
								setIsAnnotating(true);
							}}
						>
							Annotate
						</Button>
					</PopoverTrigger>
					<PopoverContent>
						<div className="flex flex-col gap-2">
							<Textarea
								placeholder="Add a note..."
								value={annotationText}
								onChange={(e) => setAnnotationText(e.target.value)}
							/>
							<Button
								className="w-fit"
								onClick={() => {
									console.log("Adding annotation:", annotationText);
									console.log("Selected text:", selectedText);
									// If using an activeHighlight, first get the matching one in the current set of highlights, then update it
									if (activeHighlight) {
										const updatedHighlights = highlights.map(highlight => {
											if (highlight.start_offset === activeHighlight.start_offset &&
												highlight.end_offset === activeHighlight.end_offset) {
												return { ...highlight, annotation: annotationText };
											}
											return highlight;
										});
										setHighlights(updatedHighlights);
									} else {
										// Use the new addHighlight function with annotation
										addHighlight(selectedText, annotationText);
									}
									setAnnotationText("");
									setSelectedText("");
									setTooltipPosition(null);
									setIsAnnotating(false);
								}}
							>
								Add Annotation
							</Button>
						</div>
					</PopoverContent>
				</Popover>

				<Button
					variant={'ghost'}
					onClick={() => {
						setSelectedText("");
						setTooltipPosition(null);
						setIsAnnotating(false);
					}}
				>
					<X size={16} />
				</Button>
			</div>
		</div>
	)
}


export function PdfViewer({ pdfUrl, explicitSearchTerm }: PdfViewerProps) {
	const [currentPage, setCurrentPage] = useState<number>(1);

	const { numPages, allPagesLoaded, onDocumentLoadSuccess, handlePageLoadSuccess } = usePdfLoader();
	const { scale, width, pagesRef, containerRef, goToPreviousPage, goToNextPage, zoomIn, zoomOut } = usePdfNavigation(numPages);
	// Highlight functionality
	const { highlights, setHighlights, selectedText, setSelectedText, tooltipPosition, setTooltipPosition, isAnnotating, setIsAnnotating, isHighlightInteraction, setIsHighlightInteraction, activeHighlight, setActiveHighlight, handleTextSelection, loadHighlightsFromLocalStorage, addHighlight } = useHighlights();


	// Search functionality
	const { searchText, setSearchText, searchResults, currentMatch, notFound, performSearch, goToNextMatch, goToPreviousMatch, setSearchResults, setNotFound, setCurrentMatch } = usePdfSearch(explicitSearchTerm);

	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			// Only handle keyboard events if annotating is active
			if (isAnnotating) {
				if (e.key === "Escape") {
					// Reset selected text and tooltip position on Escape
					setSelectedText("");
					setTooltipPosition(null);
					setIsAnnotating(false);
				}

				if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
					// Copy selected text to clipboard
					navigator.clipboard.writeText(selectedText);
				}
			}
		};

		window.addEventListener("keydown", down);
		return () => window.removeEventListener("keydown", down);
	}, [isAnnotating, selectedText]);


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

					loadHighlightsFromLocalStorage();

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
					<Button onClick={zoomOut} size="sm" variant="ghost" className="h-8 w-8 p-0">
						<Minus size={16} />
					</Button>
					<span className="text-xs w-12 text-center">{Math.round(scale * 100)}%</span>
					<Button onClick={zoomIn} size="sm" variant="ghost" className="h-8 w-8 p-0">
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
				/>
			)}
		</div>
	);
}
