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
