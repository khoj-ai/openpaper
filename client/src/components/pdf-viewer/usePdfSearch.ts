"use client";

import { useState, useCallback, useRef, useEffect, MutableRefObject } from "react";
import { PdfHighlighterUtils } from "react-pdf-highlighter-extended";
import {
	normalizeForSearch,
	ligatureMap,
	greekLetterMap,
	quoteChars,
} from "./textNormalization";

interface UsePdfSearchOptions {
	highlighterUtilsRef: MutableRefObject<PdfHighlighterUtils | null>;
	pdfDocumentRef: MutableRefObject<unknown>;
	setCurrentPage: (page: number) => void;
	explicitSearchTerm?: string;
}

interface UsePdfSearchReturn {
	// State
	searchText: string;
	showSearchInput: boolean;
	matchPages: number[];
	currentMatchIndex: number;
	isSearching: boolean;
	searchInputRef: MutableRefObject<HTMLInputElement | null>;
	lastSearchTermRef: MutableRefObject<string | undefined>;

	// Actions
	setSearchText: (text: string) => void;
	setShowSearchInput: (show: boolean) => void;
	performSearch: (term: string) => Promise<number[]>;
	goToMatch: (matchIndex: number, pages?: number[]) => Promise<void>;
	goToNextMatch: () => void;
	goToPreviousMatch: () => void;
	handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	handleSearchSubmit: (e: React.FormEvent) => Promise<void>;
	handleClearSearch: () => void;
}

