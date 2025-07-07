"use client"

import { fetchFromApi } from "@/lib/api";
import { useEffect, useState, useCallback, useRef } from "react";
import { PaperItem } from "@/components/AppSidebar";
import { PaperStatus } from "@/components/utils/PdfStatus";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PaperCard from "@/components/PaperCard";
import PaperSearchResultCard from "@/components/PaperSearchResultCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/lib/auth";
import { useSubscription, getStorageUsagePercentage, isStorageNearLimit, isStorageAtLimit, formatFileSize } from "@/hooks/useSubscription";
import { FileText, Upload, Search, AlertTriangle, AlertCircle, HardDrive } from "lucide-react";
import Link from "next/link";
import { SearchResults, PaperResult } from "@/lib/schema";
import { toast } from "sonner";

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
            toast.error("Failed to delete paper. Please try again.");
            // TODO Could also try to handle this by re-fetching papers
        }
    }

    const performSearch = useCallback(async (term: string) => {
        if (!term.trim()) {
            setFilteredPapers(papers)
            setSearchResults(null)
            return
        }

        setSearching(true)
        try {
            const response: SearchResults = await fetchFromApi(`/api/search/local?q=${encodeURIComponent(term)}`);

            // Store the complete search results
            setSearchResults(response);

            // Convert PaperResult to PaperItem format for compatibility with existing UI
            const searchResultsPapers = response.papers.map((paper: PaperResult): PaperItem => ({
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
    }, [papers])

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

    const getUsagePercentage = () => {
        return getStorageUsagePercentage(subscription);
    };

    const getUsageAlert = () => {
        if (isStorageAtLimit(subscription)) {
            return "error";
        } else if (isStorageNearLimit(subscription)) {
            return "warning";
        }
        return null;
    };

    const StorageUsageDisplay = () => {
        if (subscriptionLoading) {
            return <Skeleton className="h-20 w-full mb-6" />;
        }

        if (!subscription) {
            return null;
        }

        const usagePercentage = getUsagePercentage();
        const alertType = getUsageAlert();

        return (
            <div className="mb-6 p-4 border rounded-lg bg-card">
                <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Storage Usage</span>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>{formatFileSize(subscription.usage.knowledge_base_size)} used</span>
                        <span>{formatFileSize(subscription.limits.knowledge_base_size)} total</span>
                    </div>

                    <Progress
                        value={usagePercentage}
                        className="h-2"
                    />

                    {alertType && (
                        <Alert variant={alertType === "error" ? "destructive" : "default"} className="mt-3">
                            <div className="flex items-center gap-2">
                                {alertType === "error" ? (
                                    <AlertCircle className="h-4 w-4" />
                                ) : (
                                    <AlertTriangle className="h-4 w-4" />
                                )}
                                <AlertDescription>
                                    {alertType === "error"
                                        ? "You've reached your storage limit. Please delete some papers to upload new ones."
                                        : "You're approaching your storage limit. Consider reviewing your papers."
                                    }
                                </AlertDescription>
                            </div>
                        </Alert>
                    )}
                </div>
            </div>
        );
    };

    const SearchStatsDisplay = () => {
        if (!searchResults || !searchTerm.trim()) {
            return null;
        }

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
            <div className="container mx-auto sm:w-2/3 p-8">
                <Skeleton className="h-10 w-full mb-4" />
                <div className="grid grid-cols-1 gap-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-24 w-full" />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto sm:w-2/3 p-8">
            <StorageUsageDisplay />

            {papers.length > 0 && (
                <div className="mb-6 relative">
                    <Input
                        type="text"
                        placeholder="Search your paper bank (including annotations and highlights)"
                        value={searchTerm}
                        ref={searchInputRef}
                        onChange={handleSearch}
                        className="w-full"
                        disabled={searching}
                    />
                    {searching && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                        </div>
                    )}
                </div>
            )}

            <SearchStatsDisplay />

            {filteredPapers.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                    {searchResults && searchTerm.trim() ? (
                        // Use PaperSearchResultCard for search results
                        searchResults.papers.map((paper) => (
                            <PaperSearchResultCard
                                key={paper.id}
                                paper={paper}
                                searchTerm={searchTerm}
                                handleDelete={deletePaper}
                                setPaper={handlePaperSet}
                            />
                        ))
                    ) : (
                        // Use regular PaperCard for normal view
                        filteredPapers.map((paper) => (
                            <PaperCard
                                key={paper.id}
                                paper={paper}
                                handleDelete={deletePaper}
                                setPaper={handlePaperSet}
                            />
                        ))
                    )}
                </div>
            ) : (
                <EmptyState />
            )}
        </div>
    )
}
