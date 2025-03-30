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

export const getOccurrenceIndexOfSelection = (text: string) => {
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

export const getNodesInPdfByDocumentOffsets = (startOffset: number, endOffset: number) => {
    // Get all text layers in order
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');

    // Collect all text nodes from all pages into a single array with their page information
    const allNodes: Array<{ node: Element, pageIndex: number, start: number, end: number }> = [];
    let globalPosition = 0;

    // Build a flat list of all nodes with their global offsets
    for (let pageIndex = 0; pageIndex < textLayers.length; pageIndex++) {
        const layer = textLayers[pageIndex];
        const textNodes = Array.from(layer.querySelectorAll('span'))
            .filter(node => node.textContent && node.textContent.trim() !== '');

        for (const node of textNodes) {
            const nodeText = node.textContent || '';
            const nodeLength = nodeText.length;

            const nodeStart = globalPosition;
            const nodeEnd = globalPosition + nodeLength;

            allNodes.push({
                node,
                pageIndex,
                start: nodeStart,
                end: nodeEnd
            });

            globalPosition += nodeLength + 1; // +1 for spacing between nodes
        }
    }

    // Filter nodes that overlap with our target range
    const matchingNodes = allNodes.filter(({ start, end }) =>
        (startOffset >= start && startOffset < end) ||     // Start falls in this node
        (endOffset > start && endOffset <= end) ||         // End falls in this node
        (startOffset <= start && endOffset >= end)         // Node is completely within range
    );

    if (matchingNodes.length === 0) {
        return null;
    }

    return matchingNodes;
};

export const getNodesFromCurrentSelection = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    const selectionText = range.toString();
    if (!selectionText) return null;

    // Get all text layers
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');

    // Find start container's page
    const startTextLayer = range.startContainer.parentElement?.closest('.react-pdf__Page__textContent');
    if (!startTextLayer) return null;

    const startPageIndex = Array.from(textLayers).indexOf(startTextLayer as Element);
    if (startPageIndex === -1) return null;

    // Build a map of all text nodes with global positions
    const allNodes: Array<{
        node: Element,
        pageIndex: number,
        text: string,
        globalStart: number,
        globalEnd: number
    }> = [];

    let globalPosition = 0;

    // First pass: collect all nodes and their global positions
    for (let pageIndex = 0; pageIndex < textLayers.length; pageIndex++) {
        const layer = textLayers[pageIndex];
        const textNodes = Array.from(layer.querySelectorAll('span'))
            .filter(node => node.textContent && node.textContent.trim() !== '');

        for (const node of textNodes) {
            const nodeText = node.textContent || '';
            const nodeLength = nodeText.length;

            const nodeStart = globalPosition;
            const nodeEnd = globalPosition + nodeLength;

            allNodes.push({
                node,
                pageIndex,
                text: nodeText,
                globalStart: nodeStart,
                globalEnd: nodeEnd
            });

            globalPosition += nodeLength + 1; // +1 for spacing between nodes
        }
    }

    // Second pass: find our selection's global start and end positions
    let startOffset = -1;
    let endOffset = -1;

    // Find the containing node for the start container
    const startNode = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer as HTMLElement;

    // Find the containing node for the end container
    const endNode = range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement
        : range.endContainer as HTMLElement;

    // Find global start position
    for (const nodeInfo of allNodes) {
        if (nodeInfo.node === startNode || nodeInfo.node.contains(startNode)) {
            // Calculate the exact offset within this node
            let localOffset = range.startOffset;

            // For text nodes, we need the text node's offset within the element
            if (range.startContainer.nodeType === Node.TEXT_NODE) {
                if (!startNode) break;

                // Find the text node's position among its siblings
                const textNodes = Array.from(startNode.childNodes)
                    .filter(n => n.nodeType === Node.TEXT_NODE);

                const textNodeIndex = textNodes.indexOf(range.startContainer);

                // Add lengths of preceding text nodes
                for (let i = 0; i < textNodeIndex; i++) {
                    localOffset += textNodes[i].textContent?.length || 0;
                }
            }

            startOffset = nodeInfo.globalStart + localOffset;
            break;
        }
    }

    // Find global end position
    for (const nodeInfo of allNodes) {
        if (nodeInfo.node === endNode || nodeInfo.node.contains(endNode)) {
            // Calculate the exact offset within this node
            let localOffset = range.endOffset;

            // For text nodes, we need the text node's offset within the element
            if (range.endContainer.nodeType === Node.TEXT_NODE) {
                if (!endNode) break;

                // Find the text node's position among its siblings
                const textNodes = Array.from(endNode.childNodes)
                    .filter(n => n.nodeType === Node.TEXT_NODE);

                const textNodeIndex = textNodes.indexOf(range.endContainer);

                // Add lengths of preceding text nodes
                for (let i = 0; i < textNodeIndex; i++) {
                    localOffset += textNodes[i].textContent?.length || 0;
                }
            }

            endOffset = nodeInfo.globalStart + localOffset;
            break;
        }
    }

    // If we couldn't determine the offsets, fall back to the selection text length
    if (startOffset === -1) {
        return null;
    }

    if (endOffset === -1) {
        endOffset = startOffset + selectionText.length;
    }

    // Return the nodes that match these offsets
    return getNodesInPdfByDocumentOffsets(startOffset, endOffset);
};