export function usePdfSearch({
	highlighterUtilsRef,
	pdfDocumentRef,
	setCurrentPage,
	explicitSearchTerm,
}: UsePdfSearchOptions): UsePdfSearchReturn {
	const [searchText, setSearchText] = useState(explicitSearchTerm || "");
	const [showSearchInput, setShowSearchInput] = useState(false);
	const [searchMatches, setSearchMatches] = useState<HTMLElement[][]>([]);
	const [matchPages, setMatchPages] = useState<number[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);

	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const lastSearchTermRef = useRef<string | undefined>(undefined);
	const searchPartsRef = useRef<string[]>([]);
	const isNavigatingRef = useRef(false);
	const matchPagesRef = useRef<number[]>([]);

	// Search for a single term in a text layer and return match groups
	const searchInTextLayer = useCallback(
		(
			textLayer: Element,
			searchTerm: string,
			matchGroups: HTMLElement[][]
		) => {
			const spans = Array.from(textLayer.querySelectorAll("span"));

			interface CharMapping {
				span: HTMLSpanElement;
				originalCharIndex: number;
				textNode: Text | null;
				isVirtual?: boolean;
			}

			let normalizedCombined = "";
			const charMappings: CharMapping[] = [];

			spans.forEach((span) => {
				const originalText = span.textContent || "";
				const textNode = span.firstChild as Text | null;

				if (originalText.length === 0) return;

				if (normalizedCombined.length > 0 && !normalizedCombined.endsWith(" ")) {
					normalizedCombined += " ";
					charMappings.push({ span, originalCharIndex: -1, textNode, isVirtual: true });
				}

				let prevWasSpace = normalizedCombined.endsWith(" ");

				for (let i = 0; i < originalText.length; i++) {
					const char = originalText[i];

					if (ligatureMap[char]) {
						for (const expandedChar of ligatureMap[char]) {
							normalizedCombined += expandedChar;
							charMappings.push({ span, originalCharIndex: i, textNode });
						}
						prevWasSpace = false;
					} else if (greekLetterMap[char]) {
						for (const expandedChar of greekLetterMap[char]) {
							normalizedCombined += expandedChar;
							charMappings.push({ span, originalCharIndex: i, textNode });
						}
						prevWasSpace = false;
					} else if (quoteChars.has(char)) {
						continue;
					} else if (/[\p{L}\p{N}]/u.test(char)) {
						normalizedCombined += char;
						charMappings.push({ span, originalCharIndex: i, textNode });
						prevWasSpace = false;
					} else {
						if (!prevWasSpace) {
							normalizedCombined += " ";
							charMappings.push({ span, originalCharIndex: i, textNode });
							prevWasSpace = true;
						}
					}
				}
			});

			while (normalizedCombined.startsWith(" ")) {
				normalizedCombined = normalizedCombined.slice(1);
				charMappings.shift();
			}
			while (normalizedCombined.endsWith(" ")) {
				normalizedCombined = normalizedCombined.slice(0, -1);
				charMappings.pop();
			}

			const normalizedLower = normalizedCombined.toLowerCase();
			const normalizedTerm = normalizeForSearch(searchTerm).trim().toLowerCase();

			if (!normalizedTerm || charMappings.length === 0) return;

			let spaceStrippedText = "";
			const spaceStrippedToNormalizedIndex: number[] = [];

			for (let i = 0; i < normalizedLower.length; i++) {
				if (normalizedLower[i] !== ' ') {
					spaceStrippedToNormalizedIndex.push(i);
					spaceStrippedText += normalizedLower[i];
				}
			}

			const spaceStrippedTerm = normalizedTerm.replace(/\s+/g, '');

			if (!spaceStrippedTerm) return;

			let searchIndex = normalizedLower.indexOf(normalizedTerm);
			let useSpaceStripped = false;

			if (searchIndex === -1) {
				searchIndex = spaceStrippedText.indexOf(spaceStrippedTerm);
				useSpaceStripped = true;
			}

			while (searchIndex !== -1) {
				let normalizedStartIndex: number;
				let normalizedEndIndex: number;

				if (useSpaceStripped) {
					normalizedStartIndex = spaceStrippedToNormalizedIndex[searchIndex];
					const endInStripped = searchIndex + spaceStrippedTerm.length - 1;
					normalizedEndIndex = spaceStrippedToNormalizedIndex[endInStripped] + 1;
				} else {
					normalizedStartIndex = searchIndex;
					normalizedEndIndex = searchIndex + normalizedTerm.length;
				}

				const textLayerRect = textLayer.getBoundingClientRect();
				const matchElements: HTMLElement[] = [];

				interface HighlightRange {
					span: HTMLSpanElement;
					textNode: Text | null;
					startIdx: number;
					endIdx: number;
				}

				const ranges: HighlightRange[] = [];
				let currentRange: HighlightRange | null = null;

				for (let i = normalizedStartIndex; i < normalizedEndIndex && i < charMappings.length; i++) {
					const mapping = charMappings[i];

					if (mapping.isVirtual) {
						continue;
					}

					if (
						currentRange &&
						currentRange.span === mapping.span &&
						currentRange.endIdx === mapping.originalCharIndex
					) {
						currentRange.endIdx = mapping.originalCharIndex + 1;
					} else if (
						currentRange &&
						currentRange.span === mapping.span &&
						currentRange.endIdx === mapping.originalCharIndex + 1
					) {
						// Same position (ligature case)
					} else {
						if (currentRange) {
							ranges.push(currentRange);
						}
						currentRange = {
							span: mapping.span,
							textNode: mapping.textNode,
							startIdx: mapping.originalCharIndex,
							endIdx: mapping.originalCharIndex + 1,
						};
					}
				}
				if (currentRange) {
					ranges.push(currentRange);
				}

				for (const range of ranges) {
					if (range.textNode && range.textNode.nodeType === Node.TEXT_NODE) {
						try {
							const domRange = document.createRange();
							const safeStart = Math.min(range.startIdx, range.textNode.length);
							const safeEnd = Math.min(range.endIdx, range.textNode.length);

							if (safeStart >= safeEnd) continue;

							domRange.setStart(range.textNode, safeStart);
							domRange.setEnd(range.textNode, safeEnd);

							const rects = domRange.getClientRects();
							for (let i = 0; i < rects.length; i++) {
								const rect = rects[i];
								if (rect.width === 0 || rect.height === 0) continue;

								const highlight = document.createElement("div");
								highlight.className = "search-highlight-overlay";
								highlight.style.position = "absolute";
								highlight.style.left = `${rect.left - textLayerRect.left}px`;
								highlight.style.top = `${rect.top - textLayerRect.top}px`;
								highlight.style.width = `${rect.width}px`;
								highlight.style.height = `${rect.height}px`;
								highlight.style.backgroundColor = "rgba(255, 235, 59, 0.4)";
								highlight.style.borderRadius = "2px";
								highlight.style.pointerEvents = "none";
								highlight.style.mixBlendMode = "multiply";

								textLayer.appendChild(highlight);
								matchElements.push(highlight);
							}
						} catch (e) {
							console.warn("Range error:", e);
						}
					}
				}

				if (matchElements.length > 0) {
					matchGroups.push(matchElements);
				}

				if (useSpaceStripped) {
					searchIndex = spaceStrippedText.indexOf(spaceStrippedTerm, searchIndex + 1);
				} else {
					searchIndex = normalizedLower.indexOf(normalizedTerm, searchIndex + 1);
				}
			}
		},
		[]
	);

	// Perform search using PDF.js text extraction
	const performSearch = useCallback(async (term: string): Promise<number[]> => {
		const existingHighlights = document.querySelectorAll(".search-highlight-overlay");
		existingHighlights.forEach((el) => el.remove());

		if (!term || term.trim() === "") {
			setSearchMatches([]);
			setMatchPages([]);
			matchPagesRef.current = [];
			setCurrentMatchIndex(0);
			setIsSearching(false);
			searchPartsRef.current = [];
			return [];
		}

		setIsSearching(true);

		const ellipsisPattern = /\.{3,}|…/g;
		const trimmedTerm = term.replace(/^(\.{3,}|…)+/, '').replace(/(\.{3,}|…)+$/, '');
		const searchParts = trimmedTerm
			.split(ellipsisPattern)
			.map((part) => part.trim())
			.filter((part) => part.length > 3);

		if (searchParts.length === 0) {
			setSearchMatches([]);
			setMatchPages([]);
			matchPagesRef.current = [];
			setCurrentMatchIndex(0);
			setIsSearching(false);
			return [];
		}

		searchPartsRef.current = searchParts;

		const allMatchPages: number[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pdfDoc = pdfDocumentRef.current as any;

		if (pdfDoc) {
			for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
				try {
					const page = await pdfDoc.getPage(pageNum);
					const textContent = await page.getTextContent();
					const pageText = textContent.items
						.map((item: { str?: string }) => item.str || '')
						.join(' ');

					const normalizedPageText = normalizeForSearch(pageText).toLowerCase();
					const spaceStrippedPageText = normalizedPageText.replace(/\s+/g, '');

					for (const searchPart of searchParts) {
						const normalizedSearch = normalizeForSearch(searchPart).toLowerCase();
						const spaceStrippedSearch = normalizedSearch.replace(/\s+/g, '');

						let searchIn = normalizedPageText;
						let searchFor = normalizedSearch;
						if (!searchIn.includes(searchFor)) {
							searchIn = spaceStrippedPageText;
							searchFor = spaceStrippedSearch;
						}

						let pos = 0;
						while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) {
							allMatchPages.push(pageNum);
							pos += searchFor.length;
						}
					}
				} catch (err) {
					console.warn(`Failed to extract text from page ${pageNum}:`, err);
				}
			}
		}

		matchPagesRef.current = allMatchPages;
		setMatchPages(allMatchPages);
		setCurrentMatchIndex(0);
		setIsSearching(false);

		return allMatchPages;
	}, [pdfDocumentRef]);

	// Navigate to a specific match by index
	const goToMatch = useCallback(async (matchIndex: number, pages?: number[]) => {
		const effectivePages = pages ?? matchPagesRef.current;
		if (effectivePages.length === 0 || matchIndex < 0 || matchIndex >= effectivePages.length) {
			return;
		}

		if (isNavigatingRef.current) return;
		isNavigatingRef.current = true;

		try {
			const targetPage = effectivePages[matchIndex];
			setCurrentMatchIndex(matchIndex);

			document.querySelectorAll(".search-highlight-overlay").forEach(el => el.remove());

			const viewer = highlighterUtilsRef.current?.getViewer();
			if (viewer && viewer.currentPageNumber !== targetPage) {
				viewer.currentPageNumber = targetPage;
				setCurrentPage(targetPage);
				await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
			}

			const maxWait = 3000;
			const startTime = Date.now();

			const waitForTextLayer = (): Promise<Element | null> => {
				return new Promise((resolve) => {
					const check = () => {
						const pageEl = document.querySelector(`.page[data-page-number="${targetPage}"]`);
						const textLayer = pageEl?.querySelector(".textLayer") ?? null;
						const spans = textLayer?.querySelectorAll("span");
						if (textLayer && spans && spans.length > 5) {
							resolve(textLayer);
							return;
						}
						if (Date.now() - startTime > maxWait) {
							resolve(null);
							return;
						}
						setTimeout(check, 50);
					};
					check();
				});
			};

			const textLayer = await waitForTextLayer();
			if (!textLayer) {
				console.warn(`Timeout waiting for text layer on page ${targetPage}`);
				return;
			}

			await new Promise(resolve => setTimeout(resolve, 100));

			const matchGroups: HTMLElement[][] = [];
			for (const searchPart of searchPartsRef.current) {
				searchInTextLayer(textLayer, searchPart, matchGroups);
			}

			setSearchMatches(matchGroups);

			let matchesBeforeThisPage = 0;
			for (let i = 0; i < matchIndex; i++) {
				if (effectivePages[i] < targetPage) {
					matchesBeforeThisPage++;
				} else {
					break;
				}
			}
			const matchIndexOnPage = matchIndex - matchesBeforeThisPage;

			matchGroups.forEach((group, idx) => {
				const color = idx === matchIndexOnPage ? "rgba(255, 235, 59, 0.6)" : "rgba(255, 235, 59, 0.4)";
				group.forEach(el => {
					el.style.backgroundColor = color;
				});
			});

			if (matchGroups[matchIndexOnPage]?.[0]) {
				matchGroups[matchIndexOnPage][0].scrollIntoView({ behavior: "smooth", block: "center" });
			}
		} finally {
			isNavigatingRef.current = false;
		}
	}, [highlighterUtilsRef, setCurrentPage, searchInTextLayer]);

	// Navigate to next match
	const goToNextMatch = useCallback(() => {
		const pages = matchPagesRef.current;
		if (pages.length === 0) return;
		const nextIndex = (currentMatchIndex + 1) % pages.length;
		goToMatch(nextIndex, pages);
	}, [currentMatchIndex, goToMatch]);

	// Navigate to previous match
	const goToPreviousMatch = useCallback(() => {
		const pages = matchPagesRef.current;
		if (pages.length === 0) return;
		const prevIndex = (currentMatchIndex - 1 + pages.length) % pages.length;
		goToMatch(prevIndex, pages);
	}, [currentMatchIndex, goToMatch]);

	// Handle explicit search term from props
	useEffect(() => {
		if (explicitSearchTerm === lastSearchTermRef.current) return;
		lastSearchTermRef.current = explicitSearchTerm;

		if (explicitSearchTerm) {
			setSearchText(explicitSearchTerm);
			setShowSearchInput(true);
		}

		const doSearch = async () => {
			const pages = await performSearch(explicitSearchTerm || "");
			if (pages.length > 0) {
				goToMatch(0, pages);
			}
		};
		doSearch();
	}, [explicitSearchTerm, performSearch, goToMatch]);

	// Handle keyboard shortcut for search (Cmd/Ctrl + F)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				e.preventDefault();
				setShowSearchInput(true);
				setTimeout(() => searchInputRef.current?.focus(), 0);
			}
			if (e.key === "Escape" && showSearchInput) {
				setShowSearchInput(false);
				setSearchText("");
				performSearch("");
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [showSearchInput, performSearch]);

	// Handle search input change
	const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		setSearchText(e.target.value);
	}, []);

	// Handle search submit
	const handleSearchSubmit = useCallback(async (e: React.FormEvent) => {
		e.preventDefault();
		if (matchPages.length > 0 && lastSearchTermRef.current === searchText) {
			goToNextMatch();
		} else {
			lastSearchTermRef.current = searchText;
			const pages = await performSearch(searchText);
			if (pages.length > 0) {
				goToMatch(0, pages);
			}
		}
	}, [matchPages.length, searchText, goToNextMatch, performSearch, goToMatch]);

	// Clear search
	const handleClearSearch = useCallback(() => {
		setSearchText("");
		setSearchMatches([]);
		setMatchPages([]);
		matchPagesRef.current = [];
		setCurrentMatchIndex(0);
		document.querySelectorAll(".search-highlight-overlay").forEach(el => el.remove());
		setShowSearchInput(false);
	}, []);

	return {
		searchText,
		showSearchInput,
		matchPages,
		currentMatchIndex,
		isSearching,
		searchInputRef,
		lastSearchTermRef,
		setSearchText,
		setShowSearchInput,
		performSearch,
		goToMatch,
		goToNextMatch,
		goToPreviousMatch,
		handleSearchChange,
		handleSearchSubmit,
		handleClearSearch,
	};
}
