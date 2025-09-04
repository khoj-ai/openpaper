"use client";

import type { PaperItem, SearchResults } from "@/lib/schema";
import type { Filter, Sort } from "@/components/PaperFiltering";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PaperCard from "@/components/PaperCard";
import PaperSearchResultCard from "@/components/PaperSearchResultCard";
import { PaperFiltering } from "@/components/PaperFiltering";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { JSX } from "react";

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
        </>
    );
}
