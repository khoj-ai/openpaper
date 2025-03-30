import { PaperHighlight } from "@/app/paper/[id]/page";
import { getMatchingNodesInPdf } from "./PdfTextUtils";

export const findAllHighlightedPassages = (allHighlights: Array<PaperHighlight>) => {
    const results: Array<{ pageIndex: number; matchIndex: number; nodes: Element[], sourceHighlight: PaperHighlight }> = [];

    for (const highlight of allHighlights) {
        const textToSearch = highlight.raw_text.toLowerCase();
        const match = getSpecificMatchInPdf(textToSearch, highlight.occurrence_index);

        if (match) {
            results.push({
                pageIndex: match.pageIndex,
                matchIndex: match.matchIndex,
                nodes: match.nodes,
                sourceHighlight: highlight
            });
        }
    }
    return results;
}

const getSpecificMatchInPdf = (searchTerm: string, occurrenceIndex: number = 0) => {
    const allMatches = getMatchingNodesInPdf(searchTerm);

    // Check if the requested occurrence exists
    if (occurrenceIndex >= 0 && occurrenceIndex < allMatches.length) {
        return allMatches[occurrenceIndex];
    }

    // Return null or undefined if not found
    return null;
};


// Helper function to add click handler to highlighted elements
export function addHighlightClickHandler(
    node: Element,
    sourceHighlight: PaperHighlight,
    handlers: {
        setIsHighlightInteraction: (value: boolean) => void;
        setSelectedText: (text: string) => void;
        setTooltipPosition: (position: { x: number; y: number } | null) => void;
        setIsAnnotating: (value: boolean) => void;
        setActiveHighlight: (highlight: PaperHighlight | null) => void;
    }
) {
    node.addEventListener('click', (event) => {
        // Prevent event bubbling
        event.stopPropagation();
        event.preventDefault();

        // Set highlight interaction flag immediately
        handlers.setIsHighlightInteraction(true);

        // Get coordinates at the time of the click
        const rect = (event.target as Element).getBoundingClientRect();

        // Set state for annotation menu
        handlers.setSelectedText(sourceHighlight.raw_text);
        handlers.setTooltipPosition({
            x: rect.left + (rect.width / 2),
            y: rect.top
        });
        handlers.setIsAnnotating(true);
        handlers.setActiveHighlight(sourceHighlight);
    });
}


