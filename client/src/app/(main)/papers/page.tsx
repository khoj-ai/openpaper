"use client"

import { fetchFromApi } from "@/lib/api";
import { useEffect, useState } from "react";
import { PaperItem } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { useAuth } from "@/lib/auth";
import { useSubscription, getStorageUsagePercentage, isStorageNearLimit, isStorageAtLimit, formatFileSize, getPaperUploadPercentage, isPaperUploadNearLimit, isPaperUploadAtLimit, isProjectAtLimit } from "@/hooks/useSubscription";
import { FileText, Upload, AlertTriangle, BookOpen, Highlighter, Quote, FolderKanban } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { LibraryTable } from "@/components/LibraryTable";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { useRouter } from "next/navigation";
import { UploadModal } from "@/components/UploadModal";
import { usePapers } from "@/hooks/usePapers";

const PageSkeleton = () => (
    <div className="w-full mx-auto p-4">
        {/* Header skeleton */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
            <Skeleton className="h-9 w-32 mb-2 md:mb-0" />
            <div className="flex items-center gap-x-4">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-32" />
            </div>
        </div>
        {/* Search/filter bar skeleton */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
            <Skeleton className="h-10 w-full md:max-w-xl" />
            <Skeleton className="h-10 w-24" />
        </div>
        {/* Table skeleton */}
        <div className="border bg-card rounded-md overflow-hidden">
            {/* Table header */}
            <div className="border-b-2 bg-card p-4">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-32 hidden md:block" />
                    <Skeleton className="h-4 w-32 hidden lg:block" />
                    <Skeleton className="h-4 w-24 hidden lg:block" />
                    <Skeleton className="h-4 w-20 hidden xl:block" />
                    <Skeleton className="h-4 w-20 hidden xl:block" />
                    <Skeleton className="h-4 w-20 hidden xl:block" />
                </div>
            </div>
            {/* Table rows */}
            {Array.from({ length: 8 }).map((_, index) => (
                <div
                    key={index}
                    className={`p-4 border-b ${index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}
                >
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-4 w-4 flex-shrink-0" />
                        <div className="flex-1 min-w-0 space-y-2">
                            <Skeleton className="h-4 w-full max-w-md" />
                            <Skeleton className="h-3 w-3/4 max-w-sm md:hidden" />
                        </div>
                        <Skeleton className="h-4 w-32 hidden md:block flex-shrink-0" />
                        <Skeleton className="h-4 w-32 hidden lg:block flex-shrink-0" />
                        <div className="hidden lg:flex gap-1 flex-shrink-0">
                            <Skeleton className="h-6 w-16 rounded-sm" />
                            <Skeleton className="h-6 w-14 rounded-sm" />
                        </div>
                        <div className="hidden xl:flex gap-1 flex-shrink-0">
                            <Skeleton className="h-6 w-14 rounded-sm" />
                        </div>
                        <Skeleton className="h-4 w-20 hidden xl:block flex-shrink-0" />
                        <Skeleton className="h-4 w-20 hidden xl:block flex-shrink-0" />
                    </div>
                </div>
            ))}
        </div>
    </div>
);

function PapersPageContent() {
    const { papers, isLoading, mutate } = usePapers();
    const [filteredPapers, setFilteredPapers] = useState<PaperItem[]>([]);
    const { subscription, loading: subscriptionLoading } = useSubscription();
    const router = useRouter();
    const [isCreateProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
    const [isProjectLimitDialogOpen, setProjectLimitDialogOpen] = useState(false);
    const [papersForNewProject, setPapersForNewProject] = useState<PaperItem[]>([]);
    const [isUploadModalOpen, setUploadModalOpen] = useState(false);

    useEffect(() => {
        if (papers) {
            const sortedPapers = [...papers].sort((a, b) => {
                return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
            });
            setFilteredPapers(sortedPapers);
        }
    }, [papers]);

    const deletePaper = async (paperId: string) => {
        try {
            await fetchFromApi(`/api/paper?id=${paperId}`, {
                method: "DELETE",
            });
            setFilteredPapers(filteredPapers.filter((paper) => paper.id !== paperId));
            toast.success("Paper deleted successfully");
        } catch (error) {
            if (error instanceof Error && error.message) {
                toast.error(error.message);
                throw error;
            }
            toast.error("Failed to remove this paper.");
            throw error;
        }
    }

    const handleTableAction = (papers: PaperItem[], action: string) => {
        if (action !== "Make Project") return;

        if (isProjectAtLimit(subscription)) {
            setProjectLimitDialogOpen(true);
            return;
        }

        if (papers.length === 0) {
            toast.info("Please select at least one paper to create a project.");
            return;
        }
        setPapersForNewProject(papers);
        setCreateProjectDialogOpen(true);
    };

    const handleCreateProjectSubmit = async (title: string, description: string) => {
        const paperIds = papersForNewProject.map(p => p.id);

        try {
            const project = await fetchFromApi("/api/projects", {
                method: "POST",
                body: JSON.stringify({ title, description }),
            });
            toast.success("Project created successfully!");

            if (paperIds.length > 0) {
                await fetchFromApi(`/api/projects/papers/${project.id}`, {
                    method: 'POST',
                    body: JSON.stringify({ paper_ids: paperIds })
                });
                toast.success("Papers added to project successfully!");
            }

            router.push(`/projects/${project.id}`);
        } catch (error) {
            console.error("Failed to create project", error);
            toast.error("Failed to create project.");
        } finally {
            setCreateProjectDialogOpen(false);
            setPapersForNewProject([]);
        }
    };

    const UsageDisplay = () => {
        const [showAlert, setShowAlert] = useState(true);

        if (subscriptionLoading) {
            return <Skeleton className="h-20 w-full mb-6" />;
        }

        if (!subscription) {
            return null;
        }

        const storageUsagePercentage = getStorageUsagePercentage(subscription);
        const paperUploadUsagePercentage = getPaperUploadPercentage(subscription);

        const atStorageLimit = isStorageAtLimit(subscription);
        const nearStorageLimit = isStorageNearLimit(subscription);
        const atPaperUploadLimit = isPaperUploadAtLimit(subscription);
        const nearPaperUploadLimit = isPaperUploadNearLimit(subscription);

        const shouldShowAlert = atStorageLimit || nearStorageLimit || atPaperUploadLimit || nearPaperUploadLimit;

        if (!shouldShowAlert || !showAlert) {
            return null;
        }

        const atLimit = atStorageLimit || atPaperUploadLimit;
        const title = atLimit ? "You've reached a limit" : "Approaching a limit";
        const description = atLimit
            ? "You have reached one of your usage limits. Please upgrade your plan to continue full access."
            : "You are approaching one of your usage limits. Consider upgrading soon to avoid any interruptions.";

        return (
            <Alert variant={'default'} className="mb-4">
                <div className="flex justify-between items-start">
                    <div className="flex items-start">
                        <AlertTriangle className="h-4 w-4 mt-1" />
                        <div className="ml-2">
                            <AlertTitle className={atLimit ? "text-destructive" : "text-blue-500"}>{title}</AlertTitle>
                            <AlertDescription className="text-muted-foreground">
                                {description}
                            </AlertDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-x-2">
                        <Button asChild size="sm">
                            <Link href="/pricing">Upgrade</Link>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowAlert(false)} className="self-start">
                            Dismiss
                        </Button>
                    </div>
                </div>
                <div className="mt-4 space-y-4">
                    {(nearStorageLimit || atStorageLimit) && (
                        <div>
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Storage: {formatFileSize(subscription.usage.knowledge_base_size)} used</span>
                                <span>{formatFileSize(subscription.limits.knowledge_base_size)} total</span>
                            </div>
                            <Progress value={storageUsagePercentage} className="h-2 mt-1" />
                        </div>
                    )}
                    {(nearPaperUploadLimit || atPaperUploadLimit) && (
                        <div>
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Papers: {subscription.usage.paper_uploads} used</span>
                                <span>{subscription.limits.paper_uploads} total</span>
                            </div>
                            <Progress value={paperUploadUsagePercentage} className="h-2 mt-1" />
                        </div>
                    )}
                </div>
            </Alert>
        );
    };

    const EmptyState = () => {
        // No papers uploaded at all
        if (papers && papers.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center max-w-2xl mx-auto">
                    {/* Icon with decorative background */}
                    <div className="relative mb-8">
                        <div className="relative w-28 h-28 mx-auto">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-primary/5 to-transparent rounded-full blur-2xl" />
                            <div className="relative w-full h-full bg-gradient-to-br from-blue-500/5 to-primary/10 dark:from-blue-500/10 dark:to-primary/20 rounded-2xl flex items-center justify-center border border-blue-500/10 shadow-sm">
                                <BookOpen className="w-12 h-12 text-primary" strokeWidth={1.5} />
                            </div>
                            <div className="absolute -top-1 -right-1 w-10 h-10 bg-background dark:bg-card rounded-xl flex items-center justify-center border border-blue-500/20 shadow-md">
                                <FileText className="w-5 h-5 text-blue-500" strokeWidth={2} />
                            </div>
                        </div>
                    </div>

                    <h3 className="text-2xl font-bold text-foreground mb-3">Build Your Research Library</h3>
                    <p className="text-muted-foreground max-w-md mb-8">
                        Your library grows as you upload papers, giving you one central place to store all your research,
                        annotations, and highlights. Build your knowledge base and generate citations effortlessly.
                    </p>

                    <Button
                        size="lg"
                        className="bg-primary hover:bg-primary/90"
                        onClick={() => setUploadModalOpen(true)}
                    >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload your first paper
                    </Button>

                    {/* Feature highlights */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-12 w-full max-w-lg">
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10 text-blue-500 mb-2">
                                <Highlighter className="h-5 w-5" />
                            </div>
                            <p className="text-sm font-medium">Annotations</p>
                            <p className="text-xs text-muted-foreground">Highlight & take notes</p>
                        </div>
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary mb-2">
                                <FolderKanban className="h-5 w-5" />
                            </div>
                            <p className="text-sm font-medium">Projects</p>
                            <p className="text-xs text-muted-foreground">Organize by topic</p>
                        </div>
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-500/10 text-green-500 mb-2">
                                <Quote className="h-5 w-5" />
                            </div>
                            <p className="text-sm font-medium">Citations</p>
                            <p className="text-xs text-muted-foreground">Export in any format</p>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }

    if (isLoading || subscriptionLoading) {
        return <PageSkeleton />;
    }

    return (
        <div className="w-full mx-auto p-4 flex flex-col flex-1 min-w-0" style={{ height: 'calc(100vh - 5rem)' }}>
            <AlertDialog open={isProjectLimitDialogOpen} onOpenChange={setProjectLimitDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>You&apos;re on a roll!</AlertDialogTitle>
                        <AlertDialogDescription>
                            You&apos;ve created a lot of great projects. To create more, please upgrade your plan.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Link href="/pricing">
                            <AlertDialogAction>Upgrade</AlertDialogAction>
                        </Link>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <CreateProjectDialog
                open={isCreateProjectDialogOpen}
                onOpenChange={setCreateProjectDialogOpen}
                onSubmit={handleCreateProjectSubmit}
            />
            <UploadModal open={isUploadModalOpen} onOpenChange={setUploadModalOpen} onUploadComplete={() => { mutate(); }} />
            <UsageDisplay />
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 flex-shrink-0">
                <h1 className="text-3xl font-bold tracking-tight">Library</h1>
                <div className="flex items-center gap-x-4 mt-2 md:mt-0">
                    <Button onClick={() => setUploadModalOpen(true)}>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload
                    </Button>
                </div>
            </div>
            <div className="flex-1 min-h-0">
                {papers && papers.length === 0 ? (
                    <EmptyState />
                ) : (
                    <LibraryTable
                        handleDelete={deletePaper}
                        selectable={true}
                        actionOptions={["Make Project"]}
                        onSelectFiles={handleTableAction}
                        onUploadClick={() => setUploadModalOpen(true)}
                    />
                )}
            </div>
        </div>
    )
}

export default function PapersPage() {
    const { user, loading: authLoading } = useAuth();

    useEffect(() => {
        if (!authLoading && !user) {
            localStorage.setItem('returnTo', window.location.pathname);
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

    if (authLoading || !user) {
        return <PageSkeleton />;
    }

    return <PapersPageContent />
}
