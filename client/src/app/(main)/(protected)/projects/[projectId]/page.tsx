"use client";

import { ArrowRight, BookOpen, Library, MessageCircle, Pencil, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fetchFromApi } from "@/lib/api";
import { ProjectRole } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
        refetchProject,
        papers,
        isPapersLoading,
        conversations,
        isConversationsLoading,
        setAddPapersOpen,
        setChatScopeHandler,
    } = useProjectWorkspace();

    const [error, setError] = useState<string | null>(null);
    const [newQuery, setNewQuery] = useState("");
    const [mentionSelection, setMentionSelection] = useState<MentionSelection>(EMPTY_MENTION_SELECTION);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showEditAlert, setShowEditAlert] = useState(false);
    const [currentTitle, setCurrentTitle] = useState("");
    const [currentDescription, setCurrentDescription] = useState("");
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

    // Let the reader panel @-scope the new-chat composer to the open paper.
    useEffect(() => {
        setChatScopeHandler((paper) => {
            setMentionSelection((prev) =>
                prev.paperIds.includes(paper.id)
                    ? prev
                    : { ...prev, paperIds: [...prev.paperIds, paper.id] },
            );
        });
        return () => setChatScopeHandler(null);
    }, [setChatScopeHandler]);

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

    const handleUpdateProject = async () => {
        if (!project) return;
        try {
            const response = await fetchFromApi(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: currentTitle,
                    description: currentDescription,
                }),
            });
            if (response) {
                refetchProject();
                setShowEditAlert(false);
            } else {
                console.error('Failed to update project');
            }
        } catch (error) {
            console.error('An error occurred while updating the project:', error);
        }
    };

    const handleEditClick = () => {
        if (!project) return;
        setCurrentTitle(project.title);
        setCurrentDescription(project.description || '');
        setShowEditAlert(true);
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
                                What would you like to discover in your papers?
                            </AnimatedGradientText>
                            {/* Compact description — the title lives in the breadcrumb */}
                            <div className="group mt-2">
                                {project.description ? (
                                    <p className="text-sm text-muted-foreground">
                                        {project.description}
                                        <button
                                            onClick={handleEditClick}
                                            className="ml-2 inline-flex align-middle opacity-0 transition-opacity group-hover:opacity-100"
                                            aria-label="Edit project"
                                        >
                                            <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                        </button>
                                    </p>
                                ) : (
                                    <button
                                        className="cursor-pointer border-none bg-transparent p-0 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                                        onClick={handleEditClick}
                                    >
                                        Add a description...
                                    </button>
                                )}
                            </div>
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

            <AlertDialog open={showEditAlert} onOpenChange={setShowEditAlert}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Edit Project</AlertDialogTitle>
                        <AlertDialogDescription>
                            Update the title and description for your project.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="title" className="text-right">
                                Title
                            </Label>
                            <Input
                                id="title"
                                value={currentTitle}
                                onChange={(e) => setCurrentTitle(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="description" className="text-right">
                                Description
                            </Label>
                            <Textarea
                                id="description"
                                value={currentDescription}
                                onChange={(e) => setCurrentDescription(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUpdateProject}>Save</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
