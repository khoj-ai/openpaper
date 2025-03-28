"use client";

import { useEffect, useRef, useState } from "react";
import "../lib/promisePolyfill";
import { Document, Outline, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "../app/globals.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, ArrowRight, X, Minus, Plus } from "lucide-react";
import { CommandShortcut } from "./ui/command";
import { PaperHighlight } from "@/app/paper/[id]/page";
import { getMatchingNodesInPdf } from "./utils/PdfTextUtils";

interface PdfViewerProps {
	pdfUrl: string;
	explicitSearchTerm?: string;
}

export function usePdfLoader() {
	const [numPages, setNumPages] = useState<number | null>(null);
	const [pagesLoaded, setPagesLoaded] = useState<boolean[]>([]);
	const [allPagesLoaded, setAllPagesLoaded] = useState(false);
	const [workerInitialized, setWorkerInitialized] = useState(false);

	// Initialize PDF.js worker
	useEffect(() => {
		if (!workerInitialized) {
			pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.mjs`;
			setWorkerInitialized(true);
		}
	}, [workerInitialized]);

	// Check when all pages are loaded
	useEffect(() => {
		if (pagesLoaded.length > 0 && pagesLoaded.every(loaded => loaded)) {
			setAllPagesLoaded(true);
		}
	}, [pagesLoaded]);

	const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
		setNumPages(numPages);
		setPagesLoaded(new Array(numPages).fill(false));
	};

	const handlePageLoadSuccess = (pageIndex: number) => {
		setPagesLoaded(prevLoaded => {
			const newLoaded = [...prevLoaded];
			newLoaded[pageIndex] = true;
			return newLoaded;
		});
	};

	return {
		numPages,
		allPagesLoaded,
		workerInitialized,
		onDocumentLoadSuccess,
		handlePageLoadSuccess,
	};
}

export function usePdfNavigation(numPages: number | null) {
	const [currentPage, setCurrentPage] = useState<number>(1);
	const [scale, setScale] = useState(1.2);
	const [width, setWidth] = useState<number>(0);
	const pagesRef = useRef<(HTMLDivElement | null)[]>([]);
	const containerRef = useRef<HTMLDivElement>(null);

	// Set up page refs when numPages changes
	useEffect(() => {
		if (numPages) {
			pagesRef.current = new Array(numPages).fill(null);
		}
	}, [numPages]);

	// Calculate container width for responsive sizing
	useEffect(() => {
		const updateWidth = () => {
			const container = document.getElementById('pdf-container');
			if (container) {
				setWidth(container.clientWidth - 32);
			}
		};

		updateWidth();
		window.addEventListener('resize', updateWidth);
		return () => window.removeEventListener('resize', updateWidth);
	}, []);

	// Update current page when scrolling
	useEffect(() => {
		const handleScroll = () => {
			if (!containerRef.current || pagesRef.current.length === 0) return;

			let maxVisiblePage = 1;
			let maxVisibleArea = 0;

			pagesRef.current.forEach((pageRef, index) => {
				if (!pageRef) return;

				const rect = pageRef.getBoundingClientRect();
				const containerRect = containerRef.current!.getBoundingClientRect();
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

	const goToPreviousPage = () => {
		if (currentPage > 1) {
			setCurrentPage(currentPage - 1);
			pagesRef.current[currentPage - 2]?.scrollIntoView({ behavior: 'smooth' });
		}
	};

	const goToNextPage = () => {
		if (numPages && currentPage < numPages) {
			setCurrentPage(currentPage + 1);
			pagesRef.current[currentPage]?.scrollIntoView({ behavior: 'smooth' });
		}
	};

	const zoomIn = () => setScale(prev => Math.min(prev + 0.2, 2.5));
	const zoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.7));

	return {
		currentPage,
		scale,
		width,
		pagesRef,
		containerRef,
		goToPreviousPage,
		goToNextPage,
		zoomIn,
		zoomOut,
	};
}

export function usePdfSearch(explicitSearchTerm?: string) {
	const [searchText, setSearchText] = useState("");
	const [searchResults, setSearchResults] = useState<Array<{
		pageIndex: number;
		matchIndex: number;
		nodes: Element[];
	}>>([]);
	const [currentMatch, setCurrentMatch] = useState(-1);
	const [notFound, setNotFound] = useState(false);

	// Handle explicit search term if provided
	useEffect(() => {
		if (explicitSearchTerm) {
			performSearch(explicitSearchTerm);
		}
	}, [explicitSearchTerm]);

	const performSearch = (term?: string) => {
		const textToSearch = term || searchText;
		if (!textToSearch.trim()) {
			setSearchResults([]);
			setCurrentMatch(-1);
			return;
		}

		setNotFound(false);
		const results = getMatchingNodesInPdf(textToSearch);

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

		// Get the page div from the document
		const pageDiv = document.querySelectorAll('.react-pdf__Page')[match.pageIndex];
		if (!pageDiv) return;

		// Scroll to the page
		pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

		// Remove styling from any existing highlights
		const pdfTextElements = document.querySelectorAll('.react-pdf__Page__textContent span.border-2');
		pdfTextElements.forEach(span => {
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

	return {
		searchText,
		setSearchText,
		searchResults,
		currentMatch,
		notFound,
		performSearch,
		goToNextMatch,
		goToPreviousMatch,
		setSearchResults,
		setNotFound,
		setCurrentMatch,
	};
}

export function PdfViewer({ pdfUrl, explicitSearchTerm }: PdfViewerProps) {
	const [currentPage, setCurrentPage] = useState<number>(1);
	const [selectedText, setSelectedText] = useState<string>("");
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number, y: number } | null>(null);
	const [isAnnotating, setIsAnnotating] = useState(false);
	const [workerInitialized, setWorkerInitialized] = useState(false);

	const { numPages, allPagesLoaded, onDocumentLoadSuccess, handlePageLoadSuccess } = usePdfLoader();
	const { scale, width, pagesRef, containerRef, goToPreviousPage, goToNextPage, zoomIn, zoomOut } = usePdfNavigation(numPages);

	// Highlight functionality
	const [highlights, setHighlights] = useState<Array<PaperHighlight>>([]);
	const [isHighlightInteraction, setIsHighlightInteraction] = useState(false);

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

	const findAllHighlightedPassages = (allHighlights: Array<PaperHighlight>) => {
		const results: Array<{ pageIndex: number; matchIndex: number; nodes: Element[], rawText: string }> = [];

		for (const highlight of allHighlights) {
			const textToSearch = highlight.raw_text.toLowerCase();
			const match = getSpecificMatchInPdf(textToSearch, highlight.occurrence_index);

			if (match) {
				results.push({
					pageIndex: match.pageIndex,
					matchIndex: match.matchIndex,
					nodes: match.nodes,
					rawText: highlight.raw_text
				});
			}
		}
		return results;
	}

	// Also modify the addHighlightToNodes function to be more reliable
	const addHighlightToNodes = (nodes: Element[], rawText: string) => {
		nodes.forEach(node => {
			// First remove any existing highlights to avoid duplicates
			node.classList.remove('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

			// Then add the highlight classes
			node.classList.add('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

			// Create a new node with the same content
			const newNode = node.cloneNode(true);

			// Add click handler directly to the new node
			newNode.addEventListener('click', (event) => {
				// Get coordinates at the time of the click
				const rect = (event.target as Element).getBoundingClientRect();

				setIsHighlightInteraction(true);
				setSelectedText(rawText);
				setTooltipPosition({
					x: rect.left + (rect.width / 2), // Center horizontally
					y: rect.top // Top of the element
				});
				setIsAnnotating(true);

				// Prevent event propagation
				event.stopPropagation();
			});

			// Replace the original node with the new one
			if (node.parentNode) {
				node.parentNode.replaceChild(newNode, node);
			}
		});
	};

	const saveHighlightsToLocalStorage = (highlights: Array<PaperHighlight>) => {
		// Save highlights to local storage
		localStorage.setItem("highlights", JSON.stringify(highlights));
	}

	// Also modify loadHighlightsFromLocalStorage to better handle the results
	const loadHighlightsFromLocalStorage = () => {
		// Load highlights from local storage
		const storedHighlights = localStorage.getItem("highlights");
		if (storedHighlights) {
			try {
				const parsedHighlights = JSON.parse(storedHighlights);
				console.log("Loaded highlights from local storage:", parsedHighlights);

				// Clear any existing highlights from DOM
				const existingHighlights = document.querySelectorAll('.react-pdf__Page__textContent span.border-2.border-blue-500');
				existingHighlights.forEach(node => {
					node.classList.remove('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

					// Remove event listeners by cloning and replacing the node
					const newNode = node.cloneNode(true);
					if (node.parentNode) {
						node.parentNode.replaceChild(newNode, node);
					}
				});

				// Set highlights state, which will trigger the useEffect that applies them
				setHighlights(parsedHighlights);
			} catch (error) {
				console.error("Error parsing highlights from local storage:", error);
			}
		}
	};

	useEffect(() => {
		console.log("Highlights changed:", highlights);
		if (highlights.length > 0) {
			// if (!highlightResults) {
			const allMatches = findAllHighlightedPassages(highlights);
			for (const match of allMatches) {
				addHighlightToNodes(match.nodes, match.rawText);
			}
			saveHighlightsToLocalStorage(highlights);
		}
	}, [highlights]);


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
							for (const match of allMatches) {
								addHighlightToNodes(match.nodes, match.rawText);
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
				if (!window.getSelection()?.toString() && !isHighlightInteraction) {
					setSelectedText("");
					setTooltipPosition(null);
				}
				setIsHighlightInteraction(false); // Reset it after check
			}, 10);
		}
	};

	const getOccurrenceIndexOfSelection = (text: string) => {
		// Get all occurrences of this text in the document
		const allOccurrences = getMatchingNodesInPdf(text);

		// Get the current selection
		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) return 0;

		const range = selection.getRangeAt(0);
		const selectionNode = range.startContainer.parentElement;

		// Find which occurrence this selection belongs to
		for (let i = 0; i < allOccurrences.length; i++) {
			const nodes = allOccurrences[i].nodes;
			if (nodes.some(node => node === selectionNode || node.contains(selectionNode))) {
				return i;
			}
		}

		return 0; // Default to first occurrence if not found
	};

	const getSpecificMatchInPdf = (searchTerm: string, occurrenceIndex: number = 0) => {
		const allMatches = getMatchingNodesInPdf(searchTerm);

		// Check if the requested occurrence exists
		if (occurrenceIndex >= 0 && occurrenceIndex < allMatches.length) {
			return allMatches[occurrenceIndex];
		}

		// Return null or undefined if not found
		return null;
	};

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
				<Button
					onClick={() => {
						// Save highlights to local storage
						loadHighlightsFromLocalStorage();
					}}
				>
					Load Highlights
				</Button>
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
								e.stopPropagation();

								// Get the current page number
								const pageNumber = currentPage;

								// Get which occurrence of this text this selection represents
								const occurrenceIndex = getOccurrenceIndexOfSelection(selectedText);

								// Add to highlights with occurrence information
								setHighlights([
									...highlights,
									{
										raw_text: selectedText,
										annotation: "",
										occurrence_index: occurrenceIndex
									}
								]);

								console.log("Annotating:", selectedText, "Page:", pageNumber, "Occurrence:", occurrenceIndex);
							}}
						>
							Annotate
						</Button>
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
			)}
		</div>
	);
}
