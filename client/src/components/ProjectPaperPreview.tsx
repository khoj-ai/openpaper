import { PaperItem } from "@/lib/schema";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { citationStyles } from "@/components/utils/paperUtils";
import { Copy, FilePlus2 } from "lucide-react";
import { PdfViewer } from "./PdfViewer";
import { useRouter } from "next/navigation";
import { fetchFromApi } from "@/lib/api";
import { useEffect, useState } from "react";

interface ProjectPaperPreviewProps {
    paper: PaperItem;
    projectId: string;
}

export function ProjectPaperPreview({ paper, projectId }: ProjectPaperPreviewProps) {
    const router = useRouter();
    const [forkedPaper, setForkedPaper] = useState<PaperItem | null>(null);
    const [isCheckingFork, setIsCheckingFork] = useState(true);

    useEffect(() => {
        const checkForkStatus = async () => {
            if (!paper.id) return;
            setIsCheckingFork(true);
            try {
                const response = await fetchFromApi(`/api/projects/papers/forked/${paper.id}`);
                if (response.paper) {
                    setForkedPaper(response.paper);
                }
            } catch (error) {
                console.log("Could not check fork status, or paper is not forked.", error);
            } finally {
                setIsCheckingFork(false);
            }
        };

        checkForkStatus();
    }, [paper.id]);

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

    const handleDuplicate = async () => {
        if (!projectId) {
            toast.error("Cannot duplicate", {
                description: "This paper is not part of a project.",
                richColors: true,
            });
            return;
        }

        const toastId = toast.loading("Duplicating paper...");

        try {
            const requestBody = {
                source_project_id: projectId,
                paper_id: paper.id,
            };

            const response = await fetchFromApi('/api/projects/papers/fork', {
                method: 'POST',
                body: JSON.stringify(requestBody),
            });

            if (response.new_paper_id) {
                toast.success("Paper duplicated!", {
                    id: toastId,
                    description: "Paper has been duplicated successfully.",
                    richColors: true,
                });
                // Update the forked paper state to show the "View Fork" button
                setForkedPaper({ ...paper, id: response.new_paper_id });
            } else {
                throw new Error("Invalid response from server.");
            }
        } catch (error) {
            console.error("Failed to duplicate paper:", error);
            toast.error("Duplication failed", {
                id: toastId,
                description: "Could not duplicate the paper. Please try again.",
                richColors: true,
            });
        }
    };

    return (
        <div className="border bg-card rounded-lg transition-all duration-300 ease-in-out min-w-0 overflow-hidden h-full w-full">
            <div className="h-full flex flex-col">
                <div className="p-4 border-b">
                    <h3 className="font-bold text-lg mb-2 pr-8">{paper.title}</h3>
                    <div className="flex items-center gap-2 flex-wrap">
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
                        {isCheckingFork ? (
                            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" disabled>
                                <FilePlus2 className="h-4 w-4 mr-2" />
                                Checking...
                            </Button>
                        ) : forkedPaper ? (
                            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => router.push(`/paper/${forkedPaper.id}`)}>
                                <FilePlus2 className="h-4 w-4 mr-2" />
                                Open
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={handleDuplicate}>
                                <FilePlus2 className="h-4 w-4 mr-2" />
                                Add to My Library
                            </Button>
                        )}
                    </div>
                </div>
                <div className="flex-grow overflow-auto">
                    {paper.file_url && (
                        <PdfViewer
                            pdfUrl={paper.file_url}
                            explicitSearchTerm=""
                            setUserMessageReferences={() => { }}
                            highlights={[]}
                            setHighlights={() => { }}
                            selectedText=""
                            setSelectedText={() => { }}
                            tooltipPosition={null}
                            setTooltipPosition={() => { }}
                            setIsAnnotating={() => { }}
                            isHighlightInteraction={false}
                            setIsHighlightInteraction={() => { }}
                            activeHighlight={null}
                            setActiveHighlight={() => { }}
                            addHighlight={() => { }}
                            removeHighlight={() => { }}
                            loadHighlights={async () => { }}
                            handleTextSelection={() => { }}
                            renderAnnotations={() => { }}
                            annotations={[]}
                            setAddedContentForPaperNote={() => { }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
