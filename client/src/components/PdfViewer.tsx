"use client";

import { useEffect, useRef, useState } from "react";
import "../lib/promisePolyfill";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "../app/globals.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, ArrowRight, X, Minus, Plus } from "lucide-react";
import { CommandShortcut } from "./ui/command";

interface PdfViewerProps {
	pdfUrl: string;
	explicitSearchTerm?: string;
}

export function PdfViewer({ pdfUrl, explicitSearchTerm }: PdfViewerProps) {
	const [numPages, setNumPages] = useState<number | null>(null);
	const [currentPage, setCurrentPage] = useState<number>(1);
	const [selectedText, setSelectedText] = useState<string>("");
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number, y: number } | null>(null);
	const [isAnnotating, setIsAnnotating] = useState(false);
	const [workerInitialized, setWorkerInitialized] = useState(false);

	const [scale, setScale] = useState(1.2); // Higher scale for better resolution
	const [width, setWidth] = useState<number>(0);

	// Highlight functionality
	const [highlights, setHighlights] = useState<Array<{ text: string; page: number }>>([]);

	// Search functionality
	const [searchText, setSearchText] = useState("");
	const [searchResults, setSearchResults] = useState<Array<{
		pageIndex: number;
		matchIndex: number;
		nodes: Element[];
	}>>([]);
	const [currentMatch, setCurrentMatch] = useState(-1);
	const [notFound, setNotFound] = useState(false);

	const pagesRef = useRef<(HTMLDivElement | null)[]>([]);
	const containerRef = useRef<HTMLDivElement>(null);

	// Set up the worker in useEffect to ensure it only runs in the browser
	useEffect(() => {
		if (!workerInitialized) {
			// Use the .mjs worker file we found
			pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.mjs`;
			setWorkerInitialized(true);
		}
	}, [workerInitialized]);

	useEffect(() => {
		// If an explicit search term is provided, set it and perform the search
		if (explicitSearchTerm) {
			performSearch(explicitSearchTerm);
		}
	}, [explicitSearchTerm]);

	// Calculate container width for responsive sizing
	useEffect(() => {
		const updateWidth = () => {
			// Get container width and use it for PDF rendering
			const container = document.getElementById('pdf-container');
			if (container) {
				// Subtract some padding to avoid horizontal scrollbar
				setWidth(container.clientWidth - 32);
			}
		};

		updateWidth();
		window.addEventListener('resize', updateWidth);
		return () => window.removeEventListener('resize', updateWidth);
	}, []);

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

	const goToPreviousPage = () => {
		if (currentPage > 1) {
			setCurrentPage(currentPage - 1);
			// Scroll to the new page
			pagesRef.current[currentPage - 2]?.scrollIntoView({ behavior: 'smooth' });
		}
	};

	const goToNextPage = () => {
		if (numPages && currentPage < numPages) {
			setCurrentPage(currentPage + 1);
			// Scroll to the new page
			pagesRef.current[currentPage]?.scrollIntoView({ behavior: 'smooth' });
		}
	};

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

	const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
		setNumPages(numPages);
		// Initialize page refs array
		pagesRef.current = new Array(numPages).fill(null);
	};

	const handleTextSelection = (e: React.MouseEvent | MouseEvent) => {
		if (isAnnotating) return; // Ignore if annotating

		const selection = window.getSelection();
		if (selection && selection.toString()) {
			let text = selection.toString();

			// Normalize the text while preserving paragraph structure

			// 1. Identify and preserve paragraph breaks (double newlines, or newlines after sentence endings)
			// Mark paragraph breaks with a special character sequence
			text = text.replace(/(\.\s*)\n+/g, '$1{PARA_BREAK}'); // Period followed by newline
			text = text.replace(/(\?\s*)\n+/g, '$1{PARA_BREAK}'); // Question mark followed by newline
			text = text.replace(/(\!\s*)\n+/g, '$1{PARA_BREAK}'); // Exclamation mark followed by newline
			text = text.replace(/\n\s*\n+/g, '{PARA_BREAK}');     // Multiple newlines

			// 2. Replace remaining newlines with spaces (these are likely just line breaks in the same paragraph)
			text = text.replace(/\n/g, ' ');

			// 3. Restore paragraph breaks with actual newlines
			text = text.replace(/{PARA_BREAK}/g, '\n\n');

			// 4. Clean up any excessive spaces
			text = text.replace(/\s+/g, ' ').trim();

			setSelectedText(text);

			// Set tooltip position near cursor
			setTooltipPosition({
				x: e.clientX,
				y: e.clientY
			});
		} else {
			// If no text is selected, hide the tooltip after a small delay
			// to allow clicking on the tooltip buttons
			setTimeout(() => {
				if (!window.getSelection()?.toString()) {
					setSelectedText("");
					setTooltipPosition(null);
				}
			}, 10);
		}
	};


	const zoomIn = () => setScale(prev => Math.min(prev + 0.2, 2.5));
	const zoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.7));

	const getMatchingNodesInPdf = (searchTerm: string) => {
		const results: Array<{ pageIndex: number; matchIndex: number; nodes: Element[] }> = [];
		const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
		textLayers.forEach((layer, pageIndex) => {
			const textNodes = Array.from(layer.querySelectorAll('span'));
			if (textNodes.length === 0) return;

			const filteredTextNodes = textNodes.filter(node => node.textContent && node.textContent.trim() !== '');
			const fullPageText = filteredTextNodes.map(node => node.textContent || '').join(' ');

			const searchTextLower = searchTerm.toLowerCase();
			const fullPageTextLower = fullPageText.toLowerCase();

			let startIndex = 0;
			let matchIndex = 0;

			while (startIndex < fullPageTextLower.length) {
				const foundIndex = fullPageTextLower.indexOf(searchTextLower, startIndex);
				if (foundIndex === -1) break;

				const matchStart = foundIndex;
				const matchEnd = matchStart + searchTextLower.length;

				let currentPosition = 0;
				const matchingNodes: Element[] = [];

				for (const node of filteredTextNodes) {
					const nodeText = node.textContent || '';
					const nodeLength = nodeText.length + 1; // +1 for the added space

					const nodeStart = currentPosition;
					const nodeEnd = currentPosition + nodeLength;

					if (
						(matchStart >= nodeStart && matchStart < nodeEnd) ||
						(matchEnd > nodeStart && matchEnd <= nodeEnd) ||
						(matchStart <= nodeStart && matchEnd >= nodeEnd)
					) {
						matchingNodes.push(node);
					}

					currentPosition += nodeLength;
				}

				if (matchingNodes.length > 0) {
					results.push({ pageIndex, matchIndex, nodes: matchingNodes });
					matchIndex++;
				}

				startIndex = foundIndex + 1;
			}
		});

		return results;
	}


	const performSearch = (term?: string) => {
		console.log("performing search with searchText:", searchText);
		const textToSearch = term || searchText;
		if (!textToSearch.trim()) {
			setSearchResults([]);
			setCurrentMatch(-1);
			return;
		}

		setNotFound(false);

		const results: Array<{ pageIndex: number; matchIndex: number; nodes: Element[] }> = getMatchingNodesInPdf(textToSearch);

		if (results.length === 0) {
			setNotFound(true);
		}

		setSearchResults(results);
		setCurrentMatch(results.length > 0 ? 0 : -1);

		// Scroll to first match if found
		if (results.length > 0) {
			scrollToMatch(results[0]);
		}
	};

	const scrollToMatch = (match: { pageIndex: number; matchIndex: number; nodes: Element[] }) => {
		if (!match) return;

		const pageDiv = pagesRef.current[match.pageIndex];
		if (!pageDiv) return;

		// Scroll to the page
		pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

		// Remove styling from any existing highlights
		const existingHighlights = document.querySelectorAll('.react-pdf__Page__textContent span.border-2');
		existingHighlights.forEach(span => {
			span.classList.remove('border-2', 'border-yellow-500', 'bg-yellow-100', 'rounded', 'opacity-20');
		});

		// Highlight all nodes that contain parts of the match
		setTimeout(() => {
			match.nodes.forEach(node => {
				node.classList.add('border-2', 'border-yellow-500', 'bg-yellow-100', 'rounded', 'opacity-20');
			});

			// Scroll to the first matching node
			if (match.nodes.length > 0) {
				match.nodes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}, 100);
	};


	const goToNextMatch = () => {
		if (searchResults.length === 0) return;

		const nextMatch = (currentMatch + 1) % searchResults.length;
		setCurrentMatch(nextMatch);
		scrollToMatch(searchResults[nextMatch]);
	};

	const goToPreviousMatch = () => {
		if (searchResults.length === 0) return;

		const prevMatch = (currentMatch - 1 + searchResults.length) % searchResults.length;
		setCurrentMatch(prevMatch);
		scrollToMatch(searchResults[prevMatch]);
	};

	const localizeCommandToOS = (key: string) => {
		// Check if the user is on macOS using userAgent
		const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
		if (isMac) {
			return `⌘ ${key}`;
		} else {
			return `Ctrl ${key}`;
		}
	}


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
				onMouseUp={handleTextSelection}
				onLoadError={(error) => console.error("Error loading PDF:", error)}
				onContextMenu={handleTextSelection}
			>
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
							renderAnnotationLayer={false}
							scale={scale}
							width={width > 0 ? width : undefined}
						/>
					</div>
				))}
			</Document>

			{/* Replace the fixed position div with a tooltip */}
			{selectedText && tooltipPosition && (
				<div
					className="fixed z-30 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-2 border border-gray-200 dark:border-gray-700"
					style={{
						left: `${Math.min(tooltipPosition.x, window.innerWidth - 200)}px`,
						top: `${tooltipPosition.y + 20}px`, // Position slightly below the cursor
					}}
					onClick={(e) => e.stopPropagation()} // Stop click events from bubbling
				>
					<div className="flex gap-2 text-sm">
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
								e.stopPropagation(); // Stop event propagation
								// setIsAnnotating(true);
								// Your annotation logic here
								console.log("Annotating:", selectedText);

								// If you want to implement an annotation form or other UI
								// instead of immediately closing the tooltip:
								// - Keep the tooltip open
								// - Show annotation UI

								// If you want to close the tooltip after annotating:
								// setSelectedText("");
								// setTooltipPosition(null);
								// setIsAnnotating(false);
							}}
						>
							Annotate
						</Button>
						{/* <Button
							className="px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
							onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
							onClick={(e) => {
								e.stopPropagation(); // Stop event propagation
								setSelectedText("");
								setTooltipPosition(null);
								setIsAnnotating(false);
							}}
						>
							Cancel
						</Button> */}
					</div>
				</div>
			)}
		</div>
	);
}
