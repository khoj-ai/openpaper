import { useState, useEffect } from 'react';
import {
    AIPaperHighlight,
    PaperHighlight,
} from '@/lib/schema';

import { getSelectionOffsets } from '../utils/PdfTextUtils';
import { addHighlightToNodes, findAllHighlightedPassages } from '../utils/PdfHighlightUtils';
import { fetchFromApi } from '@/lib/api';

export function useHighlights(paperId: string, readOnlyHighlights: Array<PaperHighlight> = []) {
    const [highlights, setHighlights] = useState<Array<PaperHighlight>>([]);
    const [aiHighlights, setAIHighlights] = useState<Array<AIPaperHighlight>>([]);
    const [selectedText, setSelectedText] = useState<string>("");
    const [tooltipPosition, setTooltipPosition] = useState<{ x: number, y: number } | null>(null);
    const [isAnnotating, setIsAnnotating] = useState(false);
    const [isHighlightInteraction, setIsHighlightInteraction] = useState(false);
    const [activeHighlight, setActiveHighlight] = useState<PaperHighlight | null>(null);
    const [activeAIHighlight, setActiveAIHighlight] = useState<AIPaperHighlight | null>(null);

    const highlightsStorageName = `highlights-${paperId}`;

    // Apply highlights whenever they change
    useEffect(() => {
        if (highlights.length > 0) {
            const allMatches = findAllHighlightedPassages(highlights);

            const handlers = {
                setIsHighlightInteraction,
                setSelectedText,
                setTooltipPosition,
                setIsAnnotating,
                setActiveHighlight,
            };

            for (const match of allMatches) {
                addHighlightToNodes(match.nodes, match.sourceHighlight, handlers);
            }
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

    useEffect(() => {
        if (readOnlyHighlights.length > 0) {
            setHighlights(readOnlyHighlights);
        }
        else {
            loadHighlights();
            loadAIHighlights();
        }
    }, []);

    useEffect(() => {
        // Scroll to the active highlight.
        if (activeHighlight) {
            const highlightElement = document.querySelector(
                `.react-pdf__Page__textContent span[data-highlight-id="${activeHighlight.id}"]`
            );

            if (highlightElement) {
                highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Add a small delay to allow scrolling to complete
                setTimeout(() => {
                    // Get the element's position after scrolling
                    const rect = highlightElement.getBoundingClientRect();

                    // Update tooltip position to be near the highlight
                    setTooltipPosition({
                        x: rect.right,
                        y: rect.top + (rect.height / 2)
                    });
                }, 300); // Adjust timeout as needed based on scroll duration
            }
        }
    }, [activeHighlight]);

    useEffect(() => {
        console.log("IN PDF HIGHLIGHT HOOK: activeAIHighlight:", activeAIHighlight);
        // Scroll to the active AI highlight.
        if (activeAIHighlight) {
            console.log("attempt to scroll to AI highlight:", activeAIHighlight);
            const highlightElement = document.querySelector(
                `.react-pdf__Page__textContent span[data-ai-highlight-id="${activeAIHighlight.id}"]`
            );

            console.log("Found highlight element:", highlightElement);

            if (highlightElement) {
                highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Add a small delay to allow scrolling to complete
                setTimeout(() => {
                    // Get the element's position after scrolling
                    const rect = highlightElement.getBoundingClientRect();

                    // Update tooltip position to be near the highlight
                    setTooltipPosition({
                        x: rect.right,
                        y: rect.top + (rect.height / 2)
                    });
                }, 300); // Adjust timeout as needed based on scroll duration
            }
        }
    }, [activeAIHighlight]);

    const removeHighlight = (highlight: PaperHighlight) => {
        removeHighlightFromServer(highlight);
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
        localStorage.removeItem(highlightsStorageName);
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

    const sendHighlightToServer = async (highlight: PaperHighlight) => {
        const isDuplicate = highlights.some(h =>
            h.raw_text === highlight.raw_text &&
            h.start_offset === highlight.start_offset &&
            h.end_offset === highlight.end_offset
        );
        // Check if the highlight already exists in the local highlights
        if (isDuplicate) {
            return;
        }

        const payload = {
            ...highlight,
            paper_id: paperId
        }

        try {
            const data = await fetchFromApi(`/api/highlight`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            return data;
        } catch (error) {
            console.error('Error sending highlight to server:', error);
        }
    }

    const removeHighlightFromServer = async (highlight: PaperHighlight) => {
        try {
            await fetchFromApi(`/api/highlight/${highlight.id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            const updatedHighlights = highlights.filter(h => h.id !== highlight.id);
            setHighlights(updatedHighlights);
            clearHighlightsFromDOM();
            loadHighlights();
        }
        catch (error) {
            console.error('Error removing highlight from server:', error);
        }
    }

    const loadHighlights = async () => {
        try {
            const data: PaperHighlight[] = await fetchFromApi(`/api/highlight/${paperId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            // Check if highlights have the required fields
            const validHighlights: PaperHighlight[] = data.filter(
                (h: PaperHighlight) => h.raw_text &&
                    typeof h.start_offset === 'number' &&
                    typeof h.end_offset === 'number'
            );

            const deduplicatedHighlights = validHighlights.filter((highlight, index, self) =>
                index === self.findIndex(h =>
                    h.raw_text === highlight.raw_text &&
                    h.start_offset === highlight.start_offset &&
                    h.end_offset === highlight.end_offset
                )
            );

            clearHighlightsFromDOM();
            setHighlights(deduplicatedHighlights);
        }
        catch (error) {
            console.error('Error loading highlights from server:', error);
        }
    }

    const loadAIHighlights = async () => {
        try {
            const data: AIPaperHighlight[] = await fetchFromApi(`/api/ai_highlight/${paperId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            // Check if highlights have the required fields
            const validHighlights: AIPaperHighlight[] = data.filter(
                (h: AIPaperHighlight) => h.raw_text &&
                    typeof h.start_offset_hint === 'number' &&
                    typeof h.end_offset_hint === 'number'
            );

            const deduplicatedHighlights = validHighlights.filter((highlight, index, self) =>
                index === self.findIndex(h =>
                    h.raw_text === highlight.raw_text &&
                    h.start_offset_hint === highlight.start_offset_hint &&
                    h.end_offset_hint === highlight.end_offset_hint
                )
            );

            console.log('AI Highlights:', deduplicatedHighlights);

            setAIHighlights(deduplicatedHighlights);
        }
        catch (error) {
            console.error('Error loading AI highlights from server:', error);
        }
    }

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

    const addHighlight = async (
        selectedText: string,
        startOffset: number | undefined,
        endOffset: number | undefined) => {
        // Get offsets from the current selection
        let offsets;
        if (!startOffset || !endOffset) {
            offsets = getSelectionOffsets();
        } else {
            offsets = {
                start: startOffset,
                end: endOffset
            };
        }

        if (!offsets) {
            console.error("Couldn't determine text offsets for selection");
            return;
        }

        try {
            const newHighlight = await sendHighlightToServer({
                raw_text: selectedText,
                start_offset: offsets.start,
                end_offset: offsets.end,
            });

            const updatedHighlights = [...highlights, newHighlight];


            setHighlights(updatedHighlights);
        } catch (error) {
            console.error("Error adding highlight:", error);
        }

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
        activeAIHighlight,
        setActiveAIHighlight,
        handleTextSelection,
        clearHighlights,
        addHighlight,
        removeHighlight,
        loadHighlights,
        aiHighlights,
        loadAIHighlights,
    };
}
