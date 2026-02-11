"use client";

import { PaperData, PaperItem } from "@/lib/schema";
import { Button } from "./ui/button";
import { X, ExternalLink, Highlighter, Plus, FileText, Download } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { handleStatusChange, truncateText } from "@/components/utils/paperUtils";
import { getStatusIcon, PaperStatusEnum } from "@/components/utils/PdfStatus";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PaperProjects } from "./PaperProjects";
import { TagSelector } from "./TagSelector";
import { fetchFromApi } from "@/lib/api";
import { useHighlighterHighlights } from "./hooks/PdfHighlighterHighlights";
import { useEffect, useState } from "react";
import { CitePaperButton } from "./CitePaperButton";
import { Skeleton } from "@/components/ui/skeleton";

interface PaperPreviewProps {
    paper: PaperItem;
    onClose: () => void;
    setPaper: (paperId: string, updatedPaper: PaperItem) => void;
}

export function PaperPreview({ paper, onClose, setPaper }: PaperPreviewProps) {
    const { highlights } = useHighlighterHighlights(paper.id);
    const [showAllHighlights, setShowAllHighlights] = useState(false);
    const [loadedPaper, setLoadedPaper] = useState<PaperData | null>(null);
    const [previewLoaded, setPreviewLoaded] = useState(false);

    useEffect(() => {
        // Fetch the full paper data to get tags and other details
        setLoadedPaper(null);
        setPreviewLoaded(false);
        fetchFromApi(`/api/paper?id=${paper.id}`)
            .then(data => setLoadedPaper(data))
            .catch(error => console.error("Failed to load paper data", error));
    }, [paper.id]);

    const highlightCount = highlights?.filter(highlight => highlight.role === 'user').length || 0;

    const handleRemoveTag = async (tagId: string) => {
        try {
            await fetchFromApi(`/api/paper/tag/papers/${paper.id}/tags/${tagId}`, {
                method: "DELETE",
            });
            const updatedPaper = {
                ...paper,
                tags: paper.tags?.filter(t => t.id !== tagId)
            };
            setPaper(paper.id, updatedPaper);
        } catch (error) {
            console.error("Failed to remove tag", error);
            toast.error("Failed to remove tag.");
        }
    };

    const onTagsApplied = () => {
        // Let's try to update the paper by refetching it.
        fetchFromApi(`/api/paper?id=${paper.id}`).then(updatedPaper => {
            setPaper(paper.id, updatedPaper);
        });
    };

    return (
        <div className="h-full border bg-card rounded-none transition-all duration-300 ease-in-out min-w-0 overflow-hidden flex flex-col">
            <div className="flex-grow p-4 relative overflow-y-auto">
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 z-10"
                    onClick={onClose}
                >
                    <X className="h-4 w-4" />
                </Button>

                {/* Title + Actions */}
                <div>
                    <Link href={`/paper/${paper.id}`} passHref>
                        <h3 className="font-bold text-lg mb-2 pr-8 hover:underline cursor-pointer flex items-center gap-2">
                            {paper.title}
                            <ExternalLink className="h-4 w-4 flex-shrink-0" />
                        </h3>
                    </Link>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/paper/${paper.id}`} passHref>
                            <Button size="sm" variant="outline" className="h-8 px-3 text-xs">
                                <FileText className="h-3.5 w-3.5 mr-1.5" />
                                Open
                            </Button>
                        </Link>
                        {loadedPaper?.file_url && (
                            <a href={loadedPaper.file_url} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="outline" className="h-8 px-3 text-xs">
                                    <Download className="h-3.5 w-3.5 mr-1.5" />
                                    Download
                                </Button>
                            </a>
                        )}
                        <CitePaperButton paper={[loadedPaper ?? paper]} minimalist={true} variant="outline" />
                        {paper.status && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="outline" className="h-8 px-3 text-xs capitalize">
                                        <span className="flex items-center gap-2">
                                            {getStatusIcon(paper.status)}
                                            {paper.status}
                                        </span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleStatusChange(paper, PaperStatusEnum.TODO, setPaper)}>
                                        {getStatusIcon(PaperStatusEnum.TODO)}
                                        Todo
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleStatusChange(paper, PaperStatusEnum.READING, setPaper)}>
                                        {getStatusIcon(PaperStatusEnum.READING)}
                                        Reading
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleStatusChange(paper, PaperStatusEnum.COMPLETED, setPaper)}>
                                        {getStatusIcon(PaperStatusEnum.COMPLETED)}
                                        Completed
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </div>

                {/* Preview Image */}
                {paper.preview_url && (
                    <div className="border-t border-border pt-4 mt-4">
                        {!previewLoaded && (
                            <Skeleton className="w-full aspect-[3/4] rounded-md" />
                        )}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            key={paper.id}
                            src={paper.preview_url}
                            alt="Paper preview"
                            className={`w-full h-auto rounded-md ${!previewLoaded ? "hidden" : ""}`}
                            onLoad={() => setPreviewLoaded(true)}
                        />
                    </div>
                )}

                {/* Paper Info Section - Tabular Layout */}
                <div className="border-t border-border pt-4 mt-4">
                    <div className="text-sm border rounded-md overflow-hidden">
                        <table className="w-full">
                            <tbody className="divide-y divide-border">
                                {paper?.authors && paper.authors.length > 0 && (
                                    <tr>
                                        <td className="px-3 py-2 text-muted-foreground font-medium text-right whitespace-nowrap align-top w-24">Author</td>
                                        <td className="px-3 py-2">{paper.authors.join(', ')}</td>
                                    </tr>
                                )}
                                {paper?.publish_date && (
                                    <tr>
                                        <td className="px-3 py-2 text-muted-foreground font-medium text-right whitespace-nowrap align-top w-24">Published</td>
                                        <td className="px-3 py-2">{new Date(paper.publish_date).toLocaleDateString()}</td>
                                    </tr>
                                )}
                                {!loadedPaper && (
                                    <>
                                        <tr>
                                            <td className="px-3 py-2 text-right w-24"><Skeleton className="h-4 w-12 ml-auto" /></td>
                                            <td className="px-3 py-2"><Skeleton className="h-4 w-48" /></td>
                                        </tr>
                                        <tr>
                                            <td className="px-3 py-2 text-right w-24"><Skeleton className="h-4 w-16 ml-auto" /></td>
                                            <td className="px-3 py-2"><Skeleton className="h-4 w-32" /></td>
                                        </tr>
                                    </>
                                )}
                                {loadedPaper?.doi && (
                                    <tr>
                                        <td className="px-3 py-2 text-muted-foreground font-medium text-right whitespace-nowrap align-top w-24">DOI</td>
                                        <td className="px-3 py-2">
                                            <a
                                                href={`https://doi.org/${loadedPaper.doi}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline"
                                            >
                                                {loadedPaper.doi}
                                            </a>
                                        </td>
                                    </tr>
                                )}
                                {loadedPaper?.journal && (
                                    <tr>
                                        <td className="px-3 py-2 text-muted-foreground font-medium text-right whitespace-nowrap align-top w-24">Publication</td>
                                        <td className="px-3 py-2">{loadedPaper.journal}</td>
                                    </tr>
                                )}
                                {loadedPaper?.publisher && (
                                    <tr>
                                        <td className="px-3 py-2 text-muted-foreground font-medium text-right whitespace-nowrap align-top w-24">Publisher</td>
                                        <td className="px-3 py-2">{loadedPaper.publisher}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Highlights Section */}
                {highlightCount > 0 && (
                    <div className="border-t border-border pt-4 mt-4 space-y-2">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                            <Highlighter className="h-4 w-4 text-yellow-600" />
                            Highlights ({highlightCount})
                        </h4>
                        <div className="space-y-3">
                            {highlights.filter(highlight => highlight.role === 'user').slice(0, showAllHighlights ? undefined : 3).map((highlight) => (
                                <div key={highlight.id} className="p-2 border-l-2 border-yellow-400 bg-yellow-50/50 dark:bg-yellow-950/20 rounded-r">
                                    <p className="text-sm">
                                        {truncateText(highlight.raw_text, 200)}
                                    </p>
                                    {highlight.page_number != null && (
                                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                            <span>Page {highlight.page_number + 1}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {highlightCount > 3 && (
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-xs"
                                    onClick={() => setShowAllHighlights(!showAllHighlights)}
                                >
                                    {showAllHighlights
                                        ? 'Show less'
                                        : `+${highlightCount - 3} more highlight${highlightCount - 3 !== 1 ? 's' : ''}`
                                    }
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Tags Section */}
                <div className="border-t border-border pt-4 mt-4 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="font-semibold text-sm">Tags</h4>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-2.5 w-2.5" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-80" align="start">
                                <TagSelector
                                    paperIds={[paper.id]}
                                    onTagsApplied={onTagsApplied}
                                />
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                        {paper.tags?.map(tag => (
                            <span key={tag.id} className="group relative inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded-sm dark:bg-blue-900 dark:text-blue-200 text-xs">
                                {tag.name}
                                <button
                                    onClick={() => handleRemoveTag(tag.id)}
                                    className="ml-1.5 -mr-1 p-0.5 bg-blue-200/50 dark:bg-blue-800/50 text-blue-700 dark:text-blue-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="h-2.5 w-2.5" />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>

                {/* Projects Section */}
                <div className="border-t border-border pt-4 mt-4">
                    <PaperProjects id={paper.id} view='compact' />
                </div>
            </div>
        </div>
    );
}
