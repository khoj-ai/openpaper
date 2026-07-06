"use client";

import { ArrowRight, BookOpen, Library, MessageCircle, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fetchFromApi } from "@/lib/api";
import { ProjectRole } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MentionInput } from "@/components/chat/MentionInput";
import {
    MentionSelection,
    EMPTY_MENTION_SELECTION,
} from "@/components/chat/MentionAutocomplete";
import { AnimatedGradientText } from "@/components/magicui/animated-gradient-text";
import { isChatCreditAtLimit, useSubscription } from "@/hooks/useSubscription";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

// Project home is the new-chat surface: a centered composer over the project's
// papers. Navigation to existing chats lives in the workspace rail.
export default function ProjectPage() {
    const router = useRouter();
    const {
        projectId,
        project,
        isProjectLoading,
        projectError,
        papers,
        isPapersLoading,
        conversations,
        isConversationsLoading,
        setAddPapersOpen,
        openPaperIds,
    } = useProjectWorkspace();

    const [error, setError] = useState<string | null>(null);
    const [newQuery, setNewQuery] = useState("");
    const [mentionSelection, setMentionSelection] = useState<MentionSelection>(EMPTY_MENTION_SELECTION);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { subscription } = useSubscription();

    const chatDisabled = isChatCreditAtLimit(subscription);
    const isViewer = project?.role === ProjectRole.Viewer;

    useEffect(() => {
        const CHAT_CREDIT_TOAST_KEY = "chat_credit_limit_toast_shown";
        if (chatDisabled && !sessionStorage.getItem(CHAT_CREDIT_TOAST_KEY)) {
            toast.error("Nice! You've used your chat credits for the week. Upgrade your plan to continue chatting.", {
                action: {
                    label: "Upgrade",
                    onClick: () => router.push("/pricing"),
                },
            });
            sessionStorage.setItem(CHAT_CREDIT_TOAST_KEY, "true");
        }
    }, [chatDisabled, router]);

    // Chat scope mirrors the reader tabs: papers open in the reader join the
    // @-mention scope; closing a tab removes them. Diffing against the previous
    // tab set preserves mentions the user typed by hand.
    const prevOpenPaperIdsRef = useRef<string[]>([]);
    useEffect(() => {
        const prev = prevOpenPaperIdsRef.current;
        const added = openPaperIds.filter((id) => !prev.includes(id));
        const removed = prev.filter((id) => !openPaperIds.includes(id));
        prevOpenPaperIdsRef.current = openPaperIds;
        if (added.length === 0 && removed.length === 0) return;
        setMentionSelection((sel) => ({
            ...sel,
            paperIds: [
                ...sel.paperIds.filter((id) => !removed.includes(id)),
                ...added.filter((id) => !sel.paperIds.includes(id)),
            ],
        }));
    }, [openPaperIds]);

    const handleNewQuery = async () => {
        if (!newQuery.trim()) return;

        setIsSubmitting(true);
        try {
            const newConversation = await fetchFromApi(`/api/projects/conversations/${projectId}`, {
                method: "POST",
                body: JSON.stringify({ title: "New Conversation" }),
            });
            localStorage.setItem(`pending-query-${newConversation.id}`, newQuery);
            // Carry the @-mention scope (project chat is papers-only) to the new
            // conversation so it's applied to the first message.
            if (mentionSelection.paperIds.length > 0) {
                localStorage.setItem(
                    `pending-mentions-${newConversation.id}`,
                    JSON.stringify(mentionSelection.paperIds),
                );
            }
            router.push(`/projects/${projectId}/conversations/${newConversation.id}`);
        } catch (err) {
            setError("Failed to create a new conversation. Please try again.");
            console.error(err);
            setIsSubmitting(false);
        }
    };

    const isInitialLoading = isProjectLoading ||
        ((isPapersLoading || isConversationsLoading) && !papers.length && !conversations.length);

    if (isInitialLoading) {
        return (
            <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center space-y-4 px-4">
                <Skeleton className="mx-auto h-7 w-2/3" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="mx-auto h-4 w-40" />
            </div>
        );
    }

    if (projectError || error) {
        return <div className="p-4 text-red-500">{projectError?.message || error}</div>;
    }

    if (!project) {
        return <div className="p-4">Project not found.</div>;
    }

    const isEmpty = papers.length === 0 && conversations.length === 0;

    if (isEmpty) {
        return (
            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-12 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 p-4 dark:bg-blue-900/30">
                        <BookOpen className="h-8 w-8 text-blue-500" />
                    </div>
                    <h2 className="mb-2 text-2xl font-bold">Get Started with Your Project</h2>
                    <p className="mb-8 text-muted-foreground">Add research papers to your project, then ask questions and generate insights.</p>

                    {!isViewer && (
                        <div className="mb-8 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
                            <button
                                onClick={() => setAddPapersOpen(true)}
                                className="group flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors hover:bg-accent"
                            >
                                <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground transition-colors group-hover:text-blue-500" />
                                <h3 className="font-semibold transition-colors group-hover:text-blue-600">Upload Papers</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Upload PDFs from your computer</p>
                            </button>
                            <button
                                onClick={() => setAddPapersOpen(true)}
                                className="group flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors hover:bg-accent"
                            >
                                <Library className="mb-3 h-10 w-10 text-muted-foreground transition-colors group-hover:text-blue-500" />
                                <h3 className="font-semibold transition-colors group-hover:text-blue-600">Add from Library</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Choose from your existing papers</p>
                            </button>
                        </div>
                    )}

                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600 dark:bg-blue-900/30">1</span>
                            Add papers
                        </div>
                        <ArrowRight className="h-3 w-3" />
                        <div className="flex items-center gap-1.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">2</span>
                            Ask questions
                        </div>
                        <ArrowRight className="h-3 w-3" />
                        <div className="flex items-center gap-1.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">3</span>
                            Generate insights
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {/* min-h-full (not h-full) so tall content grows instead of clipping under justify-center */}
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-8">
                {!isViewer && papers.length > 0 ? (
                    <>
                        <div className="mb-6 text-center">
                            <AnimatedGradientText
                                className="text-2xl font-bold"
                                colorFrom="#6366f1"
                                colorTo="#3b82f6"
                            >
                                What would you like to discover in your project?
                            </AnimatedGradientText>
                            {/* Description shown as context only — editing lives in the header */}
                            {project.description && (
                                <p className="mt-2 text-sm text-muted-foreground">{project.description}</p>
                            )}
                        </div>
                        <MentionInput
                            value={newQuery}
                            onValueChange={setNewQuery}
                            onSubmit={handleNewQuery}
                            papers={papers}
                            papersOnly
                            selection={mentionSelection}
                            onSelectionChange={setMentionSelection}
                            placeholder={chatDisabled ? "Nice! You have used your chat credits for the week. Upgrade your plan to use more." : "Ask a question about your papers, analyze findings, or explore new ideas..."}
                            disabled={chatDisabled || isSubmitting}
                            sendDisabled={!newQuery.trim()}
                            busy={isSubmitting}
                            autoFocus
                        />
                        <p className="mt-3 text-center text-xs text-muted-foreground">
                            {papers.length} paper{papers.length === 1 ? "" : "s"} in context · pick up past chats from the sidebar
                        </p>
                    </>
                ) : !isViewer ? (
                    <div className="rounded-xl border-2 border-dashed bg-muted/30 p-8 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted p-3">
                            <MessageCircle className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="mb-1 text-sm font-semibold">Ready to Start Conversations</h3>
                        <p className="text-sm text-muted-foreground">Add papers to your project to begin discussing and analyzing them.</p>
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddPapersOpen(true)}>
                            Add papers
                        </Button>
                    </div>
                ) : (
                    <div className="text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 p-4 dark:bg-blue-900/30">
                            <MessageCircle className="h-8 w-8 text-blue-400" />
                        </div>
                        <h3 className="mb-2 text-lg font-medium">{project.title}</h3>
                        {project.description && (
                            <p className="mx-auto mb-3 max-w-md text-sm text-muted-foreground">{project.description}</p>
                        )}
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            You have view access — browse papers and pick up chats from the sidebar.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
