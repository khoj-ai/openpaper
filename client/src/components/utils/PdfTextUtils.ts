export const getMatchingNodesInPdf = (searchTerm: string) => {
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
            // If we see that the target searchTerm is present at some point in the PDF, we take the starting index, and greedily add all subsequent nodes until we have a text length equal to the length of the search term.
            // Since we're just looking for a match of our string anywhere in the target text, we will likely end up adding notes that are extended beyond the scope of the search term. Typically, the span in the canvas layer is a single line of the PDF. It maybe be a substring of the line if there is some special formatting (like italics, bolding) within the line.
            const foundIndex = fullPageTextLower.indexOf(searchTextLower, startIndex);
            if (foundIndex === -1) break;

            const matchStart = foundIndex;
            const matchEnd = matchStart + searchTextLower.length;

            let currentPosition = 0;
            const matchingNodes: Element[] = [];

            // Can we more efficiently jump to the first node after (inclusive) `foundIndex`? A sub of filtered nodes?

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

// Helper function to calculate string similarity using Levenshtein distance
function calculateSimilarity(str1: string, str2: string): number {
    if (str1.length === 0) return str2.length;
    if (str2.length === 0) return str1.length;

    const matrix = Array(str1.length + 1).fill(null).map(() => Array(str2.length + 1).fill(0));

    for (let i = 0; i <= str1.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= str2.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= str1.length; i++) {
        for (let j = 1; j <= str2.length; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return 1 - (matrix[str1.length][str2.length] / Math.max(str1.length, str2.length));
}

function prepareTextForFuzzyMatch(text: string): string {
    return text
        // Remove quotes and apostrophes but keep numbers
        .replace(/['"''"]/g, '')
        // Remove special characters but keep numbers and basic punctuation
        .replace(/[,\/#!$%\^&\*;:{}=\-_`~()\\[\]]/g, ' ')
        // Replace multiple spaces with single space
        .replace(/\s+/g, ' ')
        // Convert to lowercase
        .toLowerCase()
        // Trim leading/trailing whitespace
        .trim();
}

export const getFuzzyMatchingNodesInPdf = (originalTerm: string) => {
    const results: Array<{
        pageIndex: number;
        matchIndex: number;
        nodes: Element[];
        similarity: number;
    }> = [];

    // Prepare the search term for fuzzy matching
    const fuzzySearchTerm = prepareTextForFuzzyMatch(originalTerm);
    const searchSeed = fuzzySearchTerm.slice(0, 15).toLowerCase();
    const fullSearchTermLower = fuzzySearchTerm.toLowerCase();

    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');

    console.log("original search term:", originalTerm);
    console.log("search seed:", searchSeed);
    console.log("fuzzy search term:", fuzzySearchTerm);

    textLayers.forEach((layer, pageIndex) => {
        const textNodes = Array.from(layer.querySelectorAll('span'));
        if (textNodes.length === 0) return;

        const filteredTextNodes = textNodes.filter(node => node.textContent && node.textContent.trim() !== '');
        const fullPageText = filteredTextNodes.map(node => node.textContent || '').join(' ');

        // Create mapping between original and prepared text positions
        const charMapping = createCharacterMapping(fullPageText);
        const preparedPageText = prepareTextForFuzzyMatch(fullPageText);

        let startIndex = 0;
        let matchIndex = 0;

        while (startIndex < preparedPageText.length) {
            const foundIndex = preparedPageText.indexOf(searchSeed, startIndex);
            if (foundIndex === -1) break;

            // Create a more precise window for the full search term
            const searchTermLength = fullSearchTermLower.length;
            const seedLength = searchSeed.length;

            // Start from where we found the seed
            const windowStart = foundIndex;
            // Extend the window to accommodate the full search term length, plus a small buffer
            const windowEnd = Math.min(
                preparedPageText.length,
                foundIndex + Math.max(searchTermLength, seedLength * 2)
            );
            const textWindow = preparedPageText.slice(windowStart, windowEnd);

            // Calculate similarity between search term and found text
            const similarity = calculateSimilarity(fullSearchTermLower, textWindow);

            if (similarity > 0.5) {
                // Map back to original text positions using character mapping
                const originalWindowStart = mapPreparedToOriginal(windowStart, charMapping);
                const originalWindowEnd = mapPreparedToOriginal(windowEnd, charMapping);

                // Find nodes that intersect with the original text window
                let currentPosition = 0;
                const matchingNodes: Element[] = [];

                for (const node of filteredTextNodes) {
                    const nodeText = node.textContent || '';
                    const nodeLength = nodeText.length + 1; // +1 for the added space

                    const nodeStart = currentPosition;
                    const nodeEnd = currentPosition + nodeLength;

                    // Check if this node intersects with our match window
                    if (
                        (originalWindowStart < nodeEnd && originalWindowEnd > nodeStart)
                    ) {
                        matchingNodes.push(node);
                    }

                    currentPosition += nodeLength;

                    // Stop if we've passed the end of our window
                    if (nodeStart > originalWindowEnd) break;
                }

                if (matchingNodes.length > 0) {
                    results.push({
                        pageIndex,
                        matchIndex,
                        nodes: matchingNodes,
                        similarity
                    });
                    matchIndex++;
                }
            }

            startIndex = foundIndex + searchSeed.length;
        }
    });

    return results.sort((a, b) => b.similarity - a.similarity);
};

// Helper function to create mapping between original and prepared text positions
function createCharacterMapping(originalText: string): { preparedToOriginal: number[], originalToPrepared: number[] } {
    const preparedToOriginal: number[] = [];
    const originalToPrepared: number[] = new Array(originalText.length).fill(-1);

    let preparedIndex = 0;
    let lastWasSpace = true; // Start as true to handle leading spaces

    for (let originalIndex = 0; originalIndex < originalText.length; originalIndex++) {
        const char = originalText[originalIndex];

        // Skip quotes and apostrophes entirely
        if (/['"''"]/g.test(char)) {
            continue;
        }

        let outputChar = '';

        // Convert special characters to space
        if (/[,\/#!$%\^&\*;:{}=\-_`~()\\[\]]/g.test(char)) {
            outputChar = ' ';
        }
        // Keep whitespace as space
        else if (/\s/.test(char)) {
            outputChar = ' ';
        }
        // Keep regular characters, convert to lowercase
        else {
            outputChar = char.toLowerCase();
        }

        // Handle space normalization - skip consecutive spaces
        if (outputChar === ' ') {
            if (lastWasSpace) {
                continue; // Skip this space
            }
            lastWasSpace = true;
        } else {
            lastWasSpace = false;
        }

        // Create the mapping
        preparedToOriginal[preparedIndex] = originalIndex;
        originalToPrepared[originalIndex] = preparedIndex;
        preparedIndex++;
    }

    // Handle trailing space removal (trim)
    if (preparedToOriginal.length > 0 && preparedIndex > 0) {
        // Remove trailing spaces from mapping
        while (preparedToOriginal.length > 0) {
            const lastOriginalIndex = preparedToOriginal[preparedToOriginal.length - 1];
            if (originalText[lastOriginalIndex] && /\s/.test(originalText[lastOriginalIndex])) {
                preparedToOriginal.pop();
                originalToPrepared[lastOriginalIndex] = -1;
            } else {
                break;
            }
        }
    }

    return { preparedToOriginal, originalToPrepared };
}

// Helper function to map prepared text position back to original text position
function mapPreparedToOriginal(preparedIndex: number, mapping: { preparedToOriginal: number[], originalToPrepared: number[] }): number {
    if (preparedIndex >= mapping.preparedToOriginal.length) {
        return mapping.preparedToOriginal[mapping.preparedToOriginal.length - 1] || 0;
    }
    return mapping.preparedToOriginal[preparedIndex] || 0;
}

export function getSelectionOffsets(): { start: number, end: number } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.toString()) {
        return null;
    }

    // Get all text layers
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
    if (!textLayers.length) return null;

    let offset = 0;
    let startOffset = -1;
    let endOffset = -1;

    // Create a map to store node offsets
    const nodeOffsets = new Map<Node, { start: number, end: number }>();

    // Calculate offsets for all text nodes across all pages
    for (let i = 0; i < textLayers.length; i++) {
        const treeWalker = document.createTreeWalker(
            textLayers[i],
            NodeFilter.SHOW_TEXT,
            null
        );

        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            const length = currentNode.textContent?.length || 0;
            nodeOffsets.set(currentNode, {
                start: offset,
                end: offset + length
            });
            offset += length;
        }
    }

    // Find the start and end nodes of the selection
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;

    // Calculate start offset
    if (nodeOffsets.has(startNode)) {
        const nodeOffset = nodeOffsets.get(startNode)!;
        startOffset = nodeOffset.start + range.startOffset;
    }

    // Calculate end offset
    if (nodeOffsets.has(endNode)) {
        const nodeOffset = nodeOffsets.get(endNode)!;
        endOffset = nodeOffset.start + range.endOffset;
    }

    if (startOffset > -1 && endOffset > -1) {
        // Handle backwards selection (user selected from right to left)
        if (startOffset > endOffset) {
            [startOffset, endOffset] = [endOffset, startOffset];
        }

        return { start: startOffset, end: endOffset };
    }

    return null;
}

export function getPdfTextContent(): string {
    const textContent = document.querySelector('.react-pdf__Page__textContent');
    if (!textContent) return '';

    return textContent.textContent || '';
}
