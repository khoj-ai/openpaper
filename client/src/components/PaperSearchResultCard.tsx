import { PaperResult, HighlightResult, AnnotationResult } from "@/lib/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
    Book,
    ChevronDown,
    ChevronRight,
    Highlighter,
    MessageSquare,
    Calendar,
    User,
    FileText,
    ExternalLink,
    Trash2
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
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
    const [showHighlights, setShowHighlights] = useState(false);
    const [showAnnotations, setShowAnnotations] = useState(false);
    const [explicitStatus, setExplicitStatus] = useState<PaperStatus | null>(null);

    const highlightCount = paper.highlights?.length || 0;
    const annotationCount = paper.annotations?.length || 0;
    const hasMetadata = highlightCount > 0 || annotationCount > 0;

    return (
        <Card className="w-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <Link href={`/paper/${paper.id}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <Book className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <h3 className="text-lg font-semibold leading-tight line-clamp-2">
                                    {highlightSearchTerm(paper.title || "Untitled", searchTerm)}
                                </h3>
                            </div>
                        </Link>

                        {/* Authors Section */}

                        {paper.authors && paper.authors.length > 0 && (
                            <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                                <User className="h-3 w-3" />
                                <span className="line-clamp-1">
                                    {paper.authors.slice(0, 3).join(", ")}
                                    {paper.authors.length > 3 && ` +${paper.authors.length - 3} more`}
                                </span>
                            </div>
                        )}

                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                            {paper.publish_date && (
                                <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    <span>Published {formatDate(paper.publish_date)}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                <span>Added {formatDate(paper.created_at)}</span>
                            </div>
                        </div>

                        {paper.abstract && (
                            <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                                {highlightSearchTerm(truncateText(paper.abstract, 300), searchTerm)}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
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

                        <div className="flex gap-1">
                            {/* Delete Button with Confirmation Dialog */}
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                        <Trash2 size={14} className="text-muted-foreground" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogTitle>Delete Paper</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to delete "{paper.title}"?
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

            {hasMetadata && (
                <CardContent className="pt-0">
                    <Separator className="mb-3" />

                    <div className="space-y-3">
                        {/* Highlights Section */}
                        {highlightCount > 0 && (
                            <Collapsible open={showHighlights} onOpenChange={setShowHighlights}>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="w-full justify-start p-0 h-auto">
                                        <div className="flex items-center gap-2 text-sm">
                                            {showHighlights ? (
                                                <ChevronDown className="h-4 w-4" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4" />
                                            )}
                                            <Highlighter className="h-4 w-4 text-yellow-600" />
                                            <span className="font-medium">
                                                {highlightCount} Highlight{highlightCount !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2">
                                    <div className="space-y-2 pl-6">
                                        {paper.highlights.slice(0, 3).map((highlight: HighlightResult) => (
                                            <div key={highlight.id} className="p-2 bg-yellow-50 dark:bg-yellow-950 rounded border-l-2 border-yellow-400">
                                                <p className="text-sm">
                                                    {highlightSearchTerm(truncateText(highlight.raw_text, 150), searchTerm)}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                    {highlight.page_number && (
                                                        <span>Page {highlight.page_number}</span>
                                                    )}
                                                    <span>•</span>
                                                    <span>{formatDate(highlight.created_at)}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {highlightCount > 3 && (
                                            <p className="text-xs text-muted-foreground pl-2">
                                                +{highlightCount - 3} more highlights
                                            </p>
                                        )}
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        )}

                        {/* Annotations Section */}
                        {annotationCount > 0 && (
                            <Collapsible open={showAnnotations} onOpenChange={setShowAnnotations}>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="w-full justify-start p-0 h-auto">
                                        <div className="flex items-center gap-2 text-sm">
                                            {showAnnotations ? (
                                                <ChevronDown className="h-4 w-4" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4" />
                                            )}
                                            <MessageSquare className="h-4 w-4 text-blue-600" />
                                            <span className="font-medium">
                                                {annotationCount} Annotation{annotationCount !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2">
                                    <div className="space-y-2 pl-6">
                                        {paper.annotations.slice(0, 3).map((annotation: AnnotationResult) => (
                                            <div key={annotation.id} className="p-2 bg-blue-50 dark:bg-blue-950 rounded border-l-2 border-blue-400">
                                                <p className="text-sm font-medium mb-1">
                                                    {highlightSearchTerm(truncateText(annotation.content, 150), searchTerm)}
                                                </p>
                                                {annotation.highlight && (
                                                    <p className="text-xs text-muted-foreground mb-1 italic">
                                                        "{truncateText(annotation.highlight.raw_text, 100)}"
                                                    </p>
                                                )}
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    {annotation.highlight?.page_number && (
                                                        <span>Page {annotation.highlight.page_number}</span>
                                                    )}
                                                    <span>•</span>
                                                    <span>{formatDate(annotation.created_at)}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {annotationCount > 3 && (
                                            <p className="text-xs text-muted-foreground pl-2">
                                                +{annotationCount - 3} more annotations
                                            </p>
                                        )}
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    );
}
