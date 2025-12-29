"use client";

import { ScaledPosition, ScaledRect } from "@/lib/schema";
import {
	normalizeForSearch,
	ligatureMap,
	greekLetterMap,
	quoteChars,
} from "./textNormalization";

/**
 * Find which page(s) contain the given text.
 * Returns an array of page numbers where the text was found.
 */
export async function findTextPages(
	searchText: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pdfDocument: any,
	targetPageNumber?: number
): Promise<number[]> {
	if (!searchText || !pdfDocument) return [];

	const normalizedSearch = normalizeForSearch(searchText).toLowerCase();
	const spaceStrippedSearch = normalizedSearch.replace(/\s+/g, "");

	if (!spaceStrippedSearch || spaceStrippedSearch.length < 3) return [];

	const matchingPages: number[] = [];

	// If target page is specified, check it first
	const pagesToSearch: number[] = [];
	if (targetPageNumber && targetPageNumber >= 1 && targetPageNumber <= pdfDocument.numPages) {
		pagesToSearch.push(targetPageNumber);
	}
	for (let i = 1; i <= pdfDocument.numPages; i++) {
		if (i !== targetPageNumber) {
			pagesToSearch.push(i);
		}
	}

	for (const pageNum of pagesToSearch) {
		try {
			const page = await pdfDocument.getPage(pageNum);
			const textContent = await page.getTextContent();
			const pageText = textContent.items
				.map((item: { str?: string }) => item.str || "")
				.join(" ");

			const normalizedPageText = normalizeForSearch(pageText).toLowerCase();
			const spaceStrippedPageText = normalizedPageText.replace(/\s+/g, "");

			if (
				normalizedPageText.includes(normalizedSearch) ||
				spaceStrippedPageText.includes(spaceStrippedSearch)
			) {
				matchingPages.push(pageNum);
			}
		} catch (err) {
			console.warn(`Error searching page ${pageNum}:`, err);
		}
	}

	return matchingPages;
}

/**
 * Create highlight overlays for text in a rendered text layer.
 * This uses the same DOM-based approach as the search highlighting.
 * Returns the created overlay elements.
 */
export function createTextHighlightOverlays(
	textLayer: Element,
	searchText: string,
	highlightClass: string = "assistant-highlight-overlay",
	backgroundColor: string = "rgba(168, 85, 247, 0.3)"
): HTMLElement[] {
	const spans = Array.from(textLayer.querySelectorAll("span"));
	const matchElements: HTMLElement[] = [];

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
	const normalizedTerm = normalizeForSearch(searchText).trim().toLowerCase();

	if (!normalizedTerm || charMappings.length === 0) return matchElements;

	let spaceStrippedText = "";
	const spaceStrippedToNormalizedIndex: number[] = [];

	for (let i = 0; i < normalizedLower.length; i++) {
		if (normalizedLower[i] !== " ") {
			spaceStrippedToNormalizedIndex.push(i);
			spaceStrippedText += normalizedLower[i];
		}
	}

	const spaceStrippedTerm = normalizedTerm.replace(/\s+/g, "");

	if (!spaceStrippedTerm) return matchElements;

	let searchIndex = normalizedLower.indexOf(normalizedTerm);
	let useSpaceStripped = false;

	if (searchIndex === -1) {
		searchIndex = spaceStrippedText.indexOf(spaceStrippedTerm);
		useSpaceStripped = true;
	}

	// Only process the first match
	if (searchIndex === -1) return matchElements;

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
					highlight.className = highlightClass;
					highlight.style.position = "absolute";
					highlight.style.left = `${rect.left - textLayerRect.left}px`;
					highlight.style.top = `${rect.top - textLayerRect.top}px`;
					highlight.style.width = `${rect.width}px`;
					highlight.style.height = `${rect.height}px`;
					highlight.style.backgroundColor = backgroundColor;
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

	return matchElements;
}

/**
 * Remove all highlight overlays with the given class.
 */
export function removeHighlightOverlays(className: string = "assistant-highlight-overlay"): void {
	document.querySelectorAll(`.${className}`).forEach((el) => el.remove());
}

/**
 * Find text in a rendered text layer and compute ScaledPosition.
 * This uses DOM measurements and converts them to the format expected by react-pdf-highlighter-extended.
 */
export function computeScaledPositionFromTextLayer(
	textLayer: Element,
	searchText: string,
	pageNumber: number,
	scale: number
): ScaledPosition | null {
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
	const normalizedTerm = normalizeForSearch(searchText).trim().toLowerCase();

	if (!normalizedTerm || charMappings.length === 0) return null;

	let spaceStrippedText = "";
	const spaceStrippedToNormalizedIndex: number[] = [];

	for (let i = 0; i < normalizedLower.length; i++) {
		if (normalizedLower[i] !== " ") {
			spaceStrippedToNormalizedIndex.push(i);
			spaceStrippedText += normalizedLower[i];
		}
	}

	const spaceStrippedTerm = normalizedTerm.replace(/\s+/g, "");

	if (!spaceStrippedTerm) return null;

	let searchIndex = normalizedLower.indexOf(normalizedTerm);
	let useSpaceStripped = false;

	if (searchIndex === -1) {
		searchIndex = spaceStrippedText.indexOf(spaceStrippedTerm);
		useSpaceStripped = true;
	}

	if (searchIndex === -1) return null;

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

	// Get the page element to compute relative positions
	const pageEl = textLayer.closest(".page");
	if (!pageEl) return null;

	const pageRect = pageEl.getBoundingClientRect();

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

		if (mapping.isVirtual) continue;

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
			if (currentRange) ranges.push(currentRange);
			currentRange = {
				span: mapping.span,
				textNode: mapping.textNode,
				startIdx: mapping.originalCharIndex,
				endIdx: mapping.originalCharIndex + 1,
			};
		}
	}
	if (currentRange) ranges.push(currentRange);

	const scaledRects: ScaledRect[] = [];

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

					// Convert to page-relative coordinates at scale 1.0
					const x1 = (rect.left - pageRect.left) / scale;
					const y1 = (rect.top - pageRect.top) / scale;
					const x2 = (rect.right - pageRect.left) / scale;
					const y2 = (rect.bottom - pageRect.top) / scale;

					scaledRects.push({
						x1,
						y1,
						x2,
						y2,
						width: x2 - x1,
						height: y2 - y1,
						pageNumber,
					});
				}
			} catch (e) {
				console.warn("Range error:", e);
			}
		}
	}

	if (scaledRects.length === 0) return null;

	// Compute bounding rect from all rects
	const boundingRect: ScaledRect = {
		x1: Math.min(...scaledRects.map((r) => r.x1)),
		y1: Math.min(...scaledRects.map((r) => r.y1)),
		x2: Math.max(...scaledRects.map((r) => r.x2)),
		y2: Math.max(...scaledRects.map((r) => r.y2)),
		width: 0,
		height: 0,
		pageNumber,
	};
	boundingRect.width = boundingRect.x2 - boundingRect.x1;
	boundingRect.height = boundingRect.y2 - boundingRect.y1;

	return {
		boundingRect,
		rects: scaledRects,
	};
}
