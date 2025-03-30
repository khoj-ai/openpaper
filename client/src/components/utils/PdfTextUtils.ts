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
