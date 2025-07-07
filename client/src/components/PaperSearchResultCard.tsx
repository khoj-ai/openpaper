import { PaperResult } from "@/lib/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
    Book,
    Highlighter,
    MessageSquare,
    Calendar,
    User,
    FileText,
    Trash2,
    Image as ImageIcon,
    ArrowDown
} from "lucide-react";
import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDate, truncateText, handleStatusChange } from "./utils/paperUtils";
import { PaperItem } from "./AppSidebar";
import { getStatusIcon, PaperStatus, PaperStatusEnum } from "@/components/utils/PdfStatus";

interface PaperSearchResultCardProps {
    paper: PaperResult;
    searchTerm?: string;
    setPaper(paperId: string, paper: PaperItem): void;
    handleDelete(paperId: string): void;
}

// Helper function to highlight search terms in text
const highlightSearchTerm = (text: string, searchTerm?: string): React.ReactNode => {
    if (!searchTerm || !text) return text;

    const regex = new RegExp(`(${searchTerm})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) =>
        regex.test(part) ? (
            <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">
                {part}
            </mark>
        ) : part
    );
};

export default function PaperSearchResultCard({ paper, searchTerm, setPaper, handleDelete }: PaperSearchResultCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [explicitStatus, setExplicitStatus] = useState<PaperStatus | null>(null);

    const highlightCount = paper.highlights?.length || 0;
    const annotationCount = paper.annotations?.length || 0;
    const hasMetadata = highlightCount > 0 || annotationCount > 0;

    // Group annotations by their parent highlights
    const highlightsWithAnnotations = useMemo(() => {
        if (!paper.highlights) return [];

        return paper.highlights.map(highlight => ({
            ...highlight,
            annotations: paper.annotations?.filter(annotation =>
                annotation.highlight?.id === highlight.id
            ) || []
        }));
    }, [paper.highlights, paper.annotations]);

    // Get standalone annotations (those without a parent highlight)
    const standaloneAnnotations = useMemo(() => {
        if (!paper.annotations) return [];

        return paper.annotations.filter(annotation =>
            !annotation.highlight?.id ||
            !paper.highlights?.some(highlight => highlight.id === annotation.highlight.id)
        );
    }, [paper.annotations, paper.highlights]);

    const handleCardClick = (e: React.MouseEvent) => {
        // Don't expand if clicking on buttons, dropdowns, or links
        const target = e.target as HTMLElement;
        const isInteractiveElement = target.closest('button, a, [role="menuitem"], [role="button"]');

        if (!isInteractiveElement && hasMetadata) {
            setIsExpanded(!isExpanded);
        }
    };

    return (
        <Card
            className={`w-full hover:shadow-md transition-shadow ${hasMetadata ? 'cursor-pointer' : ''}`}
            onClick={handleCardClick}
        >
            <CardHeader className="pb-2">
                <div className="flex gap-4">
                    {/* Main content - left side */}
                    <div className="flex-1 min-w-0">
                        <Link href={`/paper/${paper.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                            <div className="flex items-start gap-2 mb-2">
                                <Book className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                                <h3 className="text-base font-semibold leading-tight line-clamp-2">
                                    {highlightSearchTerm(paper.title || "Untitled", searchTerm)}
                                </h3>
                            </div>
                        </Link>

                        {/* Compact metadata row */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                            {paper.authors && paper.authors.length > 0 && (
                                <>
                                    <div className="flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        <span className="truncate max-w-[200px]">
                                            {paper.authors.slice(0, 2).join(", ")}
                                            {paper.authors.length > 2 && ` +${paper.authors.length - 2}`}
                                        </span>
                                    </div>
                                    <span>•</span>
                                </>
                            )}
                            {paper.publish_date && (
                                <>
                                    <div className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        <span>{formatDate(paper.publish_date)}</span>
                                    </div>
                                    <span>•</span>
                                </>
                            )}
                            <div className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                <span>Added {formatDate(paper.created_at)}</span>
                            </div>
                        </div>

                        {/* Compact abstract */}
                        {paper.abstract && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                                {highlightSearchTerm(truncateText(paper.abstract, 200), searchTerm)}
                            </p>
                        )}

                        {/* Compact stats */}
                        {hasMetadata && (
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {highlightCount > 0 && (
                                    <div className="flex items-center gap-1">
                                        <Highlighter className="h-3 w-3 text-yellow-600" />
                                        <span>{highlightCount} highlight{highlightCount !== 1 ? 's' : ''}</span>
                                    </div>
                                )}
                                {annotationCount > 0 && (
                                    <div className="flex items-center gap-1">
                                        <MessageSquare className="h-3 w-3 text-blue-600" />
                                        <span>{annotationCount} annotation{annotationCount !== 1 ? 's' : ''}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {!isExpanded && hasMetadata && (
                            <div className="text-center py-2">
                                <ArrowDown className="h-4 w-4 text-muted-foreground" />
                            </div>
                        )}
                    </div>

                    {/* Preview image and controls - right side */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {/* Preview image */}
                        <div className="w-20 h-24 bg-muted rounded border overflow-hidden relative">
                            <Image
                                src={paper.preview_url || ''}
                                alt={`Preview of ${paper.title}`}
                                width={80}
                                height={96}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    // Hide the image and show fallback
                                    const target = e.currentTarget;
                                    const fallback = target.parentElement?.querySelector('.fallback-icon');
                                    if (target && fallback) {
                                        target.style.display = 'none';
                                        (fallback as HTMLElement).style.display = 'flex';
                                    }
                                }}
                            />
                            <div className="fallback-icon absolute inset-0 hidden items-center justify-center bg-muted">
                                <ImageIcon className="h-6 w-6 text-muted-foreground" />
                            </div>
                        </div>

                        {/* Status and controls */}
                        <div className="flex flex-col items-end gap-1">
                            {/* Status Dropdown */}
                            {paper.status && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                                            <span className="flex items-center gap-1">
                                                {getStatusIcon(explicitStatus || paper.status as PaperStatus)}
                                                {explicitStatus || paper.status}
                                            </span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => {
                                            handleStatusChange(
                                                { ...paper, title: paper.title || "Untitled" } as PaperItem,
                                                PaperStatusEnum.TODO,
                                                setPaper
                                            );
                                            setExplicitStatus(PaperStatusEnum.TODO);
                                        }}>
                                            {getStatusIcon("todo")}
                                            Todo
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => {
                                            handleStatusChange(
                                                { ...paper, title: paper.title || "Untitled" } as PaperItem,
                                                PaperStatusEnum.READING,
                                                setPaper
                                            );
                                            setExplicitStatus(PaperStatusEnum.READING);
                                        }}>
                                            {getStatusIcon("reading")}
                                            Reading
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => {
                                            handleStatusChange(
                                                { ...paper, title: paper.title || "Untitled" } as PaperItem,
                                                PaperStatusEnum.COMPLETED,
                                                setPaper
                                            );
                                            setExplicitStatus(PaperStatusEnum.COMPLETED);
                                        }}>
                                            {getStatusIcon("completed")}
                                            Completed
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}

                            {/* Delete Button */}
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                        <Trash2 size={12} className="text-muted-foreground" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogTitle>Delete Paper</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to delete &quot;{paper.title}&quot;?
                                        This action cannot be undone.
                                    </AlertDialogDescription>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDelete(paper.id)}>
                                            Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                </div>
            </CardHeader>

            {hasMetadata && isExpanded && (
                <CardContent className="pt-0">
                    <Separator className="mb-3" />

                    <div className="space-y-3">
                        {/* Highlights with nested annotations */}
                        {highlightsWithAnnotations.length > 0 && highlightsWithAnnotations.slice(0, 3).map((highlight) => (
                            <div key={highlight.id} className="space-y-2">
                                {/* Highlight */}
                                <div className="p-2 border-l-2 border-yellow-400">
                                    <p className="text-sm">
                                        {highlightSearchTerm(truncateText(highlight.raw_text, 150), searchTerm)}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                        {highlight.page_number && (
                                            <span>Page {highlight.page_number}</span>
                                        )}
                                        <span>•</span>
                                        <span>{formatDate(highlight.created_at)}</span>
                                        {highlight.annotations.length > 0 && (
                                            <>
                                                <span>•</span>
                                                <span className="flex items-center gap-1">
                                                    <MessageSquare className="h-3 w-3" />
                                                    {highlight.annotations.length} note{highlight.annotations.length !== 1 ? 's' : ''}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Nested annotations */}
                                {highlight.annotations.length > 0 && (
                                    <div className="space-y-2 ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                                        {highlight.annotations.map((annotation) => (
                                            <div key={annotation.id} className="p-2 bg-blue-50 dark:bg-blue-950 border-l-2 border-blue-400">
                                                <p className="text-sm font-medium">
                                                    {highlightSearchTerm(truncateText(annotation.content, 120), searchTerm)}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                    <MessageSquare className="h-3 w-3" />
                                                    <span>{formatDate(annotation.created_at)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Standalone annotations */}
                        {standaloneAnnotations.length > 0 && standaloneAnnotations.slice(0, 2).map((annotation) => (
                            <div key={annotation.id} className="space-y-2">
                                {/* Parent highlight */}
                                {annotation.highlight && (
                                    <div className="p-2 border-l-2 border-yellow-400">
                                        <p className="text-sm">
                                            {highlightSearchTerm(truncateText(annotation.highlight.raw_text, 150), searchTerm)}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                            {annotation.highlight.page_number && (
                                                <span>Page {annotation.highlight.page_number}</span>
                                            )}
                                            <span>•</span>
                                            <span>{formatDate(annotation.highlight.created_at)}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Annotation */}
                                <div className="ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                                    <div className="p-2 bg-blue-50 dark:bg-blue-950 border-l-2 border-blue-400">
                                        <p className="text-sm font-medium">
                                            {highlightSearchTerm(truncateText(annotation.content, 120), searchTerm)}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                            <MessageSquare className="h-3 w-3" />
                                            <span>{formatDate(annotation.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Show more indicator */}
                        {(highlightsWithAnnotations.length > 3 || standaloneAnnotations.length > 2) && (
                            <p className="text-xs text-muted-foreground">
                                {highlightsWithAnnotations.length > 3 && `+${highlightsWithAnnotations.length - 3} more highlights`}
                                {highlightsWithAnnotations.length > 3 && standaloneAnnotations.length > 2 && ", "}
                                {standaloneAnnotations.length > 2 && `+${standaloneAnnotations.length - 2} more notes`}
                            </p>
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    );
}
