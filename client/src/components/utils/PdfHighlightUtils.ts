import {
    PaperHighlight,
} from '@/lib/schema';
import { getFuzzyMatchingNodesInPdf, tryDirectOffsetMatch } from './PdfTextUtils';

export interface HighlightHandlers {
    setIsHighlightInteraction: (value: boolean) => void;
    setSelectedText: (text: string) => void;
    setTooltipPosition: (position: { x: number; y: number } | null) => void;
    setIsAnnotating: (value: boolean) => void;
    setActiveHighlight: (highlight: PaperHighlight | null) => void;
}

export function findAllHighlightedPassages(highlights: PaperHighlight[]) {
    // Get ALL text content layers (one per page)
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
    if (textLayers.length === 0) return [];

    const matches = [];

    // Collect all text nodes from all pages with their offsets
    let currentOffset = 0;
    const textNodes: Array<{ node: Node, start: number, end: number }> = [];

    // Process each page in order
    for (let i = 0; i < textLayers.length; i++) {
        // Create a walker for this page
        const treeWalker = document.createTreeWalker(
            textLayers[i],
            NodeFilter.SHOW_TEXT,
            null
        );

        // Process all text nodes on this page
        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            const length = currentNode.textContent?.length || 0;
            textNodes.push({
                node: currentNode,
                start: currentOffset,
                end: currentOffset + length
            });
            currentOffset += length;
        }
    }

    // For each highlight, find nodes that overlap with the offsets
    for (const highlight of highlights) {
        const { start_offset, end_offset } = highlight;

        if (start_offset === undefined || end_offset === undefined) {
            continue;
        }

        if (start_offset < 0 || end_offset < 0 || start_offset >= end_offset) {
            continue;
        }

        // Find all nodes that overlap with this highlight range
        const overlappingNodes = textNodes.filter(node =>
            (node.start <= start_offset && node.end > start_offset) || // Node contains highlight start
            (node.start >= start_offset && node.end <= end_offset) ||  // Node is fully within highlight
            (node.start < end_offset && node.end >= end_offset) ||     // Node contains highlight end
            (start_offset <= node.start && end_offset >= node.end)     // Highlight fully contains node
        );

        if (overlappingNodes.length > 0) {
            // Convert Node objects to Element objects (their parents)
            const nodeElements = overlappingNodes.map(n => {
                const parent = n.node.parentElement;
                return parent as Element;
            }).filter(Boolean);

            matches.push({
                nodes: nodeElements,
                sourceHighlight: highlight,
                textRange: {
                    start: start_offset,
                    end: end_offset
                }
            });
        }
    }

    return matches;
}

export function addAIHighlightToNodes(
    sourceHighlight: PaperHighlight,
    handlers: {
        setIsHighlightInteraction: (value: boolean) => void;
        setSelectedText: (text: string) => void;
        setTooltipPosition: (position: { x: number; y: number } | null) => void;
        setIsAnnotating: (value: boolean) => void;
        setActiveHighlight: (highlight: PaperHighlight | null) => void;
    }
) {
    // First, try to use the offset hints for direct matching (like regular highlights)
    const directMatch = tryDirectOffsetMatch(sourceHighlight);
    if (directMatch.length > 0) {
        for (const node of directMatch) {
            applyAIHighlightToNode(node, sourceHighlight, handlers);
        }
        if (sourceHighlight.id) {
            directMatch[0].setAttribute('data-highlight-id', sourceHighlight.id);
        }
        return;
    }

    // Fallback to fuzzy matching, but constrain to the specific page
    const fuzzyMatches = getFuzzyMatchingNodesInPdf(
        sourceHighlight.raw_text,
    );

    if (fuzzyMatches.length === 0) {
        console.warn(`No matches found for AI highlight: "${sourceHighlight.raw_text.substring(0, 30)}..." on page ${sourceHighlight.page_number}`);
        return;
    }

    // Take the best match
    const bestMatch = fuzzyMatches[0];
    const matchingNodes = bestMatch.nodes;

    for (const node of matchingNodes) {
        applyAIHighlightToNode(node, sourceHighlight, handlers);
    }

    if (matchingNodes.length > 0 && sourceHighlight.id) {
        matchingNodes[0].setAttribute('data-highlight-id', sourceHighlight.id);
    }
}

