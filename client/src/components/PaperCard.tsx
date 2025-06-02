import { PaperItem } from "@/components/AppSidebar";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getStatusIcon, PaperStatus, PaperStatusEnum } from "@/components/utils/PdfStatus";
import { fetchFromApi } from "@/lib/api";


interface PaperCardProps {
    paper: PaperItem;
    handleDelete: (paperId: string) => void;
    setPaper(paperId: string, paper: PaperItem): void;
}

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


export default function PaperCard({ paper, handleDelete, setPaper }: PaperCardProps) {

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

    const handleStatusChange = async (status: PaperStatus) => {
        try {
            const url = `/api/paper/status?status=${status}&paper_id=${paper?.id}`;
            const response: PaperItem = await fetchFromApi(url, {
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
            setPaper(paper.id, response); // Update the paper state with the new status
        } catch (error) {
            console.error('Error updating paper status:', error);
            toast.error("Failed to update paper status.");
        }
    };

    return (
        <Card key={paper.id}>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <a
                        href={`/paper/${paper.id}`}
                        className="hover:underline flex-1"
                    >
                        {paper.title || paper.filename}
                    </a>
                    {paper.status && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 px-2 ml-2">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        {getStatusIcon(paper.status)}
                                        {paper.status}
                                    </span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleStatusChange(PaperStatusEnum.TODO)}>
                                    {getStatusIcon("todo")}
                                    Todo
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange(PaperStatusEnum.READING)}>
                                    {getStatusIcon("reading")}
                                    Reading
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange(PaperStatusEnum.COMPLETED)}>
                                    {getStatusIcon("completed")}
                                    Completed
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
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
                                    onClick={() => handleDelete(paper.id)}
                                >
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardFooter>
        </Card>
    )
}
