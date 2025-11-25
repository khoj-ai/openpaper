import { PaperItem } from "@/lib/schema";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";
import { PdfViewer } from "./PdfViewer";
import { useRouter } from "next/navigation";
import { fetchFromApi } from "@/lib/api";
import { useEffect, useState } from "react";
import { CitePaperButton } from "./CitePaperButton";

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
                        <CitePaperButton paper={paper} minimalist={true} />
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
