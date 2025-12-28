import { PaperHighlight } from "@/lib/schema";

export const getMatchingNodesInPdf = (searchTerm: string) => {
    const results: Array<{ pageIndex: number; matchIndex: number; nodes: Element[] }> = [];
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
    textLayers.forEach((layer, pageIndex) => {
        const textNodes = Array.from(layer.querySelectorAll('span'));
        if (textNodes.length === 0) return;

        const filteredTextNodes = textNodes.filter(node =>
            node.textContent &&
            node.textContent.trim() !== '' &&
            !node.classList.contains('markedContent')
        );

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

// Greek letters and common math symbols - maps Unicode to ASCII representation
const greekLetterMap: Record<string, string> = {
    // Lowercase Greek
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa',
    'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron',
    'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau',
    'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
    // Uppercase Greek
    'Α': 'Alpha', 'Β': 'Beta', 'Γ': 'Gamma', 'Δ': 'Delta', 'Ε': 'Epsilon',
    'Ζ': 'Zeta', 'Η': 'Eta', 'Θ': 'Theta', 'Ι': 'Iota', 'Κ': 'Kappa',
    'Λ': 'Lambda', 'Μ': 'Mu', 'Ν': 'Nu', 'Ξ': 'Xi', 'Ο': 'Omicron',
    'Π': 'Pi', 'Ρ': 'Rho', 'Σ': 'Sigma', 'Τ': 'Tau', 'Υ': 'Upsilon',
    'Φ': 'Phi', 'Χ': 'Chi', 'Ψ': 'Psi', 'Ω': 'Omega',
    // Common math symbols
    '∞': 'infinity', '∂': 'partial', '∇': 'nabla', '∑': 'sum',
    '∏': 'prod', '∫': 'int', '√': 'sqrt', '≈': 'approx',
    '≠': 'neq', '≤': 'leq', '≥': 'geq', '±': 'pm',
    '×': 'times', '÷': 'div', '∈': 'in', '∉': 'notin',
    '⊂': 'subset', '⊃': 'supset', '∪': 'cup', '∩': 'cap',
    '∧': 'land', '∨': 'lor', '¬': 'neg', '→': 'to',
    '←': 'leftarrow', '↔': 'leftrightarrow', '⇒': 'Rightarrow',
    '⇐': 'Leftarrow', '⇔': 'Leftrightarrow',
};

// LaTeX commands to their Unicode equivalents (for input normalization)
const latexCommandMap: Record<string, string> = {
    '\\alpha': 'alpha', '\\beta': 'beta', '\\gamma': 'gamma', '\\delta': 'delta',
    '\\epsilon': 'epsilon', '\\varepsilon': 'epsilon', '\\zeta': 'zeta',
    '\\eta': 'eta', '\\theta': 'theta', '\\vartheta': 'theta', '\\iota': 'iota',
    '\\kappa': 'kappa', '\\lambda': 'lambda', '\\mu': 'mu', '\\nu': 'nu',
    '\\xi': 'xi', '\\pi': 'pi', '\\varpi': 'pi', '\\rho': 'rho',
    '\\varrho': 'rho', '\\sigma': 'sigma', '\\varsigma': 'sigma', '\\tau': 'tau',
    '\\upsilon': 'upsilon', '\\phi': 'phi', '\\varphi': 'phi', '\\chi': 'chi',
    '\\psi': 'psi', '\\omega': 'omega',
    '\\Alpha': 'Alpha', '\\Beta': 'Beta', '\\Gamma': 'Gamma', '\\Delta': 'Delta',
    '\\Epsilon': 'Epsilon', '\\Zeta': 'Zeta', '\\Eta': 'Eta', '\\Theta': 'Theta',
    '\\Iota': 'Iota', '\\Kappa': 'Kappa', '\\Lambda': 'Lambda', '\\Mu': 'Mu',
    '\\Nu': 'Nu', '\\Xi': 'Xi', '\\Pi': 'Pi', '\\Rho': 'Rho', '\\Sigma': 'Sigma',
    '\\Tau': 'Tau', '\\Upsilon': 'Upsilon', '\\Phi': 'Phi', '\\Chi': 'Chi',
    '\\Psi': 'Psi', '\\Omega': 'Omega',
    '\\infty': 'infinity', '\\partial': 'partial', '\\nabla': 'nabla',
    '\\sum': 'sum', '\\prod': 'prod', '\\int': 'int', '\\sqrt': 'sqrt',
    '\\approx': 'approx', '\\neq': 'neq', '\\leq': 'leq', '\\geq': 'geq',
    '\\pm': 'pm', '\\times': 'times', '\\div': 'div', '\\in': 'in',
    '\\notin': 'notin', '\\subset': 'subset', '\\supset': 'supset',
    '\\cup': 'cup', '\\cap': 'cap', '\\land': 'land', '\\lor': 'lor',
    '\\neg': 'neg', '\\to': 'to', '\\rightarrow': 'to',
    '\\leftarrow': 'leftarrow', '\\leftrightarrow': 'leftrightarrow',
    '\\Rightarrow': 'Rightarrow', '\\Leftarrow': 'Leftarrow',
    '\\Leftrightarrow': 'Leftrightarrow',
};

// All quote character types to remove
// Using unicode escapes for special characters to avoid parser issues
const quoteChars = new Set([
    '"', "'", '`',
    '\u201C', '\u201D',  // " "  left/right double quotation marks
    '\u2018', '\u2019',  // ' '  left/right single quotation marks
    '\u201A', '\u201E',  // ‚ „  low-9 quotation marks
    '\u2039', '\u203A',  // ‹ ›  single angle quotation marks
    '\u00AB', '\u00BB',  // « »  double angle quotation marks
    '\u300C', '\u300D',  // 「 」 CJK corner brackets
    '\u300E', '\u300F',  // 『 』 CJK white corner brackets
    '\u301D', '\u301E', '\u301F',  // 〝 〞 〟 double prime quotation marks
    '\uFF02', '\uFF07',  // ＂ ＇ fullwidth quotation marks
]);

// Expand LaTeX commands in the input text
function expandLatexCommands(text: string): string {
    let result = text;
    // Sort by length descending to match longer commands first
    const sortedCommands = Object.keys(latexCommandMap).sort((a, b) => b.length - a.length);
    for (const cmd of sortedCommands) {
        const regex = new RegExp(cmd.replace(/\\/g, '\\\\') + '(?![a-zA-Z])', 'g');
        result = result.replace(regex, latexCommandMap[cmd]);
    }
    return result;
}

function prepareTextForFuzzyMatch(text: string, stripAllSpaces: boolean = false): string {
    // First expand LaTeX commands
    const processed = expandLatexCommands(text);

    // Expand Greek letters and math symbols
    let result = '';
    for (const char of processed) {
        if (greekLetterMap[char]) {
            result += greekLetterMap[char];
        } else if (quoteChars.has(char)) {
            // Remove quotes entirely
            continue;
        } else {
            result += char;
        }
    }

    result = result
        // Remove special characters but keep numbers and basic punctuation
        .replace(/[,\/#!$%\^&\*;:{}=\-_`~()\\[\]]/g, ' ')
        // Convert to lowercase
        .toLowerCase();

    if (stripAllSpaces) {
        // Remove all whitespace for space-insensitive matching
        return result.replace(/\s+/g, '');
    } else {
        // Replace multiple spaces with single space and trim
        return result.replace(/\s+/g, ' ').trim();
    }
}

export function tryDirectOffsetMatch(sourceHighlight: PaperHighlight): Element[] {
    // Try to use the offset hints as if they were exact offsets
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
    if (textLayers.length === 0) return [];

    // Collect all text nodes with their offsets
    let currentOffset = 0;
    const textNodes: Array<{ node: Node, start: number, end: number, pageIndex: number }> = [];

    for (let pageIndex = 0; pageIndex < textLayers.length; pageIndex++) {
        const treeWalker = document.createTreeWalker(
            textLayers[pageIndex],
            NodeFilter.SHOW_TEXT,
            null
        );

        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            const length = currentNode.textContent?.length || 0;
            textNodes.push({
                node: currentNode,
                start: currentOffset,
                end: currentOffset + length,
                pageIndex
            });
            currentOffset += length;
        }
    }

    // Find overlapping nodes using the hint offsets
    const { start_offset, end_offset } = sourceHighlight;
    if (start_offset === undefined || end_offset === undefined) {
        console.warn("Source highlight does not have valid offsets.");
        return [];
    }

    const overlappingNodes = textNodes.filter(node =>
        (node.start <= start_offset && node.end > start_offset) ||
        (node.start >= start_offset && node.end <= end_offset) ||
        (node.start < end_offset && node.end >= end_offset) ||
        (start_offset <= node.start && end_offset >= node.end)
    );

    // Convert to elements and verify the text content roughly matches
    const nodeElements = overlappingNodes.map(n => n.node.parentElement).filter(Boolean) as Element[];

    // Simple text validation - check if the combined text from nodes contains most of our target text
    const combinedText = nodeElements.map(el => el.textContent || '').join(' ').toLowerCase();
    const targetText = sourceHighlight.raw_text.toLowerCase();
    const overlap = calculateSimilarity(combinedText, targetText);

    // If there's good text overlap (>70%), consider this a direct match
    if (overlap > 0.7) {
        return nodeElements;
    }

    return [];
}

export const getFuzzyMatchingNodesInPdf = (originalTerm: string) => {
    const results: Array<{
        pageIndex: number;
        matchIndex: number;
        nodes: Element[];
        similarity: number;
    }> = [];

    // Prepare the search term for fuzzy matching (space-stripped version for matching)
    // Also prepare a space-stripped version for fallback matching
    const spaceStrippedSearchTerm = prepareTextForFuzzyMatch(originalTerm, true);

    // Use first 15 chars as seed, but from space-stripped version for better matching
    const searchSeed = spaceStrippedSearchTerm.slice(0, 15).toLowerCase();

    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');

    textLayers.forEach((layer, pageIndex) => {
        const textNodes = Array.from(layer.querySelectorAll('span'));
        if (textNodes.length === 0) return;

        const filteredTextNodes = textNodes.filter(node => node.textContent && node.textContent.trim() !== '');
        const fullPageText = filteredTextNodes.map(node => node.textContent || '').join(' ');

        // Create mapping between original and prepared text positions
        const charMapping = createCharacterMapping(fullPageText);
        const preparedPageText = prepareTextForFuzzyMatch(fullPageText);

        // Create space-stripped version for matching PDFs with weird spacing
        const spaceStrippedPageText = prepareTextForFuzzyMatch(fullPageText, true);

        // Create mapping from space-stripped positions back to prepared text positions
        const spaceStrippedToPreparedIndex: number[] = [];
        for (let i = 0; i < preparedPageText.length; i++) {
            if (preparedPageText[i] !== ' ') {
                spaceStrippedToPreparedIndex.push(i);
            }
        }

        let startIndex = 0;
        let matchIndex = 0;

        while (startIndex < spaceStrippedPageText.length) {
            const foundIndex = spaceStrippedPageText.indexOf(searchSeed, startIndex);
            if (foundIndex === -1) break;

            // Create a more precise window for the full search term
            const searchTermLength = spaceStrippedSearchTerm.length;
            const seedLength = searchSeed.length;

            // Calculate window in space-stripped text
            const spaceStrippedWindowStart = foundIndex;
            const spaceStrippedWindowEnd = Math.min(
                spaceStrippedPageText.length,
                foundIndex + Math.max(searchTermLength, seedLength * 2)
            );
            const spaceStrippedWindow = spaceStrippedPageText.slice(spaceStrippedWindowStart, spaceStrippedWindowEnd);

            // Calculate similarity using space-stripped versions
            const similarity = calculateSimilarity(spaceStrippedSearchTerm, spaceStrippedWindow);

            if (similarity > 0.5) {
                // Map back: space-stripped -> prepared -> original
                const preparedWindowStart = spaceStrippedToPreparedIndex[spaceStrippedWindowStart] ?? 0;
                const preparedWindowEnd = (spaceStrippedToPreparedIndex[spaceStrippedWindowEnd - 1] ?? preparedWindowStart) + 1;

                // Map back to original text positions using character mapping
                const originalWindowStart = mapPreparedToOriginal(preparedWindowStart, charMapping);
                const originalWindowEnd = mapPreparedToOriginal(preparedWindowEnd, charMapping);

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

        // Skip all quote characters entirely
        if (quoteChars.has(char)) {
            continue;
        }

        // Handle Greek letters and math symbols - they expand to multiple chars
        if (greekLetterMap[char]) {
            const expanded = greekLetterMap[char].toLowerCase();
            for (let i = 0; i < expanded.length; i++) {
                preparedToOriginal[preparedIndex] = originalIndex;
                originalToPrepared[originalIndex] = preparedIndex;
                preparedIndex++;
            }
            lastWasSpace = false;
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

export function getSelectionOffsets(): { start: number, end: number, pageNumber: number } | null {
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

    let startPage: number | undefined;

    // Create a map to store node offsets
    const nodeOffsets = new Map<Node, { start: number, end: number, pageIndex: number }>();

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
                end: offset + length,
                pageIndex: i
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
        startPage = nodeOffset.pageIndex;
    }

    // Calculate end offset
    if (nodeOffsets.has(endNode)) {
        const nodeOffset = nodeOffsets.get(endNode)!;
        endOffset = nodeOffset.start + range.endOffset;
    }

    if (startOffset > -1 && endOffset > -1 && startPage !== undefined) {
        // Handle backwards selection (user selected from right to left)
        if (startOffset > endOffset) {
            [startOffset, endOffset] = [endOffset, startOffset];
        }

        return { start: startOffset, end: endOffset, pageNumber: startPage };
    }

    return null;
}

export function getPdfTextContent(): string {
    const textContent = document.querySelector('.react-pdf__Page__textContent');
    if (!textContent) return '';

    return textContent.textContent || '';
}
