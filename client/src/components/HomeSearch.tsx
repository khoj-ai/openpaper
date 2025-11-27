"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, FolderKanban, Command, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchFromApi } from "@/lib/api";
import { PaperItem, Project, SearchResults } from "@/lib/schema";

interface SearchResult {
    papers: PaperItem[];
    projects: Project[];
}

export function HomeSearch() {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [results, setResults] = useState<SearchResult>({ papers: [], projects: [] });
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    // Keyboard shortcut (Cmd+K)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                inputRef.current?.focus();
                setIsOpen(true);
            }
            if (e.key === "Escape") {
                setIsOpen(false);
                inputRef.current?.blur();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Debounced search
    useEffect(() => {
        if (!query.trim()) {
            setResults({ papers: [], projects: [] });
            setHasSearched(false);
            return;
        }

        // Reset hasSearched when query changes (user is typing)
        setHasSearched(false);
        setIsLoading(true);

        const timeout = setTimeout(async () => {
            try {
                // Search papers
                const searchResponse: SearchResults = await fetchFromApi(`/api/search/local?q=${encodeURIComponent(query)}&limit=5`);
                // PaperResult can be mapped to PaperItem (they share id, title, authors, etc.)
                const papers: PaperItem[] = (searchResponse?.papers || []).map((p) => ({
                    id: p.id,
                    title: p.title || "Untitled",
                    authors: p.authors || [],
                    abstract: p.abstract || undefined,
                    status: p.status as PaperItem["status"],
                    publish_date: p.publish_date || undefined,
                    created_at: p.created_at,
                    preview_url: p.preview_url || undefined,
                }));

                // Search projects (filter client-side for now)
                const projectsResponse = await fetchFromApi("/api/projects");
                const projects = (projectsResponse || [])
                    .filter((p: Project) =>
                        p.title.toLowerCase().includes(query.toLowerCase()) ||
                        p.description?.toLowerCase().includes(query.toLowerCase())
                    )
                    .slice(0, 3);

                setResults({ papers, projects });
                setHasSearched(true);
            } catch (error) {
                console.error("Search error:", error);
                setHasSearched(true);
            } finally {
                setIsLoading(false);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [query]);

    const handleSelect = useCallback((type: "paper" | "project", id: string) => {
        setIsOpen(false);
        setQuery("");
        if (type === "paper") {
            router.push(`/paper/${id}`);
        } else {
            router.push(`/project/${id}`);
        }
    }, [router]);

    const hasResults = results.papers.length > 0 || results.projects.length > 0;

    return (
        <div ref={containerRef} className="relative w-full max-w-2xl mx-auto px-4">
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
                <Input
                    ref={inputRef}
                    type="text"
                    placeholder="Search papers, projects, or ask a question..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setIsOpen(true)}
                    className="w-full h-12 pl-12 pr-16 text-base rounded-xl border border-input bg-background focus:border-primary/50 focus-visible:ring-0 transition-all"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground pointer-events-none">
                    <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded border bg-background px-2 font-mono text-xs">
                        <Command className="h-3 w-3" />K
                    </kbd>
                </div>
            </div>

            {/* Search Results Dropdown */}
            {isOpen && query.trim() && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-background border rounded-xl shadow-lg overflow-hidden z-50">
                    {isLoading ? (
                        <div className="flex items-center gap-2 px-4 py-3 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm">Searching...</span>
                        </div>
                    ) : hasResults ? (
                        <div className="max-h-[400px] overflow-y-auto">
                            {results.projects.length > 0 && (
                                <div className="p-2">
                                    <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                        Projects
                                    </p>
                                    {results.projects.map((project) => (
                                        <button
                                            key={project.id}
                                            onClick={() => handleSelect("project", project.id)}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent text-left transition-colors"
                                        >
                                            <FolderKanban className="h-4 w-4 text-primary flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="font-medium truncate">{project.title}</p>
                                                {project.description && (
                                                    <p className="text-sm text-muted-foreground truncate">
                                                        {project.description}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {results.papers.length > 0 && (
                                <div className="p-2 border-t">
                                    <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                        Papers
                                    </p>
                                    {results.papers.map((paper) => (
                                        <button
                                            key={paper.id}
                                            onClick={() => handleSelect("paper", paper.id)}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent text-left transition-colors"
                                        >
                                            <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="font-medium truncate">{paper.title || "Untitled Paper"}</p>
                                                {paper.authors && paper.authors.length > 0 && (
                                                    <p className="text-sm text-muted-foreground truncate">
                                                        {paper.authors.slice(0, 2).join(", ")}
                                                        {paper.authors.length > 2 && " et al."}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Ask knowledge base option */}
                            <div className="p-2 border-t">
                                <button
                                    onClick={() => {
                                        setIsOpen(false);
                                        router.push(`/understand?q=${encodeURIComponent(query)}`);
                                        setQuery("");
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent text-left transition-colors"
                                >
                                    <Search className="h-4 w-4 text-primary flex-shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium">Ask your knowledge base</p>
                                        <p className="text-sm text-muted-foreground truncate">
                                            "{query}"
                                        </p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    ) : hasSearched ? (
                        <div className="py-6 px-4">
                            <p className="text-center text-muted-foreground mb-4">
                                No results found for "{query}"
                            </p>
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    router.push(`/understand?q=${encodeURIComponent(query)}`);
                                    setQuery("");
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/5 hover:bg-primary/10 border border-primary/20 text-left transition-colors"
                            >
                                <Search className="h-5 w-5 text-primary flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-foreground">Ask your knowledge base</p>
                                    <p className="text-sm text-muted-foreground truncate">
                                        "{query}"
                                    </p>
                                </div>
                            </button>
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
