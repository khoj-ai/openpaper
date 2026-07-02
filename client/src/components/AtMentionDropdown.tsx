"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FileText, FolderKanban, Highlighter, Loader2 } from "lucide-react";
import { fetchFromApi } from "@/lib/api";
import { ScopeItem, MentionResult } from "@/lib/schema";

interface AtMentionDropdownProps {
    isOpen: boolean;
    searchTerm: string;
    anchorRect: DOMRect | null;
    onSelect: (item: ScopeItem) => void;
    onClose: () => void;
}

type SectionKey = "papers" | "projects" | "highlights" | "comments";

const SECTION_ICONS: Record<SectionKey, React.ReactNode> = {
    papers: <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />,
    projects: <FolderKanban className="h-4 w-4 text-primary flex-shrink-0" />,
    highlights: <Highlighter className="h-4 w-4 text-yellow-500 flex-shrink-0" />,
    comments: <Highlighter className="h-4 w-4 text-green-500 flex-shrink-0" />,
};

const SECTION_LABELS: Record<SectionKey, string> = {
    papers: "Papers",
    projects: "Projects",
    highlights: "Highlights",
    comments: "Comments",
};

export function AtMentionDropdown({
    isOpen,
    searchTerm,
    anchorRect,
    onSelect,
    onClose,
}: AtMentionDropdownProps) {
    const [results, setResults] = useState<MentionResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Build a flat list of all items with their section
    const flatItems = useCallback(() => {
        if (!results) return [] as { item: ScopeItem; section: SectionKey }[];
        const items: { item: ScopeItem; section: SectionKey }[] = [];
        for (const section of ["papers", "projects", "highlights", "comments"] as SectionKey[]) {
            for (const item of results[section] || []) {
                items.push({ item, section });
            }
        }
        return items;
    }, [results]);

    // Fetch results with debounce
    useEffect(() => {
        if (!isOpen || !searchTerm.trim()) {
            setResults(null);
            setError(null);
            return;
        }

        if (abortRef.current) {
            abortRef.current.abort();
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);
        setError(null);

        const timeout = setTimeout(async () => {
            try {
                const data: MentionResult = await fetchFromApi(
                    `/api/search/mentions?q=${encodeURIComponent(searchTerm)}&limit=5`,
                    { signal: controller.signal }
                );
                if (controller.signal.aborted) return;
                setResults(data);
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") return;
                setError("Could not load suggestions");
                setResults(null);
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }, 300);

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [isOpen, searchTerm]);

    // Reset selected index when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [results]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (!isOpen) return;
            const items = flatItems();
            if (items.length === 0) return;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (items[selectedIndex]) {
                        onSelect(items[selectedIndex].item);
                        onClose();
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    onClose();
                    break;
            }
        },
        [isOpen, flatItems, selectedIndex, onSelect, onClose]
    );

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    // Scroll selected item into view
    useEffect(() => {
        if (dropdownRef.current && selectedIndex >= 0) {
            const el = dropdownRef.current.querySelector(`[data-index="${selectedIndex}"]`);
            el?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    const items = flatItems();
    const hasItems = items.length > 0;
    const hasResults = results !== null;
    const isEmptySearch = hasResults && !hasItems && !isLoading;

    // Build sections for rendering (with section headers)
    const sections = (["papers", "projects", "highlights", "comments"] as SectionKey[])
        .filter((s) => (results?.[s]?.length ?? 0) > 0)
        .map((section) => ({
            section,
            items: (results?.[section] || []).map((item) => item),
        }));

    // Calculate position
    const style: React.CSSProperties = {};
    if (anchorRect) {
        style.position = "fixed";
        style.left = `${anchorRect.left}px`;
        style.top = `${anchorRect.bottom + 4}px`;
        style.width = `${Math.max(anchorRect.width, 320)}px`;
    }

    return (
        <div
            ref={dropdownRef}
            role="listbox"
            aria-label="Search results"
            style={style}
            className="z-50 bg-background border rounded-xl shadow-lg overflow-hidden max-h-[360px] flex flex-col"
            onMouseDown={(e) => e.preventDefault()}
        >
            {isLoading && (
                <div className="flex items-center gap-2 px-4 py-3 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Searching...</span>
                </div>
            )}

            {error && (
                <div className="px-4 py-3 text-sm text-red-500">
                    {error}
                </div>
            )}

            {isEmptySearch && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No results found for &ldquo;{searchTerm}&rdquo;
                </div>
            )}

            {hasItems && !isLoading && (
                <div className="overflow-y-auto">
                    {sections.map(({ section, items: sectionItems }) => (
                        <div key={section}>
                            <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30">
                                {SECTION_LABELS[section]}
                            </p>
                            {sectionItems.map((item, idx) => {
                                const globalIdx = items.findIndex(
                                    (fi) => fi.item.id === item.id && fi.section === section
                                );
                                return (
                                    <button
                                        key={`${section}-${item.id}`}
                                        data-index={globalIdx}
                                        role="option"
                                        aria-selected={selectedIndex === globalIdx}
                                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                                        onClick={() => {
                                            onSelect(item);
                                            onClose();
                                        }}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${selectedIndex === globalIdx ? "bg-accent" : "hover:bg-accent"
                                            }`}
                                    >
                                        {SECTION_ICONS[section]}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate">
                                                {item.label}
                                            </p>
                                            {item.subtitle && (
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {item.subtitle}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
