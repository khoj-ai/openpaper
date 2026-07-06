"use client";

import { ArrowRight, BookOpen, Library, MessageCircle, Pencil, Search, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import ConversationCard from "@/components/ConversationCard";
import { ConversationListSkeleton } from "@/components/ConversationListSkeleton";
import { isChatCreditAtLimit, useSubscription } from "@/hooks/useSubscription";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

const CONVERSATIONS_SHOWN = 5;

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
        refetchConversations,
        setAddPapersOpen,
        hasCollaborators,
    } = useProjectWorkspace();

    const [error, setError] = useState<string | null>(null);
    const [newQuery, setNewQuery] = useState("");
    const [mentionSelection, setMentionSelection] = useState<MentionSelection>(EMPTY_MENTION_SELECTION);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showEditAlert, setShowEditAlert] = useState(false);
    const [currentTitle, setCurrentTitle] = useState("");
    const [currentDescription, setCurrentDescription] = useState("");
    const [conversationSearchQuery, setConversationSearchQuery] = useState("");
    const { subscription } = useSubscription();

    const chatDisabled = isChatCreditAtLimit(subscription);
    const isViewer = project?.role === ProjectRole.Viewer;

    const filteredConversations = useMemo(() => {
        if (!conversationSearchQuery.trim()) return conversations;
        const q = conversationSearchQuery.toLowerCase();
        return conversations.filter(c => c.title?.toLowerCase().includes(q));
    }, [conversations, conversationSearchQuery]);

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

    const handleDeleteConversation = async (conversationId: string) => {
        try {
            await fetchFromApi(`/api/conversation/${conversationId}`, {
                method: "DELETE",
            });
            refetchConversations();
        } catch (err) {
            setError("Failed to delete conversation. Please try again.");
            console.error(err);
        }
    };

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
            <div className="mx-auto w-full max-w-3xl space-y-6 overflow-y-auto px-4 py-6">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-5 w-24" />
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                    ))}
                </div>
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
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
                {/* Compact description — the title lives in the breadcrumb */}
                <div className="group mb-5">
                    {project.description ? (
                        <p className="text-sm text-muted-foreground">
                            {project.description}
                            {!isViewer && (
                                <button
                                    onClick={handleEditClick}
                                    className="ml-2 inline-flex align-middle opacity-0 transition-opacity group-hover:opacity-100"
                                    aria-label="Edit project"
                                >
                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                </button>
                            )}
                        </p>
                    ) : !isViewer ? (
                        <button
                            className="cursor-pointer border-none bg-transparent p-0 text-left text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                            onClick={handleEditClick}
                        >
                            Add a description...
                        </button>
                    ) : null}
                </div>

                {/* Composer */}
                {!isViewer && (
                    papers.length > 0 ? (
                        <div className="mb-8">
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
                        </div>
                    ) : (
                        <div className="mb-8 rounded-xl border-2 border-dashed bg-muted/30 p-6 text-center">
                            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted p-3">
                                <MessageCircle className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <h3 className="mb-1 text-sm font-semibold">Ready to Start Conversations</h3>
                            <p className="text-sm text-muted-foreground">Add papers to your project to begin discussing and analyzing them.</p>
                            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddPapersOpen(true)}>
                                Add papers
                            </Button>
                        </div>
                    )
                )}

                {/* Chats */}
                <div>
                    {isConversationsLoading ? (
                        <>
                            <h2 className="mb-3 text-lg font-semibold">Chats</h2>
                            <ConversationListSkeleton count={3} />
                        </>
                    ) : conversations.length > 0 ? (
                        <>
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-lg font-semibold">Chats</h2>
                                {conversations.length > 3 && (
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            placeholder="Search chats..."
                                            value={conversationSearchQuery}
                                            onChange={(e) => setConversationSearchQuery(e.target.value)}
                                            className="h-8 w-48 pl-9"
                                        />
                                    </div>
                                )}
                            </div>
                            {conversationSearchQuery.trim() ? (
                                filteredConversations.length > 0 ? (
                                    filteredConversations.map((convo) => (
                                        <ConversationCard
                                            key={convo.id}
                                            convo={convo}
                                            showAvatar={hasCollaborators}
                                            href={`/projects/${projectId}/conversations/${convo.id}`}
                                            onDelete={handleDeleteConversation} />
                                    ))
                                ) : (
                                    <div className="py-8 text-center text-muted-foreground">
                                        <Search className="mx-auto mb-2 h-8 w-8 opacity-50" />
                                        <p className="text-sm">No chats matching &ldquo;{conversationSearchQuery}&rdquo;</p>
                                    </div>
                                )
                            ) : (
                                <>
                                    {conversations.slice(0, CONVERSATIONS_SHOWN).map((convo) => (
                                        <ConversationCard
                                            key={convo.id}
                                            convo={convo}
                                            showAvatar={hasCollaborators}
                                            href={`/projects/${projectId}/conversations/${convo.id}`}
                                            onDelete={handleDeleteConversation} />
                                    ))}
                                    {conversations.length > CONVERSATIONS_SHOWN && (
                                        <div className="mt-2 text-left">
                                            <Link href={`/projects/${projectId}/past`} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                                                View {conversations.length - CONVERSATIONS_SHOWN} more
                                                <ArrowRight className="ml-1 inline-block h-4 w-4" />
                                            </Link>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    ) : (
                        <div className="rounded-xl p-8 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 p-4 dark:bg-blue-900/30">
                                <MessageCircle className="h-8 w-8 text-blue-400" />
                            </div>
                            <h3 className="mb-2 text-lg font-medium">
                                {papers.length > 0
                                    ? "Start a conversation"
                                    : "Add papers to start"}
                            </h3>
                            <p className="mx-auto max-w-md text-sm text-muted-foreground">
                                {papers.length > 0
                                    ? "Ask a question about your papers to analyze findings, compare methodologies, or explore connections."
                                    : "Add papers to your project to begin exploring and discussing them."
                                }
                            </p>
                        </div>
                    )}
                </div>
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
