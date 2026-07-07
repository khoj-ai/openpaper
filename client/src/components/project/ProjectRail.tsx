"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
    ExternalLink,
    FileText,
    MessageCircle,
    MoreHorizontal,
    Plus,
    Search,
    Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchFromApi } from "@/lib/api";
import { PaperItem, ProjectRole } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { CitePaperButton } from "@/components/CitePaperButton";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

const RAIL_CHAT_LIMIT = 12;

interface ProjectRailProps {
    // Invoked after any rail navigation — lets the mobile sheet close itself.
    onNavigate?: () => void;
}

function SectionHeading({ label, count, children }: { label: string; count?: number; children?: React.ReactNode }) {
    return (
        <div className="flex h-8 shrink-0 items-center justify-between px-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
                {count != null && <span className="ml-1.5 font-normal text-muted-foreground/70">{count}</span>}
            </span>
            <div className="flex items-center gap-0.5">{children}</div>
        </div>
    );
}

function PaperRow({ paper, onNavigate }: { paper: PaperItem; onNavigate?: () => void }) {
    const { project, projectId, openPaper, openPaperIds, activePaperId, refetchPapers } = useProjectWorkspace();
    const isOpen = openPaperIds.includes(paper.id);
    const isActive = activePaperId === paper.id;
    const isViewer = project?.role === ProjectRole.Viewer;

    const handleUnlink = async () => {
        try {
            await fetchFromApi(`/api/projects/papers/${projectId}/${paper.id}`, {
                method: "DELETE",
            });
            toast.success("Paper removed from project.");
            refetchPapers();
        } catch (error) {
            console.error("Failed to unlink paper from project", error);
            toast.error("Failed to remove paper from project.");
        }
    };

    return (
        <div
            className={cn(
                "group flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                isActive
                    ? "bg-blue-50 dark:bg-blue-900/30"
                    : "hover:bg-accent",
            )}
            onClick={() => {
                openPaper(paper);
                onNavigate?.();
            }}
        >
            <FileText
                className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    isOpen ? "text-blue-500" : "text-muted-foreground/70",
                )}
                aria-hidden
            />
            <span
                className={cn(
                    "line-clamp-2 flex-1 text-xs leading-snug",
                    isActive ? "font-medium text-blue-700 dark:text-blue-300" : "text-foreground",
                )}
            >
                {paper.title}
            </span>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Paper actions"
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                    {paper.is_owner && (
                        <DropdownMenuItem asChild>
                            <Link href={`/paper/${paper.id}`}>
                                <ExternalLink className="h-4 w-4" />
                                Open full page
                            </Link>
                        </DropdownMenuItem>
                    )}
                    {!isViewer && (
                        <DropdownMenuItem variant="destructive" onClick={handleUnlink}>
                            <Unlink className="h-4 w-4" />
                            Remove from project
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

// Persistent left navigation for the project workspace: papers on top,
// chats below. Every project route is reachable from here.
export function ProjectRail({ onNavigate }: ProjectRailProps) {
    const pathname = usePathname();
    const params = useParams();
    const activeConversationId = params.conversationId as string | undefined;
    const {
        projectId,
        project,
        papers,
        isPapersLoading,
        conversations,
        isConversationsLoading,
        openAddPapers,
    } = useProjectWorkspace();
    const [paperSearchQuery, setPaperSearchQuery] = useState("");

    const isViewer = project?.role === ProjectRole.Viewer;

    const filteredPapers = useMemo(() => {
        if (!paperSearchQuery.trim()) return papers;
        const q = paperSearchQuery.toLowerCase();
        return papers.filter(
            (p) =>
                p.title?.toLowerCase().includes(q) ||
                p.authors?.some((a) => a.toLowerCase().includes(q)) ||
                p.tags?.some((t) => t.name.toLowerCase().includes(q)),
        );
    }, [papers, paperSearchQuery]);

    const shownConversations = conversations.slice(0, RAIL_CHAT_LIMIT);

    return (
        <div className="flex h-full w-64 shrink-0 flex-col bg-muted/20">
            {/* Papers */}
            <div className="flex min-h-0 flex-1 flex-col pt-2">
                <SectionHeading label="Papers" count={papers.length}>
                    {papers.length > 0 && <CitePaperButton paper={papers} minimalist={true} />}
                    {!isViewer && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => openAddPapers()}
                            aria-label="Add papers"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </SectionHeading>
                {papers.length > 5 && (
                    <div className="relative shrink-0 px-3 pb-1.5">
                        <Search className="absolute left-5 top-1/2 -translate-y-[60%] h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        <Input
                            placeholder="Search papers..."
                            value={paperSearchQuery}
                            onChange={(e) => setPaperSearchQuery(e.target.value)}
                            className="h-7 pl-7 text-xs"
                        />
                    </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                    {isPapersLoading ? (
                        <div className="space-y-2 px-2 pt-1">
                            {[1, 2, 3, 4].map((i) => (
                                <Skeleton key={i} className="h-8 w-full" />
                            ))}
                        </div>
                    ) : filteredPapers.length > 0 ? (
                        filteredPapers.map((paper) => (
                            <PaperRow key={paper.id} paper={paper} onNavigate={onNavigate} />
                        ))
                    ) : papers.length > 0 ? (
                        <p className="px-2 pt-2 text-xs text-muted-foreground">
                            No papers matching &ldquo;{paperSearchQuery}&rdquo;
                        </p>
                    ) : (
                        <div className="px-2 pt-1">
                            <p className="text-xs text-muted-foreground">No papers yet.</p>
                            {!isViewer && (
                                <Button
                                    variant="link"
                                    className="h-auto p-0 text-xs"
                                    onClick={() => openAddPapers()}
                                >
                                    Add your first paper
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Chats */}
            <div className="flex min-h-0 flex-1 flex-col border-t pt-2">
                <SectionHeading label="Chats" count={conversations.length} />
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                    {/* Explicit path back to the project home (= the new-chat surface) */}
                    {!isViewer && (
                        <Link
                            href={`/projects/${projectId}`}
                            onClick={onNavigate}
                            className={cn(
                                "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                                pathname === `/projects/${projectId}`
                                    ? "bg-blue-50 dark:bg-blue-900/30"
                                    : "hover:bg-accent",
                            )}
                        >
                            <Plus
                                className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    pathname === `/projects/${projectId}` ? "text-blue-500" : "text-muted-foreground/70",
                                )}
                                aria-hidden
                            />
                            <span
                                className={cn(
                                    "truncate text-xs",
                                    pathname === `/projects/${projectId}`
                                        ? "font-medium text-blue-700 dark:text-blue-300"
                                        : "text-foreground",
                                )}
                            >
                                New chat
                            </span>
                        </Link>
                    )}
                    {isConversationsLoading ? (
                        <div className="space-y-2 px-2 pt-1">
                            {[1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-6 w-full" />
                            ))}
                        </div>
                    ) : shownConversations.length > 0 ? (
                        <>
                            {shownConversations.map((convo) => {
                                const isActive = convo.id === activeConversationId;
                                return (
                                    <Link
                                        key={convo.id}
                                        href={`/projects/${projectId}/conversations/${convo.id}`}
                                        onClick={onNavigate}
                                        className={cn(
                                            "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                                            isActive ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-accent",
                                        )}
                                    >
                                        <MessageCircle
                                            className={cn(
                                                "h-3.5 w-3.5 shrink-0",
                                                isActive ? "text-blue-500" : "text-muted-foreground/70",
                                            )}
                                            aria-hidden
                                        />
                                        <span
                                            className={cn(
                                                "truncate text-xs",
                                                isActive
                                                    ? "font-medium text-blue-700 dark:text-blue-300"
                                                    : "text-foreground",
                                            )}
                                        >
                                            {convo.title}
                                        </span>
                                    </Link>
                                );
                            })}
                            {/* Sole route to chat management (rename/delete on /past) — always visible */}
                            <Link
                                href={`/projects/${projectId}/past`}
                                onClick={onNavigate}
                                className={cn(
                                    "block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                                    pathname.endsWith("/past") && "bg-blue-50 font-medium dark:bg-blue-900/30",
                                )}
                            >
                                {conversations.length > RAIL_CHAT_LIMIT ? `View all ${conversations.length}` : "Manage chats"}
                            </Link>
                        </>
                    ) : (
                        <p className="px-2 pt-1 text-xs text-muted-foreground">No chats yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
