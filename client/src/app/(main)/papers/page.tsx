"use client"

import { fetchFromApi } from "@/lib/api";
import { useEffect, useState, useCallback, useRef } from "react";
import { PaperItem, SearchResults, PaperResult } from "@/lib/schema";
import { PaperStatus } from "@/components/utils/PdfStatus";
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
import { FileText, Upload, Search, AlertTriangle, AlertCircle, HardDrive, X, ArrowDown, Grid, List } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Filter, Sort } from "@/components/PaperFiltering";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LibraryTable } from "@/components/LibraryTable";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { useRouter } from "next/navigation";
import { LibraryGrid } from "@/components/LibraryGrid";

// TODO: We could add a search look-up for the paper journal name to avoid placeholders

export default function PapersPage() {
    const [papers, setPapers] = useState<PaperItem[]>([]);
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [filteredPapers, setFilteredPapers] = useState<PaperItem[]>([]);
    const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [searching, setSearching] = useState<boolean>(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
    const { user, loading: authLoading } = useAuth();
    const { subscription, loading: subscriptionLoading } = useSubscription();
    const [filters, setFilters] = useState<Filter[]>([]);
    const [sort, setSort] = useState<Sort>({ type: "publish_date", order: "desc" });
    const [viewMode, setViewMode] = useState("table");
    const router = useRouter();
    const [isCreateProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
    const [isProjectLimitDialogOpen, setProjectLimitDialogOpen] = useState(false);
    const [papersForNewProject, setPapersForNewProject] = useState<PaperItem[]>([]);
    const SHOW_STORAGE_USAGE_THRESHOLD = 60; // Show storage usage alert if usage is above 60%

    useEffect(() => {
        const savedViewMode = localStorage.getItem("papersViewMode");
        if (savedViewMode) {
            setViewMode(savedViewMode);
        }
    }, []);

    useEffect(() => {
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all")
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setPapers(sortedPapers)
                setFilteredPapers(sortedPapers)
            } catch (error) {
                console.error("Error fetching papers:", error)
            } finally {
                setLoading(false);
            }
        }

        fetchPapers();
    }, [])

    useEffect(() => {
        // Cleanup timeout on unmount
        return () => {
            if (searchTimeout) {
                clearTimeout(searchTimeout)
            }
        }
    }, [searchTimeout])

    useEffect(() => {
        if (!authLoading && !user) {
            // Redirect to login if user is not authenticated
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

    // Restore focus to search input after search results update
    useEffect(() => {
        if (searchTerm.trim() && searchInputRef.current && !searching) {
            // Use requestAnimationFrame to ensure DOM has been updated
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [searchResults, filteredPapers, searching, searchTerm]);

    useEffect(() => {
        let papersToFilter = papers;

        // Apply filters
        if (filters.length > 0) {
            papersToFilter = papersToFilter.filter(paper => {
                return filters.every(filter => {
                    if (filter.type === "author") {
                        return paper.authors?.includes(filter.value);
                    }
                    if (filter.type === "keyword") {
                        return paper.keywords?.includes(filter.value);
                    }
                    if (filter.type === "status") {
                        return paper.status === filter.value;
                    }
                    return true;
                });
            });
        }

        // Apply sorting
        papersToFilter.sort((a, b) => {
            const aDate = a.publish_date ? new Date(a.publish_date) : null;
            const bDate = b.publish_date ? new Date(b.publish_date) : null;

            if (aDate && bDate) {
                return sort.order === "desc" ? aDate.getTime() - bDate.getTime() : bDate.getTime() - aDate.getTime();
            } else if (aDate) {
                return -1;
            } else if (bDate) {
                return 1;
            } else {
                return 0;
            }
        });

        setFilteredPapers(papersToFilter);
    }, [filters, sort, papers]);

    const deletePaper = async (paperId: string) => {
        try {
            await fetchFromApi(`/api/paper?id=${paperId}`, {
                method: "DELETE",
            })
            setPapers(papers.filter((paper) => paper.id !== paperId));
            setFilteredPapers(filteredPapers.filter((paper) => paper.id !== paperId));
            setSearchResults((prevResults) => {
                if (!prevResults) return null;
                const removedHighlights = prevResults.papers.find(p => p.id === paperId)?.highlights?.length || 0;
                const removedAnnotations = prevResults.papers.find(p => p.id === paperId)?.annotations?.length || 0;
                return {
                    ...prevResults,
                    papers: prevResults.papers.filter((paper) => paper.id !== paperId),
                    total_papers: prevResults.total_papers - 1,
                    total_highlights: prevResults.total_highlights - removedHighlights,
                    total_annotations: prevResults.total_annotations - removedAnnotations
                }
            })
            toast.success("Paper deleted successfully");
        } catch (error) {
            console.error("Error deleting paper:", error)
            toast.error("Failed to remove this paper. Make sure it's not part of a project.");
            // TODO Could also try to handle this by re-fetching papers
        }
    }

    const handleMakeProject = (papers: PaperItem[], action: string) => {
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

    const performSearch = useCallback(async (term: string) => {
        if (!term.trim()) {
            setFilteredPapers(papers)
            setSearchResults(null)
            setFilters([])
            return
        }

        setSearching(true)
        try {
            let url = `/api/search/local?q=${encodeURIComponent(term)}`;
            if (filteredPapers.length > 0) {
                const paperIds = filteredPapers.map(p => p.id).join(',');
                url += `&papers_filter=${paperIds}`;
            }
            const response: SearchResults = await fetchFromApi(url);

            // Store the complete search results
            setSearchResults(response);

            // Convert PaperResult to PaperItem format for compatibility with existing UI
            let searchResultsPapers = response.papers.map((paper: PaperResult): PaperItem => ({
                id: paper.id,
                title: paper.title || "Untitled", // PaperItem expects non-nullable title
                authors: paper.authors || undefined,
                abstract: paper.abstract || undefined,
                status: paper.status as PaperStatus || undefined,
                created_at: paper.created_at,
                // Add any other fields that PaperItem expects
                keywords: [], // API doesn't return keywords, so default to empty
                institutions: [], // API doesn't return institutions, so default to empty
                summary: paper.abstract || undefined // Use abstract as summary fallback
            }))

            // Apply explicit filters to search results
            if (filters.length > 0) {
                searchResultsPapers = searchResultsPapers.filter(paper => {
                    return filters.every(filter => {
                        if (filter.type === "author") {
                            return paper.authors?.includes(filter.value);
                        }
                        if (filter.type === "keyword") {
                            return paper.keywords?.includes(filter.value);
                        }
                        if (filter.type === "status") {
                            return paper.status === filter.value;
                        }
                        return true;
                    });
                });
            }

            setFilteredPapers(searchResultsPapers)
        } catch (error) {
            console.log("Error performing search:", error);
            setSearchResults(null)
            // Fall back to client-side search if API fails
            setFilteredPapers(
                papers.filter((paper) =>
                    paper.title?.toLowerCase().includes(term.toLowerCase()) ||
                    paper.keywords?.some((keyword) => keyword.toLowerCase().includes(term.toLowerCase())) ||
                    paper.abstract?.toLowerCase().includes(term.toLowerCase()) ||
                    paper.authors?.some((author) => author.toLowerCase().includes(term.toLowerCase())) ||
                    paper.institutions?.some((institution) => institution.toLowerCase().includes(term.toLowerCase())) ||
                    paper.summary?.toLowerCase().includes(term.toLowerCase())
                )
            )
        } finally {
            setSearching(false)
        }
    }, [papers, filteredPapers, filters])

    const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
        const term = event.target.value
        setSearchTerm(term)

        // Clear existing timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout)
        }

        // Debounce search by 300ms
        const timeout = setTimeout(() => {
            performSearch(term)
        }, 300)

        setSearchTimeout(timeout)
    }

    const handlePaperSet = (paperId: string, paper: PaperItem) => {
        setPapers((prevPapers) =>
            prevPapers.map((p) => (p.id === paperId ? { ...p, ...paper } : p))
        )
        setFilteredPapers((prevFiltered) =>
            prevFiltered.map((p) => (p.id === paperId ? { ...p, ...paper } : p))
        )
    }

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
                                <Link href="/pricing" className="font-semibold underline ml-2 text-primary">
                                    View Plans
                                </Link>
                            </AlertDescription>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowAlert(false)} className="self-start">
                        Dismiss
                    </Button>
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

    const SearchStatsDisplay = () => {
        if (!searchResults || !searchTerm.trim()) {
            return null;
        }

        const filteredOutCount = searchResults.total_papers - filteredPapers.length;

        return (
            <div className="mb-4 p-3 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                        <strong>{searchResults.total_papers}</strong> papers found
                    </span>
                    {searchResults.total_highlights > 0 && (
                        <span>
                            <strong>{searchResults.total_highlights}</strong> highlights
                        </span>
                    )}
                    {searchResults.total_annotations > 0 && (
                        <span>
                            <strong>{searchResults.total_annotations}</strong> annotations
                        </span>
                    )}
                </div>
                {filters.length > 0 && filteredOutCount > 0 && (
                    <div className="text-sm text-muted-foreground mt-2">
                        <strong>{filteredOutCount}</strong> papers filtered out
                    </div>
                )}
            </div>
        );
    };

    const EmptyState = () => {
        // No papers uploaded at all
        if (papers.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-16 w-16 text-muted-foreground mb-6" />
                    <h3 className="text-xl font-medium text-foreground mb-3">Your paper library is empty</h3>
                    <p className="text-muted-foreground max-w-md mb-6">
                        Upload your first research paper to get started. All your papers will appear here for easy access and organization.
                    </p>
                    <Link href="/">
                        <Button className="inline-flex items-center gap-2">
                            <Upload className="h-4 w-4" />
                            Upload papers
                        </Button>
                    </Link>
                </div>
            );
        }

        // Has papers but search/filter returned no results
        if (papers.length > 0 && filteredPapers.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Search className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No papers found</h3>
                    <p className="text-muted-foreground max-w-md">
                        No papers match your search criteria. Try adjusting your search terms.
                    </p>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setSearchTerm("")
                            setFilteredPapers(papers);
                            setSearchResults(null);
                            if (searchTimeout) {
                                clearTimeout(searchTimeout)
                            }
                        }}
                        className="mt-4"
                    >
                        Clear search
                    </Button>
                </div>
            );
        }

        return null;
    }

    if (loading) {
        return (
            <div className="w-full max-w-6xl mx-auto p-4">
                <Skeleton className="h-10 w-full mb-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-24 w-full" />
                    ))}
                </div>
            </div>
        )
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
            <UsageDisplay />
            <Tabs value={viewMode} onValueChange={setViewMode} className="w-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-3xl font-bold tracking-tight">Library</h1>
                    <TabsList>
                        <TabsTrigger value="table" onClick={() => localStorage.setItem('papersViewMode', 'table')}>
                            <List className="h-4 w-4 mr-2" />
                            Table
                        </TabsTrigger>
                        <TabsTrigger value="card" onClick={() => localStorage.setItem('papersViewMode', 'card')}>
                            <Grid className="h-4 w-4 mr-2" />
                            Card
                        </TabsTrigger>
                    </TabsList>
                </div>
                <TabsContent value="card">
                    <LibraryGrid
                        papers={papers}
                        filteredPapers={filteredPapers}
                        searchResults={searchResults}
                        searchTerm={searchTerm}
                        searching={searching}
                        searchInputRef={searchInputRef}
                        handleSearch={handleSearch}
                        setFilters={setFilters}
                        setSort={setSort}
                        filters={filters}
                        sort={sort}
                        deletePaper={deletePaper}
                        handlePaperSet={handlePaperSet}
                        SearchStatsDisplay={SearchStatsDisplay}
                        EmptyState={EmptyState}
                    />
                </TabsContent>
                <TabsContent value="table" className="flex-grow">
                    <LibraryTable
                        setPapers={setPapers}
                        handleDelete={deletePaper}
                        selectable={true}
                        actionOptions={["Make Project"]}
                        onSelectFiles={handleMakeProject}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
