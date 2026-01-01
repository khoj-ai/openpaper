"use client"

import { Suspense, useState, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, ArrowLeft, ArrowRight, ChevronUp, ChevronDown, ChevronRight, SquareLibrary, ExternalLink, Loader2, User, History } from "lucide-react";
import { fetchFromApi } from "@/lib/api";
import { OpenAlexPaper, OpenAlexMatchResponse, OpenAlexResponse } from "@/lib/schema";

type ViewMode = "paper" | "author";

interface AuthorInfo {
    id: string;
    name: string;
}

interface NavigationEntry {
    mode: ViewMode;
    data: OpenAlexMatchResponse | OpenAlexResponse;
    doi?: string;
    author?: AuthorInfo;
}

function CitationGraphContent() {
    const searchParams = useSearchParams();

    const [doiInput, setDoiInput] = useState("");
    const [graphData, setGraphData] = useState<OpenAlexMatchResponse | null>(null);
    const [authorData, setAuthorData] = useState<OpenAlexResponse | null>(null);
    const [currentAuthor, setCurrentAuthor] = useState<AuthorInfo | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("paper");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"cited_by" | "cites">("cited_by");
    const [navigationHistory, setNavigationHistory] = useState<NavigationEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [initializedFromUrl, setInitializedFromUrl] = useState(false);
    const [historyExpanded, setHistoryExpanded] = useState(false);

    // Initialize from URL params (only once on mount)
    useEffect(() => {
        if (initializedFromUrl) return;

        const urlDoi = searchParams.get('doi');
        const urlAuthorId = searchParams.get('author');
        const urlAuthorName = searchParams.get('authorName');

        if (urlDoi) {
            setDoiInput(urlDoi);
            setInitializedFromUrl(true);
            fetchCitationGraph(urlDoi, true);
        } else if (urlAuthorId) {
            setInitializedFromUrl(true);
            fetchAuthorWorks(urlAuthorId, urlAuthorName || "Author", true);
        }
    }, [searchParams, initializedFromUrl]);

    const updateUrl = useCallback((params: { doi?: string; author?: string; authorName?: string }, replace = false) => {
        const urlParams = new URLSearchParams();
        if (params.doi) urlParams.set('doi', params.doi);
        if (params.author) urlParams.set('author', params.author);
        if (params.authorName) urlParams.set('authorName', params.authorName);
        const queryString = urlParams.toString();
        const newUrl = queryString ? `/graph?${queryString}` : '/graph';
        if (replace) {
            window.history.replaceState({}, '', newUrl);
        } else {
            window.history.pushState({}, '', newUrl);
        }
    }, []);

    const fetchCitationGraph = async (doi: string, addToHistory = true) => {
        if (!doi.trim()) return;

        setLoading(true);
        setError(null);
        setViewMode("paper");
        setAuthorData(null);
        setCurrentAuthor(null);

        try {
            const response: OpenAlexMatchResponse = await fetchFromApi(
                `/api/search/global/match?doi=${encodeURIComponent(doi)}`,
                { method: "POST" }
            );

            setGraphData(response);
            updateUrl({ doi });

            if (addToHistory) {
                const entry: NavigationEntry = { mode: "paper", data: response, doi };
                const newHistory = [...navigationHistory.slice(0, historyIndex + 1), entry];
                setNavigationHistory(newHistory);
                setHistoryIndex(newHistory.length - 1);
            }
        } catch (err) {
            console.error("Failed to fetch citation graph:", err);
            setError("Could not find paper. Please check the DOI and try again.");
        } finally {
            setLoading(false);
        }
    };

    const fetchAuthorWorks = async (authorId: string, authorName: string, addToHistory = true) => {
        setLoading(true);
        setError(null);
        setViewMode("author");
        setGraphData(null);

        try {
            const response: OpenAlexResponse = await fetchFromApi(
                `/api/search/global/author?author_id=${encodeURIComponent(authorId)}`
            );

            setAuthorData(response);
            setCurrentAuthor({ id: authorId, name: authorName });
            updateUrl({ author: authorId, authorName });

            if (addToHistory) {
                const entry: NavigationEntry = { mode: "author", data: response, author: { id: authorId, name: authorName } };
                const newHistory = [...navigationHistory.slice(0, historyIndex + 1), entry];
                setNavigationHistory(newHistory);
                setHistoryIndex(newHistory.length - 1);
            }
        } catch (err) {
            console.error("Failed to fetch author works:", err);
            setError("Could not find author works. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (doiInput.trim()) {
            fetchCitationGraph(doiInput.trim());
        }
    };

    const goBack = () => {
        if (historyIndex > 0) {
            const prevIndex = historyIndex - 1;
            const prevEntry = navigationHistory[prevIndex];
            setHistoryIndex(prevIndex);

            if (prevEntry.mode === "paper") {
                const data = prevEntry.data as OpenAlexMatchResponse;
                setGraphData(data);
                setAuthorData(null);
                setCurrentAuthor(null);
                setViewMode("paper");
                if (prevEntry.doi) {
                    setDoiInput(prevEntry.doi);
                    updateUrl({ doi: prevEntry.doi }, true);
                }
            } else {
                const data = prevEntry.data as OpenAlexResponse;
                setAuthorData(data);
                setGraphData(null);
                setCurrentAuthor(prevEntry.author || null);
                setViewMode("author");
                if (prevEntry.author) {
                    updateUrl({ author: prevEntry.author.id, authorName: prevEntry.author.name }, true);
                }
            }
        }
    };

    const goForward = () => {
        if (historyIndex < navigationHistory.length - 1) {
            const nextIndex = historyIndex + 1;
            const nextEntry = navigationHistory[nextIndex];
            setHistoryIndex(nextIndex);

            if (nextEntry.mode === "paper") {
                const data = nextEntry.data as OpenAlexMatchResponse;
                setGraphData(data);
                setAuthorData(null);
                setCurrentAuthor(null);
                setViewMode("paper");
                if (nextEntry.doi) {
                    setDoiInput(nextEntry.doi);
                    updateUrl({ doi: nextEntry.doi }, true);
                }
            } else {
                const data = nextEntry.data as OpenAlexResponse;
                setAuthorData(data);
                setGraphData(null);
                setCurrentAuthor(nextEntry.author || null);
                setViewMode("author");
                if (nextEntry.author) {
                    updateUrl({ author: nextEntry.author.id, authorName: nextEntry.author.name }, true);
                }
            }
        }
    };

    const navigateToPaper = (paper: OpenAlexPaper) => {
        if (paper.doi) {
            setDoiInput(paper.doi);
            fetchCitationGraph(paper.doi);
        }
    };

    const navigateToAuthor = (authorId: string, authorName: string, e: React.MouseEvent) => {
        e.stopPropagation();
        fetchAuthorWorks(authorId, authorName);
    };

    const navigateToHistoryEntry = (index: number) => {
        if (index < 0 || index >= navigationHistory.length || index === historyIndex) return;

        const entry = navigationHistory[index];
        setHistoryIndex(index);

        if (entry.mode === "paper") {
            const data = entry.data as OpenAlexMatchResponse;
            setGraphData(data);
            setAuthorData(null);
            setCurrentAuthor(null);
            setViewMode("paper");
            if (entry.doi) {
                setDoiInput(entry.doi);
                updateUrl({ doi: entry.doi }, true);
            }
        } else {
            const data = entry.data as OpenAlexResponse;
            setAuthorData(data);
            setGraphData(null);
            setCurrentAuthor(entry.author || null);
            setViewMode("author");
            if (entry.author) {
                updateUrl({ author: entry.author.id, authorName: entry.author.name }, true);
            }
        }
    };

    const papersToShow = activeTab === "cited_by"
        ? graphData?.cited_by.results || []
        : graphData?.cites.results || [];

    const citedByCount = graphData?.cited_by.meta.count || 0;
    const citesCount = graphData?.cites.meta.count || 0;

    const hasData = graphData || authorData;

    return (
        <div className="w-full min-h-[calc(100vh-64px)]">
            {/* Header */}
            <header className="bg-background border-b px-4 py-4 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto space-y-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="flex items-center gap-2 text-primary">
                            <SquareLibrary className="h-5 w-5" />
                            <span className="text-lg font-semibold">Citation Graph</span>
                        </div>

                        {/* Search Form */}
                        <form onSubmit={handleSubmit} className="flex-1 w-full sm:max-w-lg">
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        type="text"
                                        value={doiInput}
                                        onChange={(e) => setDoiInput(e.target.value)}
                                        placeholder="Enter DOI (e.g., 10.1145/3442188.3445922)"
                                        className="pl-9"
                                    />
                                </div>
                                <Button type="submit" disabled={loading}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                                </Button>
                            </div>
                        </form>
                    </div>

                    {/* Navigation History */}
                    {navigationHistory.length > 0 && (
                        <Collapsible open={historyExpanded} onOpenChange={setHistoryExpanded}>
                            <div className="flex items-center gap-2">
                                <CollapsibleTrigger asChild>
                                    <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <History className="h-4 w-4" />
                                        <span>History ({historyIndex + 1} / {navigationHistory.length})</span>
                                        <ChevronRight className={`h-4 w-4 transition-transform ${historyExpanded ? "rotate-90" : ""}`} />
                                    </button>
                                </CollapsibleTrigger>
                                <div className="flex gap-1 ml-auto">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={goBack}
                                        disabled={historyIndex <= 0}
                                        className="h-7 w-7 p-0"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={goForward}
                                        disabled={historyIndex >= navigationHistory.length - 1}
                                        className="h-7 w-7 p-0"
                                    >
                                        <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                            <CollapsibleContent className="mt-2">
                                <div className="flex flex-wrap items-center gap-1 text-sm">
                                    {navigationHistory.map((entry, i) => {
                                        const label = entry.mode === "paper"
                                            ? (entry.data as OpenAlexMatchResponse).center.title
                                            : entry.author?.name || "Author";
                                        const truncatedLabel = label && label.length > 40
                                            ? label.slice(0, 40) + "..."
                                            : label;
                                        const isActive = i === historyIndex;

                                        return (
                                            <span key={i} className="flex items-center">
                                                {i > 0 && <ChevronRight className="h-3 w-3 mx-1 text-muted-foreground" />}
                                                <button
                                                    onClick={() => navigateToHistoryEntry(i)}
                                                    className={`px-2 py-1 rounded-md transition-colors ${isActive
                                                            ? "bg-primary text-primary-foreground"
                                                            : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                                                        } ${entry.mode === "author" ? "italic" : ""}`}
                                                >
                                                    {entry.mode === "author" && <User className="h-3 w-3 inline mr-1" />}
                                                    {truncatedLabel}
                                                </button>
                                            </span>
                                        );
                                    })}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-4">
                {/* Loading State */}
                {loading && (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-muted-foreground">Fetching data...</span>
                    </div>
                )}

                {/* Error State */}
                {error && !loading && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive mb-6">
                        {error}
                    </div>
                )}

                {/* Empty State */}
                {!hasData && !loading && !error && (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                            <SquareLibrary className="h-8 w-8 text-primary" />
                        </div>
                        <h2 className="text-xl font-semibold mb-2">Explore Citation Graphs</h2>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                            Enter a DOI to explore a paper&apos;s citations and references. Click on any paper to navigate through the citation graph, or click an author to see their works.
                        </p>
                        <Button
                            onClick={() => {
                                setDoiInput("10.1145/3442188.3445922");
                                fetchCitationGraph("10.1145/3442188.3445922");
                            }}
                        >
                            Try example paper
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                )}

                {/* Author View */}
                {viewMode === "author" && authorData && currentAuthor && !loading && (
                    <div className="space-y-6">
                        {/* Author Header */}
                        <div className="bg-card border rounded-xl p-6">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                                    <User className="h-6 w-6 text-blue-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h1 className="text-xl font-semibold mb-2 leading-tight">
                                        {currentAuthor.name}
                                    </h1>
                                    <p className="text-sm text-muted-foreground">
                                        {authorData.meta.count.toLocaleString()} works found
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Author Works List */}
                        <div className="bg-card border rounded-xl overflow-hidden">
                            {authorData.results.length === 0 ? (
                                <div className="p-12 text-center text-muted-foreground">
                                    No works found for this author
                                </div>
                            ) : (
                                authorData.results.map((paper, index) => (
                                    <div
                                        key={paper.id}
                                        onClick={() => navigateToPaper(paper)}
                                        className={`p-4 flex items-center gap-4 cursor-pointer hover:bg-accent/50 transition-colors ${index < authorData.results.length - 1 ? "border-b" : ""
                                            }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-medium mb-1 leading-tight">
                                                {paper.title}
                                            </h3>
                                            <p className="text-sm text-muted-foreground mb-2 truncate">
                                                {paper.authorships?.map(a => a.author?.display_name).filter(Boolean).join(", ")}
                                            </p>
                                            <div className="flex gap-3 text-xs text-muted-foreground">
                                                {paper.primary_location?.source?.display_name && (
                                                    <span>{paper.primary_location.source.display_name}</span>
                                                )}
                                                {paper.publication_year && (
                                                    <span>{paper.publication_year}</span>
                                                )}
                                                {paper.cited_by_count !== undefined && (
                                                    <span>{paper.cited_by_count.toLocaleString()} citations</span>
                                                )}
                                            </div>
                                        </div>
                                        {paper.doi && (
                                            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Paper Display */}
                {viewMode === "paper" && graphData && !loading && (
                    <div className="space-y-6">
                        {/* Current Paper Card */}
                        <div className="bg-card border rounded-xl p-6">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                                    <SquareLibrary className="h-6 w-6 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h1 className="text-xl font-semibold mb-2 leading-tight">
                                        {graphData.center.title}
                                    </h1>
                                    <div className="flex flex-wrap gap-1 mb-3">
                                        {graphData.center.authorships?.map((authorship, i) => (
                                            <span key={authorship.author?.id || i}>
                                                {authorship.author?.id ? (
                                                    <button
                                                        onClick={(e) => navigateToAuthor(
                                                            authorship.author!.id!,
                                                            authorship.author!.display_name || "Author",
                                                            e
                                                        )}
                                                        className="text-sm text-blue-500 hover:underline"
                                                    >
                                                        {authorship.author?.display_name}
                                                    </button>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">
                                                        {authorship.author?.display_name}
                                                    </span>
                                                )}
                                                {i < (graphData.center.authorships?.length || 0) - 1 && (
                                                    <span className="text-muted-foreground">, </span>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                                        {graphData.center.primary_location?.source?.display_name && (
                                            <span className="bg-secondary px-2 py-1 rounded">
                                                {graphData.center.primary_location.source.display_name} {graphData.center.publication_year}
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1">
                                            <ChevronUp className="h-4 w-4" />
                                            {graphData.center.cited_by_count?.toLocaleString() || 0} citations
                                        </span>
                                        {graphData.center.doi && (
                                            <a
                                                href={`https://doi.org/${graphData.center.doi}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-blue-500 hover:underline"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                DOI
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-1 bg-secondary p-1 rounded-lg w-fit">
                            <button
                                onClick={() => setActiveTab("cited_by")}
                                className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === "cited_by"
                                        ? "bg-background shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                <ChevronUp className="h-4 w-4" />
                                Cited by ({citedByCount.toLocaleString()})
                            </button>
                            <button
                                onClick={() => setActiveTab("cites")}
                                className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === "cites"
                                        ? "bg-background shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                <ChevronDown className="h-4 w-4" />
                                References ({citesCount.toLocaleString()})
                            </button>
                        </div>

                        {/* Papers List */}
                        <div className="bg-card border rounded-xl overflow-hidden">
                            {papersToShow.length === 0 ? (
                                <div className="p-12 text-center text-muted-foreground">
                                    No {activeTab === "cited_by" ? "citations" : "references"} found
                                </div>
                            ) : (
                                papersToShow.map((paper, index) => (
                                    <div
                                        key={paper.id}
                                        onClick={() => navigateToPaper(paper)}
                                        className={`p-4 flex items-center gap-4 cursor-pointer hover:bg-accent/50 transition-colors ${index < papersToShow.length - 1 ? "border-b" : ""
                                            }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-medium mb-1 leading-tight">
                                                {paper.title}
                                            </h3>
                                            <p className="text-sm text-muted-foreground mb-2 truncate">
                                                {paper.authorships?.map(a => a.author?.display_name).filter(Boolean).join(", ")}
                                            </p>
                                            <div className="flex gap-3 text-xs text-muted-foreground">
                                                {paper.primary_location?.source?.display_name && (
                                                    <span>{paper.primary_location.source.display_name}</span>
                                                )}
                                                {paper.publication_year && (
                                                    <span>{paper.publication_year}</span>
                                                )}
                                                {paper.cited_by_count !== undefined && (
                                                    <span>{paper.cited_by_count.toLocaleString()} citations</span>
                                                )}
                                            </div>
                                        </div>
                                        {paper.doi && (
                                            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        )}
                                    </div>
                                ))
                            )}
                        </div>

                    </div>
                )}
            </main>
        </div>
    );
}

export default function CitationGraphPage() {
    return (
        <Suspense fallback={<div className="w-full px-4 py-6">Loading...</div>}>
            <CitationGraphContent />
        </Suspense>
    );
}
