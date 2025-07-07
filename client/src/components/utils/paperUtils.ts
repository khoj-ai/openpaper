import React from "react";
import { toast } from "sonner";
import { fetchFromApi } from "@/lib/api";
import { PaperStatus, PaperStatusEnum } from "@/components/utils/PdfStatus";

// Common interface for papers (can be PaperItem or PaperResult)
export interface PaperBase {
    id: string;
    title?: string;
    authors?: string[];
    status?: PaperStatus;
    created_at?: string;
}

// Helper function to format author names based on citation style rules
export const formatAuthors = (authors: string[] | undefined, style: 'MLA' | 'APA' | 'Harvard' | 'Chicago' | 'IEEE' | 'AMA' | 'AAA'): string => {
    if (!authors || authors.length === 0) return "";

    const formatSingleName = (name: string, index: number, total: number, style: string): string => {
        const parts = name.trim().split(' ');
        const lastName = parts.pop() || "";
        const firstNames = parts; // Keep all remaining parts as first/middle names

        switch (style) {
            case 'MLA':
            case 'Chicago': // Notes & Bibliography style uses First Last
            case 'AAA':
                // First author: Last, First Middle
                // Subsequent authors: First Middle Last
                if (index === 0) return `${lastName}, ${firstNames.join(' ')}`;
                return `${firstNames.join(' ')} ${lastName}`;
            case 'APA':
            case 'Harvard':
                // All authors: Last, F. M. (using initials)
                const apaInitials = firstNames.map(part => part.charAt(0).toUpperCase() + '.').join(' ');
                return `${lastName}, ${apaInitials}`;
            case 'AMA':
                // All authors: Last FM (no periods, no space between initials)
                const amaInitials = firstNames.map(part => part.charAt(0).toUpperCase()).join('');
                return `${lastName} ${amaInitials}`;
            case 'IEEE':
                // All authors: F. M. Last
                const ieeeInitials = firstNames.map(part => part.charAt(0).toUpperCase() + '.').join('. ');
                return `${ieeeInitials}. ${lastName}`; // Added period after initials block
            default:
                return name; // Should not happen
        }
    };

    // Basic 'et al.' rules (can be more complex)
    let maxAuthorsToShow = authors.length;
    let useEtAl = false;

    if (style === 'MLA' && authors.length > 2) { maxAuthorsToShow = 1; useEtAl = true; }
    else if (style === 'APA' && authors.length > 20) { maxAuthorsToShow = 19; useEtAl = true; } // Show first 19, ..., last 1
    else if (style === 'Harvard' && authors.length > 3) { maxAuthorsToShow = 3; useEtAl = true; }
    else if (style === 'AMA' && authors.length > 6) { maxAuthorsToShow = 3; useEtAl = true; } // Show first 3, et al.
    else if (style === 'IEEE' && authors.length > 6) { maxAuthorsToShow = 3; useEtAl = true; } // Show first 3, et al.
    else if (style === 'Chicago' && authors.length > 10) { maxAuthorsToShow = 7; useEtAl = true; } // Show first 7, et al.
    else if (style === 'AAA' && authors.length > 3) { maxAuthorsToShow = 1; useEtAl = true; } // Show first 1, et al.

    const formattedNames = authors.slice(0, maxAuthorsToShow).map((name, index) => formatSingleName(name, index, authors.length, style));

    // Handle APA's specific ellipsis for >20 authors
    if (style === 'APA' && useEtAl) {
        formattedNames.push('...');
        formattedNames.push(formatSingleName(authors[authors.length - 1], authors.length - 1, authors.length, style));
    }

    let joinedNames = "";
    if (formattedNames.length === 1) {
        joinedNames = formattedNames[0];
    } else {
        const separator = (style === 'AMA' || style === 'IEEE') ? ", " : ", "; // Default separator
        const conjunction = (style === 'APA') ? ' &' : (style === 'MLA' || style === 'Chicago' || style === 'AAA') ? ' and' : ','; // Conjunction before last author

        if (style === 'APA' && formattedNames.includes('...')) {
            // Join with commas, including the ellipsis
            joinedNames = formattedNames.join(separator);
        } else if (formattedNames.length > 1) {
            const lastAuthor = formattedNames.pop() || '';
            joinedNames = formattedNames.join(separator);
            // Add appropriate conjunction if needed (not for AMA/IEEE which just use commas)
            if (style !== 'AMA' && style !== 'IEEE') {
                joinedNames += (formattedNames.length > 0 ? conjunction : '') + ' ' + lastAuthor;
            } else {
                joinedNames += separator + lastAuthor; // Just use comma for AMA/IEEE
            }
        }
    }

    // Add 'et al.' if applicable (and not handled by APA's ellipsis)
    if (useEtAl && !(style === 'APA' && authors.length > 20)) {
        // Check if et al. should replace names or be appended
        if (style === 'AMA' || style === 'IEEE' || style === 'Harvard' || style === 'Chicago' || style === 'AAA' || style === 'MLA') {
            // Replace names after max shown with et al.
            joinedNames = authors.slice(0, maxAuthorsToShow).map((name, index) => formatSingleName(name, index, authors.length, style)).join(style === 'AMA' || style === 'IEEE' ? ", " : ", ") + ", et al.";
        }
        // For MLA with exactly 2 authors, no et al. is used. If > 2, only first author + et al.
        if (style === 'MLA' && authors.length > 2) {
            joinedNames = formatSingleName(authors[0], 0, authors.length, style) + ", et al.";
        }
    }

    return joinedNames;
};

