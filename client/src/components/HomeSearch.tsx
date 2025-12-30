"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, FolderKanban, Command, Loader2, Highlighter, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchFromApi } from "@/lib/api";
import { PaperResult, SearchResults } from "@/lib/schema";
import { useProjects } from "@/hooks/useProjects";

// Helper to check if text contains search term
const textMatchesSearch = (text: string | null | undefined, searchTerm: string): boolean => {
    if (!text) return false;
    return text.toLowerCase().includes(searchTerm.toLowerCase());
};

// Helper to highlight search terms in text
const highlightSearchTerm = (text: string, searchTerm: string): React.ReactNode => {
    if (!searchTerm || !text) return text;
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, index) =>
        regex.test(part) ? (
            <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
                {part}
            </mark>
        ) : part
    );
};

// Represents a selectable item in the search results
type SelectableItem =
    | { type: "project"; id: string }
    | { type: "paper"; id: string }
    | { type: "ask" };

export function HomeSearch() {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [papers, setPapers] = useState<PaperResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [expandedPaperId, setExpandedPaperId] = useState<string | null>(null);
    const { projects: allProjects } = useProjects();
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const router = useRouter();

    // Filter projects client-side based on query
    const filteredProjects = useMemo(() => {
        if (!query.trim()) return [];
        const lowerQuery = query.toLowerCase();
        return allProjects
            .filter((p) =>
                p.title.toLowerCase().includes(lowerQuery) ||
                p.description?.toLowerCase().includes(lowerQuery)
            )
            .slice(0, 3);
    }, [allProjects, query]);

    // Build a flat list of selectable items for keyboard navigation
    const selectableItems = useMemo((): SelectableItem[] => {
        const items: SelectableItem[] = [];
        filteredProjects.forEach((p) => items.push({ type: "project", id: p.id }));
        papers.forEach((p) => items.push({ type: "paper", id: p.id }));
        // Always include "Ask knowledge base" option when there's a query
        if (query.trim()) {
            items.push({ type: "ask" });
        }
        return items;
    }, [filteredProjects, papers, query]);

    const hasResults = papers.length > 0 || filteredProjects.length > 0;

    // Reset selected index when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [selectableItems.length]);

    // Scroll selected item into view
    useEffect(() => {
        if (resultsRef.current && selectedIndex >= 0) {
            const selectedElement = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
            selectedElement?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    // Keyboard shortcut (Cmd+K) and arrow navigation
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
        // Cancel any pending request when query changes
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        if (!query.trim()) {
            setPapers([]);
            setHasSearched(false);
            setIsLoading(false);
            return;
        }

        // Reset hasSearched when query changes (user is typing)
        setHasSearched(false);
        setIsLoading(true);

        const timeout = setTimeout(async () => {
            // Create a new AbortController for this request
            const controller = new AbortController();
            abortControllerRef.current = controller;

            try {
                // Search papers
                const searchResponse: SearchResults = await fetchFromApi(
                    `/api/search/local?q=${encodeURIComponent(query)}&limit=5`,
                    { signal: controller.signal }
                );

                // Check if this request was aborted
                if (controller.signal.aborted) return;

                // Keep full PaperResult to access highlights and annotations
                setPapers(searchResponse?.papers || []);
                setExpandedPaperId(null);
                setHasSearched(true);
                setIsLoading(false);
            } catch (error) {
                // Ignore abort errors
                if (error instanceof Error && error.name === 'AbortError') {
                    return;
                }
                console.error("Search error:", error);
                setHasSearched(true);
                setIsLoading(false);
            }
        }, 300);

        return () => {
            clearTimeout(timeout);
            // Also abort any in-flight request on cleanup
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        };
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

    const handleAskKnowledgeBase = useCallback(() => {
        setIsOpen(false);
        router.push(`/understand?q=${encodeURIComponent(query)}`);
        setQuery("");
    }, [router, query]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen || selectableItems.length === 0) return;

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setSelectedIndex((prev) =>
                    prev < selectableItems.length - 1 ? prev + 1 : 0
                );
                break;
            case "ArrowUp":
                e.preventDefault();
                setSelectedIndex((prev) =>
                    prev > 0 ? prev - 1 : selectableItems.length - 1
                );
                break;
            case "Enter":
                e.preventDefault();
                const selected = selectableItems[selectedIndex];
                if (selected) {
                    if (selected.type === "ask") {
                        handleAskKnowledgeBase();
                    } else {
                        handleSelect(selected.type, selected.id);
                    }
                }
                break;
        }
    }, [isOpen, selectableItems, selectedIndex, handleSelect, handleAskKnowledgeBase]);

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
                    onKeyDown={handleKeyDown}
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
                        <div ref={resultsRef} className="max-h-[400px] overflow-y-auto">
                            {filteredProjects.length > 0 && (
                                <div className="p-2">
                                    <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                        Projects
                                    </p>
                                    {filteredProjects.map((project, idx) => (
                                        <button
                                            key={project.id}
                                            data-index={idx}
                                            onClick={() => handleSelect("project", project.id)}
                                            onMouseEnter={() => setSelectedIndex(idx)}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${selectedIndex === idx ? "bg-accent" : "hover:bg-accent"}`}
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
                            {papers.length > 0 && (
                                <div className="p-2 border-t">
                                    <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                        Papers
                                    </p>
                                    {papers.map((paper, idx) => {
                                        const itemIndex = filteredProjects.length + idx;
                                        // Find matching highlights
                                        const matchingHighlights = paper.highlights?.filter(h =>
                                            textMatchesSearch(h.raw_text, query)
                                        ) || [];
                                        const hasMatches = matchingHighlights.length > 0;
                                        const isExpanded = expandedPaperId === paper.id;

                                        return (
                                            <div key={paper.id} className="mb-1">
                                                <button
                                                    data-index={itemIndex}
                                                    onClick={() => handleSelect("paper", paper.id)}
                                                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${selectedIndex === itemIndex ? "bg-accent" : "hover:bg-accent"}`}
                                                >
                                                    <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-medium truncate">{paper.title || "Untitled Paper"}</p>
                                                        {paper.authors && paper.authors.length > 0 && (
                                                            <p className="text-sm text-muted-foreground truncate">
                                                                {paper.authors.slice(0, 2).join(", ")}
                                                                {paper.authors.length > 2 && " et al."}
                                                            </p>
                                                        )}
                                                        {/* Match indicator */}
                                                        {hasMatches && (
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                                                                    <Search className="h-3 w-3" />
                                                                    <span>{matchingHighlights.length} highlight{matchingHighlights.length !== 1 ? 's' : ''}</span>
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Expand/collapse button for matches */}
                                                    {hasMatches && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setExpandedPaperId(isExpanded ? null : paper.id);
                                                            }}
                                                            className="p-1 hover:bg-accent rounded"
                                                        >
                                                            {isExpanded ? (
                                                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                                            ) : (
                                                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                            )}
                                                        </button>
                                                    )}
                                                </button>

                                                {/* Expanded matching highlights */}
                                                {hasMatches && isExpanded && (
                                                    <div className="ml-10 mr-3 mb-2 space-y-2">
                                                        {matchingHighlights.slice(0, 3).map((highlight) => (
                                                            <div
                                                                key={highlight.id}
                                                                className="p-2 text-sm border-l-2 border-yellow-400 bg-yellow-50/50 dark:bg-yellow-950/20 rounded-r"
                                                            >
                                                                <div className="flex items-start gap-2">
                                                                    <Highlighter className="h-3 w-3 text-yellow-600 mt-0.5 flex-shrink-0" />
                                                                    <p className="line-clamp-2">
                                                                        {highlightSearchTerm(highlight.raw_text, query)}
                                                                    </p>
                                                                </div>
                                                                {highlight.page_number && (
                                                                    <p className="text-xs text-muted-foreground mt-1 ml-5">
                                                                        Page {highlight.page_number}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        ))}
                                                        {matchingHighlights.length > 3 && (
                                                            <p className="text-xs text-muted-foreground ml-5">
                                                                +{matchingHighlights.length - 3} more
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {/* Ask knowledge base option */}
                            <div className="p-2 border-t">
                                {(() => {
                                    const askIndex = filteredProjects.length + papers.length;
                                    return (
                                        <button
                                            data-index={askIndex}
                                            onClick={handleAskKnowledgeBase}
                                            onMouseEnter={() => setSelectedIndex(askIndex)}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${selectedIndex === askIndex ? "bg-accent" : "hover:bg-accent"}`}
                                        >
                                            <Search className="h-4 w-4 text-primary flex-shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium">Ask your knowledge base</p>
                                                <p className="text-sm text-muted-foreground truncate">
                                                    &quot;{query}&quot;
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })()}
                            </div>
                        </div>
                    ) : hasSearched ? (
                        <div className="py-6 px-4">
                            <p className="text-center text-muted-foreground mb-4">
                                No results found for &quot;{query}&quot;
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
                                        &quot;{query}&quot;
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
