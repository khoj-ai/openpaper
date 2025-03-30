import { useState, useEffect } from 'react';
import { PaperHighlight } from '@/app/paper/[id]/page';
import { getSelectionOffsets } from '../utils/PdfTextUtils';
import { addHighlightToNodes, findAllHighlightedPassages } from '../utils/PdfHighlightUtils';

export function useHighlights() {
    const [highlights, setHighlights] = useState<Array<PaperHighlight>>([]);
    const [selectedText, setSelectedText] = useState<string>("");
    const [tooltipPosition, setTooltipPosition] = useState<{ x: number, y: number } | null>(null);
    const [isAnnotating, setIsAnnotating] = useState(false);
    const [isHighlightInteraction, setIsHighlightInteraction] = useState(false);
    const [activeHighlight, setActiveHighlight] = useState<PaperHighlight | null>(null);

    // Apply highlights whenever they change
    useEffect(() => {
        if (highlights.length > 0) {
            const allMatches = findAllHighlightedPassages(highlights);

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

            saveHighlightsToLocalStorage(highlights);
        } else {
            // Clear all highlights if none are present
            clearHighlightsFromDOM();
        }
    }, [highlights]);

    // Reset isHighlightInteraction when selectedText becomes empty
    useEffect(() => {
        if (!selectedText) {
            setIsHighlightInteraction(false);
        }
    }, [selectedText]);

    // Save highlights to local storage
    const saveHighlightsToLocalStorage = (highlights: Array<PaperHighlight>) => {
        const deduplicatedHighlights = highlights.filter((highlight, index, self) =>
            index === self.findIndex(h =>
                h.raw_text === highlight.raw_text &&
                h.start_offset === highlight.start_offset &&
                h.end_offset === highlight.end_offset
            )
        );
        localStorage.setItem("highlights", JSON.stringify(deduplicatedHighlights));
    };

    // Load highlights from local storage
    const loadHighlightsFromLocalStorage = () => {
        const storedHighlights = localStorage.getItem("highlights");
        if (storedHighlights) {
            try {
                const parsedHighlights: PaperHighlight[] = JSON.parse(storedHighlights);
                console.log("Loaded highlights from local storage:", parsedHighlights);

                // Check if stored highlights have the required fields
                const validHighlights = parsedHighlights.filter(
                    (h: PaperHighlight) => h.raw_text &&
                        typeof h.start_offset === 'number' &&
                        typeof h.end_offset === 'number'
                );

                clearHighlightsFromDOM();
                setHighlights(validHighlights);
            } catch (error) {
                console.error("Error parsing highlights from local storage:", error);
            }
        }
    };

    // Clear highlights from DOM
    const clearHighlightsFromDOM = () => {
        const existingHighlights = document.querySelectorAll(
            '.react-pdf__Page__textContent span.border-2.border-blue-500'
        );

        existingHighlights.forEach(node => {
            node.classList.remove('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

            // Remove event listeners by cloning and replacing the node
            const newNode = node.cloneNode(true);
            if (node.parentNode) {
                node.parentNode.replaceChild(newNode, node);
            }
        });
    };

    // Clear all highlights
    const clearHighlights = () => {
        localStorage.removeItem("highlights");
        setHighlights([]);
    };

    // Handle text selection
    const handleTextSelection = (e: React.MouseEvent | MouseEvent) => {
        const selection = window.getSelection();
        if (selection && selection.toString()) {
            // Use the selected text
            let text = selection.toString();
            setIsHighlightInteraction(false);

            // Normalize the text while preserving paragraph structure
            text = normalizeSelectedText(text);
            setSelectedText(text);

            // Set tooltip position near cursor
            setTooltipPosition({
                x: e.clientX,
                y: e.clientY
            });
        } else {
            if (!isHighlightInteraction && selectedText) {
                setTimeout(() => {
                    if (!isHighlightInteraction) {
                        const currentSelection = window.getSelection();
                        if (!currentSelection?.toString()) {
                            setSelectedText("");
                        }
                        setTooltipPosition(null);
                    }
                }, 200);
            }
        }
    };

    // Helper function to normalize selected text
    const normalizeSelectedText = (text: string): string => {
        // 1. Identify and preserve paragraph breaks
        text = text.replace(/(\.\s*)\n+/g, '$1{PARA_BREAK}');
        text = text.replace(/(\?\s*)\n+/g, '$1{PARA_BREAK}');
        text = text.replace(/(\!\s*)\n+/g, '$1{PARA_BREAK}');
        text = text.replace(/\n\s*\n+/g, '{PARA_BREAK}');

        // 2. Replace remaining newlines with spaces
        text = text.replace(/\n/g, ' ');

        // 3. Restore paragraph breaks with actual newlines
        text = text.replace(/{PARA_BREAK}/g, '\n\n');

        // 4. Clean up any excessive spaces
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    };

    const addHighlight = (selectedText: string, annotation: string = "") => {
        // Get offsets from the current selection
        const offsets = getSelectionOffsets();

        console.log("offsets", offsets);

        if (!offsets) {
            console.error("Couldn't determine text offsets for selection");
            return;
        }

        // Add to highlights with offset information
        setHighlights([
            ...highlights,
            {
                raw_text: selectedText,
                annotation,
                start_offset: offsets.start,
                end_offset: offsets.end
            }
        ]);

        // Reset states
        setSelectedText("");
        setTooltipPosition(null);
        setIsAnnotating(false);
    };

    return {
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
        handleTextSelection,
        loadHighlightsFromLocalStorage,
        clearHighlights,
        addHighlight,
    };
}
