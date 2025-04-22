import { useEffect, useState } from "react";
import { getFuzzyMatchingNodesInPdf, getMatchingNodesInPdf } from "../utils/PdfTextUtils";

function prepareTextForFuzzyMatch(text: string): string {
    return text
        // Remove quotes and apostrophes
        .replace(/['"''"]/g, '')
        // Remove currency symbols and numbers with units
        .replace(/[$€£¥]?\d+([.,]\d+)?%?/g, '')
        // Remove special characters including dashes, slashes, and other symbols
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\\[\]]/g, ' ')
        // Replace multiple spaces with single space
        .replace(/\s+/g, ' ')
        // Convert to lowercase
        .toLowerCase()
        // Trim leading/trailing whitespace
        .trim();
}

export function usePdfSearch(explicitSearchTerm?: string) {
    const [searchText, setSearchText] = useState("");
    const [searchResults, setSearchResults] = useState<Array<{
        pageIndex: number;
        matchIndex: number;
        nodes: Element[];
    }>>([]);
    const [currentMatch, setCurrentMatch] = useState(-1);
    const [notFound, setNotFound] = useState(false);

    const performSearch = (term?: string) => {
        const textToSearch = term || searchText;
        if (!textToSearch.trim()) {
            setSearchResults([]);
            setCurrentMatch(-1);
            return;
        }

        setNotFound(false);
        const results = getMatchingNodesInPdf(textToSearch);

        if (results.length === 0) {
            const preparedSearchTerm = prepareTextForFuzzyMatch(textToSearch);
            const fuzzyResults = getFuzzyMatchingNodesInPdf(preparedSearchTerm);
            if (fuzzyResults.length > 0) {
                results.push(...fuzzyResults);
            } else {
                setNotFound(true);
            }
        }

        setSearchResults(results);
        setCurrentMatch(results.length > 0 ? 0 : -1);

        // Scroll to first match if found
        if (results.length > 0) {
            scrollToMatch(results[0]);
        }
    };

    // Handle explicit search term if provided
    useEffect(() => {
        if (explicitSearchTerm) {
            performSearch(explicitSearchTerm);
        }
    }, [explicitSearchTerm, performSearch]);

    const scrollToMatch = (match: { pageIndex: number; matchIndex: number; nodes: Element[] }) => {
        if (!match) return;

        // Get the page div from the document
        const pageDiv = document.querySelectorAll('.react-pdf__Page')[match.pageIndex];
        if (!pageDiv) return;

        // Scroll to the page
        pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove styling from any existing highlights
        const pdfTextElements = document.querySelectorAll('.react-pdf__Page__textContent span.border-2');
        pdfTextElements.forEach(span => {
            if (span.classList.contains('bg-blue-100')) return;
            span.classList.remove('border-2', 'border-yellow-500', 'bg-yellow-100', 'rounded', 'opacity-20');
        });

        // Highlight all nodes that contain parts of the match
        setTimeout(() => {
            match.nodes.forEach(node => {
                if (node.classList.contains('bg-blue-100')) return;
                node.classList.add('border-2', 'border-yellow-500', 'bg-yellow-100', 'rounded', 'opacity-20');
            });

            // Scroll to the first matching node
            if (match.nodes.length > 0) {
                match.nodes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    };

    const goToNextMatch = () => {
        if (searchResults.length === 0) return;

        const nextMatch = (currentMatch + 1) % searchResults.length;
        setCurrentMatch(nextMatch);
        scrollToMatch(searchResults[nextMatch]);
    };

    const goToPreviousMatch = () => {
        if (searchResults.length === 0) return;

        const prevMatch = (currentMatch - 1 + searchResults.length) % searchResults.length;
        setCurrentMatch(prevMatch);
        scrollToMatch(searchResults[prevMatch]);
    };

    return {
        searchText,
        setSearchText,
        searchResults,
        currentMatch,
        notFound,
        performSearch,
        goToNextMatch,
        goToPreviousMatch,
        setSearchResults,
        setNotFound,
        setCurrentMatch,
    };
}