// Helper to get year or n.d.
export const getYear = (dateString: string | undefined): string => {
    if (!dateString) return "n.d.";
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return "n.d."; // Invalid date
        return date.getFullYear().toString();
    } catch {
        return "n.d.";
    }
};

// Citation generation functions
export const generateMLA = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'MLA');
    const title = paper.title || "[Untitled]";
    const year = getYear(paper.created_at);
    return `${authors ? authors + '. ' : ''}"${title}." *[Source Placeholder]*, ${year}.`;
};

export const generateHarvard = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'Harvard');
    const year = getYear(paper.created_at);
    const title = paper.title || "[Untitled]";
    return `${authors ? authors + ' ' : ''}(${year}). *${title}*. [Source Placeholder].`;
};

export const generateAAA = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'AAA');
    const year = getYear(paper.created_at);
    const title = paper.title || "[Untitled]";
    return `${authors ? authors + ' ' : ''}${year}. "${title}." *[Publication Venue Placeholder]*.`;
};

export const generateIEEE = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'IEEE');
    const title = paper.title || "[Untitled]";
    const year = getYear(paper.created_at);
    return `${authors ? authors + ', ' : ''}"${title}," *[Source Abbr. Placeholder]*, ${year}.`;
};

export const generateAMA = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'AMA');
    const title = paper.title || "[Untitled]";
    const year = getYear(paper.created_at);
    return `${authors ? authors + '. ' : ''}${title}. *[Journal Abbr. Placeholder]*. ${year}.`;
};

export const generateChicago = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'Chicago');
    const year = getYear(paper.created_at);
    const title = paper.title || "[Untitled]";
    return `${authors ? authors + '. ' : ''}${year}. "${title}." *[Source Placeholder]*.`;
};

export const generateAPA = (paper: PaperBase): string => {
    const authors = formatAuthors(paper.authors, 'APA');
    const year = getYear(paper.created_at);
    const title = paper.title || "[Untitled]";
    return `${authors ? authors + ' ' : ''}(${year}). *${title}*. [Source Placeholder].`;
};

// Define citation styles and their generators
export const citationStyles = [
    { name: 'MLA', generator: generateMLA },
    { name: 'Harvard', generator: generateHarvard },
    { name: 'AAA', generator: generateAAA },
    { name: 'IEEE', generator: generateIEEE },
    { name: 'AMA', generator: generateAMA },
    { name: 'Chicago (Author-Date)', generator: generateChicago },
    { name: 'APA', generator: generateAPA },
];

// Function to copy text to clipboard
export const copyToClipboard = (text: string, styleName: string) => {
    navigator.clipboard.writeText(text).then(() => {
        toast("Copied!", {
            description: `${styleName} citation copied to clipboard.`,
            richColors: true,
        });
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        toast("Copy failed", {
            description: "Could not copy citation to clipboard.",
            richColors: true,
        });
    });
};

// Function to handle status changes
export const handleStatusChange = async <T extends PaperBase>(
    paper: T,
    status: PaperStatus,
    setPaper: (paperId: string, paper: T) => void
): Promise<void> => {
    try {
        const url = `/api/paper/status?status=${status}&paper_id=${paper?.id}`;
        const response: T = await fetchFromApi(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (status === PaperStatusEnum.COMPLETED) {
            toast.success(
                "Completed reading! 🎉",
                {
                    description: `Congrats on finishing ${paper?.title}!`,
                    duration: 5000,
                }
            )
        } else {
            toast.info(
                `Marked as ${status}. Keep going!`,
                {
                    description: `You have marked ${paper?.title} as ${status}.`,
                    duration: 3000,
                }
            );
        }
        setPaper(paper.id, response);
    } catch (error) {
        console.error('Error updating paper status:', error);
        toast.error("Failed to update paper status.");
    }
};

// Helper function to format date
export const formatDate = (dateString: string): string => {
    try {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateString;
    }
};

// Helper function to truncate text
export const truncateText = (text: string, maxLength: number = 200): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
};
