"use client";

import { PaperItem } from "@/lib/schema";
import { Button } from "./ui/button";
import { X, ExternalLink, Copy } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { citationStyles, handleStatusChange } from "@/components/utils/paperUtils";
import { getStatusIcon, PaperStatusEnum } from "@/components/utils/PdfStatus";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PaperProjects } from "./PaperProjects";

interface PaperPreviewProps {
    paper: PaperItem;
    onClose: () => void;
    setPaper: (paperId: string, updatedPaper: PaperItem) => void;
}

export function PaperPreview({ paper, onClose, setPaper }: PaperPreviewProps) {

    const copyToClipboard = (text: string, styleName: string) => {
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

    return (
        <div className="border bg-card rounded-lg transition-all duration-300 ease-in-out min-w-0 overflow-hidden">
            <div className="h-full">
                <div className="p-4 relative max-h-[70vh] overflow-y-auto">
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
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 px-3 text-xs">
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
                                                    <div className="flex-grow min-w-0">
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
                    </div>
                    <p className="text-sm my-4 break-words">{paper.abstract}</p>
                    <PaperProjects id={paper.id} view='compact' />
                </div>
            </div>
        </div>
    );
}
