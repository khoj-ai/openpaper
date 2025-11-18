"use client";

import type { PaperItem, PaperResult, SearchResults } from "@/lib/schema";
import type { Filter, Sort } from "@/components/PaperFiltering";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PaperCard from "@/components/PaperCard";
import PaperSearchResultCard from "@/components/PaperSearchResultCard";
import { PaperFiltering } from "@/components/PaperFiltering";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { JSX, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface LibraryGridProps {
    papers: PaperItem[];
    filteredPapers: PaperItem[];
    searchResults: SearchResults | null;
    searchTerm: string;
    searching: boolean;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    handleSearch: (event: React.ChangeEvent<HTMLInputElement>) => void;
    setFilters: (filters: Filter[]) => void;
    setSort: (sort: Sort) => void;
    filters: Filter[];
    sort: Sort;
    deletePaper: (paperId: string) => Promise<void>;
    handlePaperSet: (paperId: string, paper: PaperItem) => void;
    SearchStatsDisplay: () => JSX.Element | null;
    EmptyState: () => JSX.Element | null;
}

export function LibraryGrid({
    papers,
    filteredPapers,
    searchResults,
    searchTerm,
    searching,
    searchInputRef,
    handleSearch,
    setFilters,
    setSort,
    filters,
    sort,
    deletePaper,
    handlePaperSet,
    SearchStatsDisplay,
    EmptyState,
}: LibraryGridProps) {
    const gridContainerRef = useRef<HTMLDivElement>(null);

    // Determine which data to use
    const isSearchMode = searchResults && searchTerm.trim();
    const displayItems = isSearchMode ? searchResults.papers : filteredPapers;

    // Virtualization for grid items
    const rowVirtualizer = useVirtualizer({
        count: displayItems.length,
        getScrollElement: () => gridContainerRef.current,
        estimateSize: () => 200, // Estimated card height in pixels
        overscan: 5,
    });

    return (
        <>
            {papers.length > 0 && (
                <div>
                    <div className="flex flex-col sm:flex-row gap-2 mb-6">
                        <div className="relative flex-grow">
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
                        <PaperFiltering
                            papers={papers}
                            onFilterChange={setFilters}
                            onSortChange={setSort}
                            filters={filters}
                            sort={sort}
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 mb-6">
                        {filters.map(filter => (
                            <Badge key={`${filter.type}-${filter.value}`} variant="secondary" className="flex items-center gap-1">
                                {filter.value}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0"
                                    onClick={() => setFilters(filters.filter(f => f.value !== filter.value))}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </Badge>
                        ))}
                    </div>
                </div>
            )}

            <SearchStatsDisplay />

            {displayItems.length > 0 ? (
                <div
                    ref={gridContainerRef}
                    className="overflow-y-auto"
                    style={{ height: 'calc(100vh - 16rem)' }}
                >
                    <div
                        style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const item = displayItems[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    {isSearchMode ? (
                                        <PaperSearchResultCard
                                            paper={item as PaperResult}
                                            searchTerm={searchTerm}
                                            handleDelete={deletePaper}
                                            setPaper={handlePaperSet}
                                        />
                                    ) : (
                                        <PaperCard
                                            paper={item as PaperItem}
                                            handleDelete={deletePaper}
                                            setPaper={handlePaperSet}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <EmptyState />
            )}
        </>
    );
}
