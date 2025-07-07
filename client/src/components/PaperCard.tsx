import { PaperItem } from "@/components/AppSidebar";
import { Card } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Book, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getStatusIcon, PaperStatusEnum } from "@/components/utils/PdfStatus";
import Link from "next/link";
import { formatFileSize } from "@/hooks/useSubscription";
import { citationStyles, handleStatusChange } from "./utils/paperUtils";


interface PaperCardProps {
    paper: PaperItem;
    handleDelete?: (paperId: string) => void;
    setPaper(paperId: string, paper: PaperItem): void;
}

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

    return (
        <Card key={paper.id} className="overflow-hidden hover:shadow-md transition-shadow pt-2 pb-0">
            <div className="flex h-fit flex-col md:flex-row">
                {/* Metadata Section */}
                <div className="md:w-4/5 p-4 flex flex-col justify-between">
                    {/* Header with status */}
                    <div>
                        <div className="flex items-start justify-between mb-3">
                            {paper.status && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                                            <span className="flex items-center gap-1">
                                                {getStatusIcon(paper.status)}
                                                {paper.status}
                                            </span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleStatusChange(paper, PaperStatusEnum.TODO, setPaper)}>
                                            {getStatusIcon("todo")}
                                            Todo
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleStatusChange(paper, PaperStatusEnum.READING, setPaper)}>
                                            {getStatusIcon("reading")}
                                            Reading
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleStatusChange(paper, PaperStatusEnum.COMPLETED, setPaper)}>
                                            {getStatusIcon("completed")}
                                            Completed
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}

                            {/* Action buttons in top right */}
                            <div className="flex gap-1">
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                                            Cite
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-[625px]">
                                        <DialogHeader>
                                            <DialogTitle>Cite Paper</DialogTitle>
                                            <DialogDescription>
                                                Copy the citation format you need for <b>{paper.title}</b>.
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
                                                                className="mt-5 h-8 w-8 flex-shrink-0"
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
                                {
                                    handleDelete && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                                    <Trash2 size={14} className="text-muted-foreground" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogTitle>Delete Paper</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Are you sure you want to delete {paper.title}?
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
                                    )
                                }
                            </div>
                        </div>

                        <a href={`/paper/${paper.id}`} className="block group">
                            <h3 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 mb-3 text-sm leading-tight group-hover:underline">
                                {paper.title}
                            </h3>
                        </a>

                        {/* Authors */}
                        {paper.authors && paper.authors.length > 0 && (
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                {paper.authors.slice(0, 2).join(", ")}
                                {paper.authors.length > 2 && ", et al."}
                            </p>
                        )}

                        {/* Keywords */}
                        {paper.keywords && paper.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                                {paper.keywords.slice(0, 3).map((keyword, index) => (
                                    <span
                                        key={index}
                                        className="inline-block bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5 rounded"
                                    >
                                        {keyword}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Institutions */}
                        {paper.institutions && paper.institutions.length > 0 && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {paper.institutions.slice(0, 2).join(", ")}
                                {paper.institutions.length > 2 && ", et al."}
                            </p>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                            <span>{new Date(paper.created_at || "").toLocaleDateString()}</span>
                            {paper.size_in_kb && (
                                <>
                                    <span>•</span>
                                    <span>{formatFileSize(paper.size_in_kb)}</span>
                                </>
                            )}
                        </div>
                        <Link href={`/paper/${paper.id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                            Read
                            <Book className="inline ml-1 h-3 w-3" />
                        </Link>
                    </div>
                </div>

                {/* Paper Preview Section */}
                {
                    paper.preview_url ? (
                        <div className="md:w-1/5 bg-gray-100 dark:bg-gray-800 p-4 pb-0 flex items-center justify-center border-b border-gray-200 dark:border-gray-700 rounded-t-2xl rounded-b-none">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={paper.preview_url}
                                title={paper.title}
                                alt={paper.title}
                                className="max-h-48 w-full object-cover object-top rounded-t-lg shadow-sm"
                            />
                        </div>
                    ) : (
                        <div className="md:w-1/5 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 p-4 flex flex-col justify-between border-r border-gray-200 dark:border-gray-700 rounded-t-2xl rounded-b-none">
                            {/* Abstract/Summary text overlay */}
                            <div className="mt-2">
                                <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-9">
                                    {paper.abstract || paper.summary || "This paper explores innovative approaches and methodologies in research..."}
                                </p>
                            </div>
                        </div>
                    )
                }
            </div>
        </Card>
    )
}
