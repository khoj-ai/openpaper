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

export const getFuzzyMatchingNodesInPdf = (searchTerm: string) => {
    const results: Array<{
        pageIndex: number;
        matchIndex: number;
        nodes: Element[];
        similarity: number;
    }> = [];

    // Take first 10 characters of search term as seed
    const searchSeed = searchTerm.slice(0, 10).toLowerCase();
    const fullSearchTermLower = searchTerm.toLowerCase();

    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');

    textLayers.forEach((layer, pageIndex) => {
        const textNodes = Array.from(layer.querySelectorAll('span'));
        if (textNodes.length === 0) return;

        const filteredTextNodes = textNodes.filter(node => node.textContent && node.textContent.trim() !== '');
        const fullPageText = filteredTextNodes.map(node => node.textContent || '').join(' ');
        const fullPageTextLower = fullPageText.toLowerCase();

        let startIndex = 0;
        let matchIndex = 0;

        while (startIndex < fullPageTextLower.length) {
            const foundIndex = fullPageTextLower.indexOf(searchSeed, startIndex);
            if (foundIndex === -1) break;

            // Extract a window of text around the found index for similarity comparison
            const windowStart = Math.max(0, foundIndex - searchTerm.length);
            const windowEnd = Math.min(fullPageTextLower.length, foundIndex + searchTerm.length * 2);
            const textWindow = fullPageTextLower.slice(windowStart, windowEnd);

            // Calculate similarity between search term and found text
            const similarity = calculateSimilarity(fullSearchTermLower, textWindow);

            if (similarity > 0.2) { // Threshold for accepting matches
                let currentPosition = 0;
                const matchingNodes: Element[] = [];

                for (const node of filteredTextNodes) {
                    const nodeText = node.textContent || '';
                    const nodeLength = nodeText.length + 1;

                    const nodeStart = currentPosition;
                    const nodeEnd = currentPosition + nodeLength;

                    if (
                        (foundIndex >= nodeStart && foundIndex < nodeEnd) ||
                        (windowEnd > nodeStart && windowEnd <= nodeEnd) ||
                        (foundIndex <= nodeStart && windowEnd >= nodeEnd)
                    ) {
                        matchingNodes.push(node);
                    }

                    currentPosition += nodeLength;
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

            startIndex = foundIndex + 1;
        }
    });

    // Sort by similarity score and return the best matches
    return results.sort((a, b) => b.similarity - a.similarity);
};

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