function applyAIHighlightToNode(
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
    // Add AI-specific highlighting (different styling from regular highlights)
    node.classList.add('border-2', 'border-purple-500', 'bg-purple-100', 'rounded', 'opacity-30');

    // Add a visual indicator that this is an AI highlight
    node.setAttribute('data-highlight', 'true');
    node.setAttribute('title', 'AI-generated highlight');

    // Add click event to show highlight options
    node.addEventListener('click', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.stopPropagation();
        handlers.setIsHighlightInteraction(true);
        handlers.setSelectedText(sourceHighlight.raw_text);
        handlers.setTooltipPosition({ x: mouseEvent.clientX, y: mouseEvent.clientY });
        handlers.setActiveHighlight(sourceHighlight);
    });
}

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
    const { start_offset, end_offset } = sourceHighlight;

    if (start_offset === undefined || end_offset === undefined) {
        console.warn(`Highlight ${sourceHighlight.id} has undefined offsets, skipping`);
        return;
    }

    if (start_offset < 0 || end_offset < 0 || start_offset >= end_offset) {
        console.warn(`Invalid highlight offsets for ${sourceHighlight.id}: ${start_offset}-${end_offset}, skipping`);
        return;
    }

    // Get ALL text content layers (one per page)
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent');
    if (textLayers.length === 0) return;

    // First collect all text nodes and their offsets across all pages
    let textOffset = 0;
    const allNodes = new Map<Node, { start: number, end: number }>();

    // Process each page in order
    for (let i = 0; i < textLayers.length; i++) {
        const treeWalker = document.createTreeWalker(
            textLayers[i],
            NodeFilter.SHOW_TEXT,
            null
        );

        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            const length = currentNode.textContent?.length || 0;
            allNodes.set(currentNode, {
                start: textOffset,
                end: textOffset + length
            });
            textOffset += length;
        }
    }

    // Process each node that needs highlighting
    for (const node of nodes) {
        // Find corresponding text node(s) within this element
        const textNodesInElement = Array.from(node.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE);

        // If the node has no text nodes, skip it
        if (textNodesInElement.length === 0) continue;

        // Check how the node overlaps with our highlight range
        let highlightWholeNode = false;
        let startInNode = false;
        let endInNode = false;
        let startOffset = 0;
        let endOffset = 0;

        for (const textNode of textNodesInElement) {
            const nodeInfo = allNodes.get(textNode);
            if (!nodeInfo) continue;

            // Check overlap cases
            if (nodeInfo.start <= start_offset && nodeInfo.end > start_offset) {
                // Node contains highlight start
                startInNode = true;
                startOffset = start_offset - nodeInfo.start;
            }

            if (nodeInfo.start < end_offset && nodeInfo.end >= end_offset) {
                // Node contains highlight end
                endInNode = true;
                endOffset = end_offset - nodeInfo.start;
            }

            if (start_offset <= nodeInfo.start && end_offset >= nodeInfo.end) {
                // Highlight fully contains this node
                highlightWholeNode = true;
            }
        }

        // Apply appropriate highlighting based on overlap type
        if (highlightWholeNode || (textNodesInElement.length === 1 && startInNode && endInNode)) {
            // Highlight the entire node
            applyHighlightToNode(node, sourceHighlight, handlers);
        } else if (startInNode || endInNode) {
            // Create partial highlight within the node
            createHighlightedTextFragments(
                node,
                sourceHighlight,
                handlers,
                startInNode ? startOffset : 0,
                endInNode ? endOffset : (node.textContent?.length || 0)
            );
        }
    }

    // Add a data-id property to the node for easy identification. Pick either the first node or the only node.
    const node = nodes[0];
    if (node && sourceHighlight.id) {
        node.setAttribute('data-highlight-id', sourceHighlight.id);
    }
}

function applyHighlightToNode(
    node: Element,
    sourceHighlight: PaperHighlight,
    handlers: HighlightHandlers
) {
    // Add highlighting to the node
    node.classList.add('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

    // Add click event to show highlight options
    node.addEventListener('click', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.stopPropagation();
        handlers.setIsHighlightInteraction(true);
        handlers.setSelectedText(sourceHighlight.raw_text);
        handlers.setTooltipPosition({ x: mouseEvent.clientX, y: mouseEvent.clientY });
        handlers.setActiveHighlight(sourceHighlight);
    });
}

function createHighlightedTextFragments(
    node: Element,
    sourceHighlight: PaperHighlight,
    handlers: HighlightHandlers,
    startOffset: number,
    endOffset: number
) {
    const textNode = Array.from(node.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (!textNode || !textNode.textContent) return;

    const text = textNode.textContent;

    // Create a fragment to replace the text node
    const fragment = document.createDocumentFragment();

    // Add text before highlight
    if (startOffset > 0) {
        fragment.appendChild(document.createTextNode(text.substring(0, startOffset)));
    }

    // Add highlighted text
    const highlightSpan = document.createElement('span');
    highlightSpan.textContent = text.substring(startOffset, endOffset);
    highlightSpan.classList.add('border-2', 'border-blue-500', 'bg-blue-100', 'rounded', 'opacity-20');

    // Add click event to show highlight options
    highlightSpan.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        handlers.setIsHighlightInteraction(true);
        handlers.setSelectedText(sourceHighlight.raw_text);
        handlers.setTooltipPosition({ x: e.clientX, y: e.clientY });
        handlers.setActiveHighlight(sourceHighlight);
    });

    fragment.appendChild(highlightSpan);

    // Add text after highlight
    if (endOffset < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(endOffset)));
    }

    // Replace the original text node with our fragment
    node.replaceChild(fragment, textNode);
}
