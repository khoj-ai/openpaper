"use client";

import { useEffect } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProjectPaperPreview } from "@/components/ProjectPaperPreview";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

// On-demand reading pane: papers opened from the rail or citation clicks stack
// up as tabs here, so reading never navigates away from the chat.
export function ReaderPanel() {
    const {
        papers,
        openPaperIds,
        activePaperId,
        readerSearchTerm,
        activatePaper,
        closePaper,
        closeReader,
        refreshPaperUrl,
    } = useProjectWorkspace();

    const openPapers = openPaperIds
        .map((id) => papers.find((p) => p.id === id))
        .filter((p) => p !== undefined);
    const activePaper = openPapers.find((p) => p.id === activePaperId) ?? null;

    // file URLs are loaded lazily; fetch one for the active paper when missing.
    useEffect(() => {
        if (activePaper && !activePaper.file_url) {
            refreshPaperUrl(activePaper.id);
        }
    }, [activePaper, refreshPaperUrl]);

    if (openPapers.length === 0) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-[46%] md:min-w-[420px] md:max-w-[760px] md:shrink-0 md:border-l">
            {/* Tabs of open papers */}
            <div className="flex shrink-0 items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                    {openPapers.map((paper) => {
                        const isActive = paper.id === activePaperId;
                        return (
                            <div
                                key={paper.id}
                                onClick={() => activatePaper(paper.id)}
                                className={cn(
                                    "flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                                    isActive
                                        ? "border bg-background font-medium shadow-sm"
                                        : "border border-transparent text-muted-foreground hover:bg-accent",
                                )}
                            >
                                <FileText
                                    className={cn("h-3 w-3 shrink-0", isActive ? "text-blue-500" : "text-muted-foreground/70")}
                                    aria-hidden
                                />
                                <span className="truncate">{paper.title}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closePaper(paper.id);
                                    }}
                                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    aria-label={`Close ${paper.title}`}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={closeReader}
                    aria-label="Close reader"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
            {/* Active paper */}
            <div className="min-h-0 flex-1">
                {activePaper ? (
                    activePaper.file_url ? (
                        <ProjectPaperPreviewPane
                            key={activePaper.id}
                            paperId={activePaper.id}
                            searchTerm={readerSearchTerm}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        </div>
                    )
                ) : null}
            </div>
        </div>
    );
}

// Thin wrapper so the viewer re-reads the (lazily patched) paper from context
// without remounting when only file_url changes.
function ProjectPaperPreviewPane({ paperId, searchTerm }: { paperId: string; searchTerm: string | null }) {
    const { projectId, papers } = useProjectWorkspace();
    const paper = papers.find((p) => p.id === paperId);
    if (!paper) return null;
    return <ProjectPaperPreview paper={paper} projectId={projectId} searchTerm={searchTerm} />;
}
