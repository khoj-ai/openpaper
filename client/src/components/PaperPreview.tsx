"use client";

import { PaperItem } from "@/lib/schema";
import { Button } from "./ui/button";
import { X, ExternalLink, Highlighter } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { handleStatusChange, truncateText } from "@/components/utils/paperUtils";
import { getStatusIcon, PaperStatusEnum } from "@/components/utils/PdfStatus";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PaperProjects } from "./PaperProjects";
import { TagSelector } from "./TagSelector";
import { fetchFromApi } from "@/lib/api";
import { useHighlights } from "./hooks/PdfHighlight";
import { useState } from "react";
import { CitePaperButton } from "./CitePaperButton";

interface PaperPreviewProps {
    paper: PaperItem;
    onClose: () => void;
    setPaper: (paperId: string, updatedPaper: PaperItem) => void;
}

export function PaperPreview({ paper, onClose, setPaper }: PaperPreviewProps) {
    const { highlights } = useHighlights(paper.id);
    const [showAllHighlights, setShowAllHighlights] = useState(false);

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
        <div className="border bg-card rounded-lg transition-all duration-300 ease-in-out min-w-0 overflow-hidden">
            <div className="h-full">
                <div className="p-4 relative overflow-y-auto">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 z-10"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                    <Link href={`/paper/${paper.id}`} passHref>
                        <h3 className="font-bold text-lg mb-2 pr-8 hover:underline cursor-pointer flex items-center gap-2">
                            {paper.title}
                            <ExternalLink className="h-4 w-4 flex-shrink-0" />
                        </h3>
                    </Link>
                    {paper.preview_url && (
                        <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={paper.preview_url}
                                alt="Paper preview"
                                className="w-full h-auto my-4 rounded-md"
                            />
                        </>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
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
                        <CitePaperButton paper={paper} minimalist={true} />
                    </div>
                    <p className="text-sm my-4 break-words max-h-[20vh] overflow-y-auto">{paper.abstract}</p>

                    {/* Highlights Section */}
                    {highlightCount > 0 && (
                        <div className="space-y-2 mb-4">
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

                    <div className="space-y-2 mb-4">
                        <h4 className="font-semibold text-sm">Tags</h4>
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
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 text-xs">Add Tag</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-80" align="start">
                                    <TagSelector
                                        paperIds={[paper.id]}
                                        onTagsApplied={onTagsApplied}
                                    />
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    <PaperProjects id={paper.id} view='compact' />
                </div>
            </div>
        </div>
    );
}
