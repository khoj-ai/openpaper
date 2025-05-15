"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { fetchFromApi } from "@/lib/api"
import { useEffect, useState } from "react"
import { PaperItem } from "@/components/AppSidebar"
import { Button } from "@/components/ui/button"
import { Copy, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

// TODO: We could add a search look-up for the paper journal name to avoid placeholders

// Helper function to format author names based on citation style rules
const formatAuthors = (authors: string[] | undefined, style: 'MLA' | 'APA' | 'Harvard' | 'Chicago' | 'IEEE' | 'AMA' | 'AAA'): string => {
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
const getYear = (dateString: string | undefined): string => {
    if (!dateString) return "n.d.";
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return "n.d."; // Invalid date
        return date.getFullYear().toString();
    } catch {
        return "n.d.";
    }
};

// --- Citation Generation Functions ---
// Note: These are simplified and assume a generic "paper" type.
// Real-world citations need more specific info (journal, book title, publisher, DOI, etc.)
// Using placeholders like "[Source Placeholder]" where data is missing.

const generateMLA = (paper: PaperItem): string => {
    const authors = formatAuthors(paper.authors, 'MLA');
    const title = paper.title || paper.filename || "[Untitled]";
    const year = getYear(paper.created_at);
    // Basic structure: Author(s). "Title." *Source*, Year.
    return `${authors ? authors + '. ' : ''}"${title}." *[Source Placeholder]*, ${year}.`;
};

const generateHarvard = (paper: PaperItem): string => {
    const authors = formatAuthors(paper.authors, 'Harvard');
    const year = getYear(paper.created_at);
    const title = paper.title || paper.filename || "[Untitled]";
    // Basic structure: Author(s) (Year). *Title*. [Source Placeholder].
    return `${authors ? authors + ' ' : ''}(${year}). *${title}*. [Source Placeholder].`;
};

const generateAAA = (paper: PaperItem): string => {
    const authors = formatAuthors(paper.authors, 'AAA');
    const year = getYear(paper.created_at);
    const title = paper.title || paper.filename || "[Untitled]";
    // Basic structure: Author(s) Year. "Title." *[Publication Venue Placeholder]*. [Location Placeholder]: [Publisher Placeholder].
    return `${authors ? authors + ' ' : ''}${year}. "${title}." *[Publication Venue Placeholder]*.`;
};

const generateIEEE = (paper: PaperItem): string => {
    const authors = formatAuthors(paper.authors, 'IEEE');
    const title = paper.title || paper.filename || "[Untitled]";
    const year = getYear(paper.created_at);
    // Basic structure: Author(s), "Title," *[Source Abbreviation Placeholder]*, [vol. placeholder], [no. placeholder], [pp. placeholder], ${year}.
    return `${authors ? authors + ', ' : ''}"${title}," *[Source Abbr. Placeholder]*, ${year}.`;
};

const generateAMA = (paper: PaperItem): string => {
    const authors = formatAuthors(paper.authors, 'AMA');
    const title = paper.title || paper.filename || "[Untitled]";
    const year = getYear(paper.created_at);
    // Basic structure: Author(s). Title. *JournalAbbr*. Year;vol(issue):pages.
    return `${authors ? authors + '. ' : ''}${title}. *[Journal Abbr. Placeholder]*. ${year}.`;
};

const generateChicago = (paper: PaperItem): string => { // Assuming Author-Date style for simplicity here
    const authors = formatAuthors(paper.authors, 'Chicago'); // Use Chicago formatting for authors
    const year = getYear(paper.created_at);
    const title = paper.title || paper.filename || "[Untitled]";
    // Basic Author-Date: Author(s). Year. "Title." *Source*. [DOI/URL Placeholder]
    return `${authors ? authors + '. ' : ''}${year}. "${title}." *[Source Placeholder]*.`;
};

const generateAPA = (paper: PaperItem): string => {
    const authors = formatAuthors(paper.authors, 'APA');
    const year = getYear(paper.created_at);
    const title = paper.title || paper.filename || "[Untitled]";
    // Basic structure: Author(s). (Year). *Title*. [Source Placeholder]. [DOI/URL Placeholder]
    return `${authors ? authors + ' ' : ''}(${year}). *${title}*. [Source Placeholder].`;
};

// Define citation styles and their generators
const citationStyles = [
    { name: 'MLA', generator: generateMLA },
    { name: 'Harvard', generator: generateHarvard },
    { name: 'AAA', generator: generateAAA },
    { name: 'IEEE', generator: generateIEEE },
    { name: 'AMA', generator: generateAMA },
    { name: 'Chicago (Author-Date)', generator: generateChicago },
    { name: 'APA', generator: generateAPA },
];

export default function PapersPage() {
    const [papers, setPapers] = useState<PaperItem[]>([])
    const [searchTerm, setSearchTerm] = useState<string>("")
    const [filteredPapers, setFilteredPapers] = useState<PaperItem[]>([])

    useEffect(() => {
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all")
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setPapers(sortedPapers)
                setFilteredPapers(sortedPapers)
            } catch (error) {
                console.error("Error fetching papers:", error)
            }
        }

        fetchPapers()
    }, [])

    const deletePaper = async (paperId: string) => {
        try {
            await fetchFromApi(`/api/paper?id=${paperId}`, {
                method: "DELETE",
            })
            setPapers(papers.filter((paper) => paper.id !== paperId));
            setFilteredPapers(filteredPapers.filter((paper) => paper.id !== paperId));
        } catch (error) {
            console.error("Error deleting paper:", error)
        }
    }

    const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
        const term = event.target.value.toLowerCase()
        setSearchTerm(term)
        setFilteredPapers(
            papers.filter((paper) =>
                paper.title?.toLowerCase().includes(term) ||
                paper.filename?.toLowerCase().includes(term) ||
                paper.keywords?.some((keyword) => keyword.toLowerCase().includes(term)) ||
                paper.abstract?.toLowerCase().includes(term) ||
                paper.authors?.some((author) => author.toLowerCase().includes(term)) ||
                paper.institutions?.some((institution) => institution.toLowerCase().includes(term)) ||
                paper.summary?.toLowerCase().includes(term)
            )
        )
    }

    // Function to copy text to clipboard
    const copyToClipboard = (text: string, styleName: string) => {
        navigator.clipboard.writeText(text).then(() => {
            // Success feedback using toast
            toast("Copied!", {
                description: `${styleName} citation copied to clipboard.`,
                richColors: true,
            });
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            // Error feedback using toast
            toast("Copy failed", {
                description: "Could not copy citation to clipboard.",
                richColors: true,
            });
        });
    };


    return (
        <div className="container mx-auto w-2/3 p-8">
            <div className="mb-4">
                <Input
                    type="text"
                    placeholder="Search your paper bank"
                    value={searchTerm}
                    onChange={handleSearch}
                    className="w-full p-2 border border-gray-300 rounded"
                />
            </div>
            <div className="grid grid-cols-1 gap-4">
                {filteredPapers.map((paper) => (
                    <Card key={paper.id}>
                        <CardHeader>
                            <a
                                href={`/paper/${paper.id}`}
                                className="hover:underline"
                            >
                                {paper.title || paper.filename}
                            </a>
                        </CardHeader>
                        <CardContent>
                            <CardDescription>
                                {
                                    paper.keywords && paper.keywords.length > 0 && (
                                        <div className="mb-2 flex flex-wrap gap-2">
                                            {
                                                paper.keywords.slice(0, 5).map((keyword, index) => (
                                                    <span
                                                        key={index}
                                                        className="inline-block bg-blue-200 dark:bg-blue-800 text-sm font-semibold mr-2 px-2.5 py-0.5 rounded"
                                                    >
                                                        {keyword}
                                                    </span>
                                                ))
                                            }
                                        </div>
                                    )
                                }
                                {
                                    paper.authors && (
                                        <p className="text-sm text-gray-500 mb-2">
                                            {paper.authors.slice(0, 5).join(", ")}
                                            {paper.authors.length > 5 && `, et al.`}
                                        </p>
                                    )
                                }
                            </CardDescription>
                            {paper.abstract && (
                                <p className="text-sm text-gray-500 line-clamp-3">
                                    {paper.abstract}
                                </p>
                            )}
                            {!paper.abstract && paper.summary && (
                                <p className="text-sm text-gray-500 line-clamp-3">
                                    {paper.summary}
                                </p>
                            )}
                            {
                                paper.institutions && (
                                    <p className="text-sm text-gray-500 mt-2">
                                        {paper.institutions.slice(0, 5).join(", ")}
                                        {paper.institutions.length > 5 && `, et al.`}
                                    </p>
                                )
                            }
                        </CardContent>
                        <CardFooter className="flex flex-row justify-between items-start">
                            <p className="text-sm text-gray-500">
                                {new Date(paper.created_at || "").toLocaleDateString()}
                            </p>
                            <div className="flex gap-2"> {/* Added a div to group buttons */}
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant={"outline"} size={"sm"}>Cite</Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-[625px]">
                                        <DialogHeader>
                                            <DialogTitle>Cite Paper</DialogTitle>
                                            <DialogDescription>
                                                Copy the citation format you need for <b>{paper.title || paper.filename}</b>.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <ScrollArea className="h-[300px] w-full rounded-md border p-4">
                                            <div className="grid gap-4 py-4">
                                                {citationStyles.map((style) => {
                                                    const citationText = style.generator(paper);
                                                    return (
                                                        <div key={style.name} className="flex items-start justify-between gap-2">
                                                            <div className="flex-grow">
                                                                <h4 className="font-semibold mb-1">{style.name}</h4>
                                                                <p className="text-sm bg-muted p-2 rounded break-words">{citationText}</p>
                                                            </div>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="mt-5 h-8 w-8 flex-shrink-0" // Adjust margin-top if needed
                                                                onClick={() => copyToClipboard(citationText, style.name)}
                                                                aria-label={`Copy ${style.name} citation`}
                                                            >
                                                                <Copy className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </ScrollArea>
                                        <DialogFooter>
                                            <DialogClose asChild>
                                                <Button type="button" variant="secondary">
                                                    Close
                                                </Button>
                                            </DialogClose>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant={"ghost"}
                                            size={"icon"} // Make delete button icon-sized
                                            className="h-9 w-9" // Adjust size if needed
                                        >
                                            <Trash2 size={16} className="text-secondary-foreground" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogTitle>Delete Paper</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Are you sure you want to delete {paper.title || paper.filename}?
                                            This action cannot be undone.
                                        </AlertDialogDescription>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => deletePaper(paper.id)}
                                            >
                                                Delete
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </div>
    )
}