// Apply full highlight to a node
export function applyHighlightToNode(
    node: Element,
    sourceHighlight: PaperHighlight,
    handlers: {
        setIsHighlightInteraction: (value: boolean) => void;
        setSelectedText: (text: string) => void;
        setTooltipPosition: (position: { x: number; y: number } | null) => void;
        setIsAnnotating: (value: boolean) => void;
        setActiveHighlight: (highlight: PaperHighlight | null) => void;
    }
) {
    // Clone the node to preserve its properties
    const newNode = node.cloneNode(true) as Element;

    // Add highlight styles
    newNode.classList.add('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

    // Add click handler for interaction
    addHighlightClickHandler(newNode, sourceHighlight, handlers);

    // Replace the original node
    if (node.parentNode) {
        node.parentNode.replaceChild(newNode, node);
    }
}

// Create text fragments with partial highlighting
export function createHighlightedTextFragments(
    node: Element,
    sourceHighlight: PaperHighlight,
    handlers: {
      setIsHighlightInteraction: (value: boolean) => void;
      setSelectedText: (text: string) => void;
      setTooltipPosition: (position: { x: number; y: number } | null) => void;
      setIsAnnotating: (value: boolean) => void;
      setActiveHighlight: (highlight: PaperHighlight | null) => void;
    },
    isFirstNode = false
  ) {
    if (!node.textContent) return;

    const nodeText = node.textContent;
    const highlightText = sourceHighlight.raw_text;

    // Create a container to replace the original node
    const container = document.createElement('span');

    // Copy ALL styles from the original node, not just a few
    if (node instanceof HTMLElement) {
      // Copy all computed styles to ensure exact match
      const computedStyle = window.getComputedStyle(node);
      Array.from(computedStyle).forEach(key => {
        container.style[key as any] = computedStyle.getPropertyValue(key);
      });

      // Make sure we're setting the correct position
      container.style.position = 'absolute';
      container.style.left = node.style.left;
      container.style.top = node.style.top;
    }

    // Find the start index of the highlight within the node text
    const startIndex = nodeText.indexOf(highlightText);

    if (startIndex >= 0) {
      // Case: The highlight is within this node - split into before, highlight, after
      if (startIndex > 0) {
        const beforeText = document.createElement('span');
        beforeText.textContent = nodeText.substring(0, startIndex);
        beforeText.style.position = 'relative';
        beforeText.style.display = 'inline';
        container.appendChild(beforeText);
      }

      // Add the highlighted text
      const highlightSpan = document.createElement('span');
      highlightSpan.textContent = highlightText;
      highlightSpan.style.position = 'relative';
      highlightSpan.style.display = 'inline';
      highlightSpan.classList.add('border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');
      addHighlightClickHandler(highlightSpan, sourceHighlight, handlers);
      container.appendChild(highlightSpan);

      // Add text after the highlight
      const endIndex = startIndex + highlightText.length;
      if (endIndex < nodeText.length) {
        const afterText = document.createElement('span');
        afterText.textContent = nodeText.substring(endIndex);
        afterText.style.position = 'relative';
        afterText.style.display = 'inline';
        container.appendChild(afterText);
      }
    } else {
        // For more complex cases where we can't find an exact substring match
        // Find the longest common substring
        const findLongestCommonSubstring = (str1: string, str2: string): [number, number, number] => {
            let longestLength = 0;
            let longestStartIndex1 = 0;
            let longestStartIndex2 = 0;

            const str1Lower = str1.toLowerCase();
            const str2Lower = str2.toLowerCase();

            for (let i = 0; i < str1Lower.length; i++) {
                for (let j = 0; j < str2Lower.length; j++) {
                    let length = 0;
                    while (
                        i + length < str1Lower.length &&
                        j + length < str2Lower.length &&
                        str1Lower[i + length] === str2Lower[j + length]
                    ) {
                        length++;
                    }

                    if (length > longestLength) {
                        longestLength = length;
                        longestStartIndex1 = i;
                        longestStartIndex2 = j;
                    }
                }
            }

            return [longestLength, longestStartIndex1, longestStartIndex2];
        };

        const [longestLength, nodeStartIndex, _] = findLongestCommonSubstring(nodeText, highlightText);

        // Only proceed if we found a substantial match (to avoid highlighting common short words)
        if (longestLength > 3) {
            // Add text before the match
            if (nodeStartIndex > 0) {
                const beforeText = document.createElement('span');
                beforeText.textContent = nodeText.substring(0, nodeStartIndex);
                beforeText.style.position = 'relative';
                beforeText.style.display = 'inline';
                container.appendChild(beforeText);
            }

            // Add the highlighted text
            const matchedText = nodeText.substring(nodeStartIndex, nodeStartIndex + longestLength);
            const highlightSpan = document.createElement('span');
            highlightSpan.textContent = matchedText;
            highlightSpan.style.position = 'relative';
            highlightSpan.style.display = 'inline';
            highlightSpan.classList.add('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');
            addHighlightClickHandler(highlightSpan, sourceHighlight, handlers);
            container.appendChild(highlightSpan);

            // Add text after the match
            const endIndex = nodeStartIndex + longestLength;
            if (endIndex < nodeText.length) {
                const afterText = document.createElement('span');
                afterText.textContent = nodeText.substring(endIndex);
                afterText.style.position = 'relative';
                afterText.style.display = 'inline';
                container.appendChild(afterText);
            }
        } else {
            // Fall back to word-by-word highlighting for short matches
            const nodeWords = nodeText.split(/(\s+)/); // Split by whitespace but keep the whitespace
            const highlightWords = new Set(highlightText.split(/\s+/));

            // Process each word and the whitespace that follows it
            for (let i = 0; i < nodeWords.length; i++) {
                const word = nodeWords[i];

                if (/^\s+$/.test(word)) {
                    // It's just whitespace, add it directly
                    const textNode = document.createTextNode(word);
                    container.appendChild(textNode);
                    continue;
                }

                // It's a word
                if (highlightWords.has(word) || highlightText.includes(word)) {
                    // This word should be highlighted
                    const wordSpan = document.createElement('span');
                    wordSpan.textContent = word;
                    wordSpan.style.display = 'inline';
                    wordSpan.classList.add('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-40', '!relative');

                    // Only add click handler to longer words to avoid false positives
                    if (word.length > 3) {
                        addHighlightClickHandler(wordSpan, sourceHighlight, handlers);
                    }

                    container.appendChild(wordSpan);
                } else {
                    // Just add the word directly
                    const textNode = document.createTextNode(word);
                    container.appendChild(textNode);
                }
            }
        }
    }

    // Replace the original node with our container of fragments
    if (node.parentNode) {
        if (isFirstNode && sourceHighlight.annotation) {
            const annotationButton = document.createElement('button');
            annotationButton.innerHTML = 'note';

            // Style the button
            annotationButton.classList.add('absolute', 'z-10', 'cursor-pointer', '-right-8', 'top-0', 'flex', 'items-center', 'justify-center', 'w-6', 'h-6', 'rounded-full', 'bg-blue-200', 'opacity-20', 'text-white', 'border-none', 'p-1');
            annotationButton.title = 'Click to view annotation';

            // Add classes for z-index and cursor
            annotationButton.classList.add('z-10', 'cursor-pointer');

            container.appendChild(annotationButton);

            annotationButton.addEventListener('click', () => {
                // Show the annotation in a tooltip or modal
                alert(sourceHighlight.annotation);
            });

        }

        node.parentNode.replaceChild(container, node);
    }
};


// Add annotation indicator button
export function addAnnotationButton(container: HTMLElement, sourceHighlight: PaperHighlight) {
    const annotationButton = document.createElement('button');
    annotationButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>';

    // Style the button
    annotationButton.style.position = 'absolute';
    annotationButton.style.right = '-8px';
    annotationButton.style.top = '-8px';
    annotationButton.style.width = '18px';
    annotationButton.style.height = '18px';
    annotationButton.style.borderRadius = '50%';
    annotationButton.style.backgroundColor = '#3b82f6'; // blue-500
    annotationButton.style.color = 'white';
    annotationButton.style.border = 'none';
    annotationButton.style.padding = '2px';
    annotationButton.style.display = 'flex';
    annotationButton.style.alignItems = 'center';
    annotationButton.style.justifyContent = 'center';
    annotationButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    annotationButton.title = 'Click to view annotation';

    // Add classes for z-index and cursor
    annotationButton.classList.add('z-10', 'cursor-pointer');

    container.appendChild(annotationButton);

    annotationButton.addEventListener('click', () => {
        // Show the annotation in a tooltip or modal
        alert(sourceHighlight.annotation);
    });
}


// Add highlights to nodes
export function addHighlightToNodes(
    nodes: Element[],
    sourceHighlight: PaperHighlight,
    handlers: {
        setIsHighlightInteraction: (value: boolean) => void;
        setSelectedText: (text: string) => void;
        setTooltipPosition: (position: { x: number; y: number } | null) => void;
        setIsAnnotating: (value: boolean) => void;
        setActiveHighlight: (highlight: PaperHighlight | null) => void;
    }
) {
    // First, check if we have a complete match across all nodes combined
    const combinedText = nodes.map(node => node.textContent || "").join("");
    const isExactMatch = combinedText === sourceHighlight.raw_text;

    nodes.forEach((node, index) => {
        if (!node.textContent) return;

        // Case 1: The node contains the entire highlight text (perfect match)
        if (isExactMatch) {
            applyHighlightToNode(node, sourceHighlight, handlers);
            return;
        }

        // Case 2: The node contains part of the highlight text, or the highlight contains the node text
        const nodeText = node.textContent;
        const highlightText = sourceHighlight.raw_text;

        // Check if node text is completely contained within the highlight
        if (highlightText.includes(nodeText)) {
            applyHighlightToNode(node, sourceHighlight, handlers);
            return;
        }

        // Check if part of the highlight text is in this node
        if (nodeText.includes(highlightText) ||
            highlightText.includes(nodeText.substring(0, Math.min(nodeText.length, 30))) ||
            highlightText.includes(nodeText.substring(Math.max(0, nodeText.length - 30)))) {

            // Create a fragment with highlighted sections
            createHighlightedTextFragments(node, sourceHighlight, handlers, index === 0);
        }
    });

    // Add annotation indicator if needed
    if (sourceHighlight.annotation) {
        const firstNode = nodes[0];
        if (!firstNode) return;
        addAnnotationButton(firstNode as HTMLElement, sourceHighlight);
    }
}
