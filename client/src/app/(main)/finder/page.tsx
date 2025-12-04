"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, X, User, Building2 } from "lucide-react";
import { fetchFromApi } from "@/lib/api";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import Link from "next/link";
import { getOpenAlexTypeAheadAuthors, getOpenAlexTypeAheadInstitutions, OpenAlexTypeAheadAuthor, OpenAlexTypeAheadInstitution } from "./utils";
import { OpenAlexResponse } from "@/lib/schema";
import PaperResultCard from "./PaperResultCard";
import { FinderIntro } from "./FinderIntro";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Filter, ChevronDown } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface SearchPaperRequest {
    authors?: string[];
    institutions?: string[];
    only_oa?: boolean;
}

export default function FinderPage() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<OpenAlexResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(25);
    const [totalResults, setTotalResults] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [authors, setAuthors] = useState<OpenAlexTypeAheadAuthor[]>([]);
    const [institutions, setInstitutions] = useState<OpenAlexTypeAheadInstitution[]>([]);
    const [onlyOpenAccess, setOnlyOpenAccess] = useState(false);

    // Autocomplete states
    const [authorSuggestions, setAuthorSuggestions] = useState<OpenAlexTypeAheadAuthor[]>([]);
    const [institutionSuggestions, setInstitutionSuggestions] = useState<OpenAlexTypeAheadInstitution[]>([]);
    const [loadingAutocomplete, setLoadingAutocomplete] = useState(false);
    const [filterQuery, setFilterQuery] = useState("");
    const filterInputRef = useRef<HTMLInputElement>(null);
    const filterButtonRef = useRef<HTMLButtonElement>(null);

    const inputRef = useRef<HTMLInputElement>(null);

    const removeAuthor = (authorId: string) => {
        setAuthors(prev => prev.filter(a => a.id !== authorId));
    };

    const removeInstitution = (institutionId: string) => {
        setInstitutions(prev => prev.filter(i => i.id !== institutionId));
    };

    const handleSearch = async (pageNumber = page) => {
        if (!query.trim()) return;

        setResults(null);
        setLoading(true);
        inputRef.current?.blur(); // Remove focus from input
        setError(null); // Clear any previous errors

        try {
            const filter: SearchPaperRequest = {
                authors: authors.map(author => author.id),
                institutions: institutions.map(institution => institution.id),
                only_oa: onlyOpenAccess,
            };

            const hasFilters = (filter.authors?.length ?? 0 > 0) || (filter.institutions?.length ?? 0 > 0) || filter.only_oa;

            const response: OpenAlexResponse = await fetchFromApi(
                `/api/search/global/search?query=${encodeURIComponent(query)}&page=${pageNumber}&per_page=${perPage}`,
                {
                    method: "POST",
                    ...(hasFilters && { body: JSON.stringify(filter) }),
                }
            );

            setResults(response);
            setTotalResults(response.meta.count);
            setPerPage(response.meta.per_page);
            setPage(pageNumber);
        } catch (error) {
            console.error("Search failed:", error);
            setError("Failed to fetch results. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    const totalPages = Math.ceil(totalResults / perPage);

    // Handle page change
    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return;
        handleSearch(newPage);
    }

    // Generate page numbers to display
    const getPageNumbers = () => {
        const pages = []
        const maxPagesToShow = 5

        if (totalPages <= maxPagesToShow) {
            // Show all pages if there are fewer than maxPagesToShow
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i)
            }
        } else {
            // Always show first page
            pages.push(1)

            // Calculate start and end of page range around current page
            let start = Math.max(2, page - 1)
            let end = Math.min(start + 2, totalPages - 1)

            // Adjust if we're close to the end
            if (end >= totalPages - 2) {
                end = totalPages - 1
                start = Math.max(2, end - 2)
            }

            // Add ellipsis if needed
            if (start > 2) {
                pages.push('ellipsis')
            }

            // Add middle pages
            for (let i = start; i <= end; i++) {
                pages.push(i)
            }

            // Add ellipsis if needed
            if (end < totalPages - 1) {
                pages.push('ellipsis')
            }

            // Always show last page
            pages.push(totalPages)
        }

        return pages
    }

    // Debounce filter autocomplete
    useEffect(() => {
        if (!filterQuery.trim()) {
            setAuthorSuggestions([]);
            setInstitutionSuggestions([]);
            return;
        }

        const timeoutId = setTimeout(async () => {
            if (filterQuery.trim().length >= 2) {
                setLoadingAutocomplete(true);
                try {
                    const [authorsData, institutionsData] = await Promise.all([
                        getOpenAlexTypeAheadAuthors(filterQuery.trim()),
                        getOpenAlexTypeAheadInstitutions(filterQuery.trim())
                    ]);

                    setAuthorSuggestions(authorsData);
                    setInstitutionSuggestions(institutionsData);
                } catch (error) {
                    console.error("Filter autocomplete failed:", error);
                } finally {
                    setLoadingAutocomplete(false);
                }
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [filterQuery]);

    const handleFilterAuthorSelect = (author: OpenAlexTypeAheadAuthor) => {
        if (!authors.find(a => a.id === author.id)) {
            setAuthors(prev => [...prev, author]);
        }
        setFilterQuery("");
        setAuthorSuggestions([]);
        setInstitutionSuggestions([]);
    };

    const handleFilterInstitutionSelect = (institution: OpenAlexTypeAheadInstitution) => {
        if (!institutions.find(i => i.id === institution.id)) {
            setInstitutions(prev => [...prev, institution]);
        }
        setFilterQuery("");
        setAuthorSuggestions([]);
        setInstitutionSuggestions([]);
    };

    const activeFilterCount = authors.length + institutions.length + (onlyOpenAccess ? 1 : 0);


    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="space-y-4">
                {/* Main search bar */}
                <div className="flex gap-4">
                    <div className="relative flex-1 max-w-2xl">
                        <Input
                            ref={inputRef}
                            placeholder="Search by topic, title, keywords..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        />
                    </div>

                    {/* Filter button */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="flex items-center gap-2" ref={filterButtonRef} >
                                <Filter className="h-4 w-4" />
                                Filters
                                {activeFilterCount > 0 && (
                                    <Badge variant="secondary" className="ml-1 px-1 py-0 text-xs">
                                        {activeFilterCount}
                                    </Badge>
                                )}
                                <ChevronDown className="h-3 w-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-96 p-4" align="end">
                            <div className="space-y-4">
                                <h3 className="font-medium text-sm">Search Filters</h3>

                                {/* Open Access Toggle */}
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="filter-open-access"
                                        checked={onlyOpenAccess}
                                        onCheckedChange={setOnlyOpenAccess}
                                    />
                                    <Label htmlFor="filter-open-access" className="text-sm">
                                        Open Access Only
                                    </Label>
                                </div>

                                {/* Author/Institution Search */}
                                <div className="space-y-2">
                                    <Label htmlFor="filter-search" className="text-sm font-medium">
                                        Authors & Institutions
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="filter-search"
                                            ref={filterInputRef}
                                            placeholder="Search authors or institutions..."
                                            value={filterQuery}
                                            onChange={(e) => setFilterQuery(e.target.value)}
                                        />

                                        {/* Filter suggestions dropdown */}
                                        {(authorSuggestions.length > 0 || institutionSuggestions.length > 0 || loadingAutocomplete) && filterQuery.trim().length >= 2 && (
                                            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                                                {loadingAutocomplete ? (
                                                    <div className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                                            <span className="text-sm text-muted-foreground">Loading...</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {authorSuggestions.length > 0 && (
                                                            <div className="p-2">
                                                                <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                                                                    <User className="h-3 w-3" />
                                                                    Authors
                                                                </div>
                                                                {authorSuggestions.slice(0, 5).map((author) => (
                                                                    <button
                                                                        key={author.id}
                                                                        onClick={() => handleFilterAuthorSelect(author)}
                                                                        className="w-full px-2 py-2 text-left hover:bg-accent rounded-sm transition-colors"
                                                                        disabled={authors.some(a => a.id === author.id)}
                                                                    >
                                                                        <div className="font-medium text-sm">{author.display_name}</div>
                                                                        {
                                                                            author.hint && (
                                                                                <div className="text-xs text-muted-foreground">{author.hint}</div>
                                                                            )
                                                                        }
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {institutionSuggestions.length > 0 && (
                                                            <div className="p-2 border-t">
                                                                <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                                                                    <Building2 className="h-3 w-3" />
                                                                    Institutions
                                                                </div>
                                                                {institutionSuggestions.slice(0, 5).map((institution) => (
                                                                    <button
                                                                        key={institution.id}
                                                                        onClick={() => handleFilterInstitutionSelect(institution)}
                                                                        className="w-full px-2 py-2 text-left hover:bg-accent rounded-sm transition-colors"
                                                                        disabled={institutions.some(i => i.id === institution.id)}
                                                                    >
                                                                        <div className="font-medium text-sm">{institution.display_name}</div>
                                                                        {institution.hint && (
                                                                            <div className="text-xs text-muted-foreground">{institution.hint}</div>
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button onClick={() => handleSearch(1)} disabled={loading}>
                        Search
                    </Button>
                </div>

                {/* Active filters display */}
                {activeFilterCount > 0 && (
                    <div className="space-y-2">
                        {/* Header row with label and clear button */}
                        <div className="flex items-center flex-row gap-2">
                            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                <Search className="h-3 w-3" />
                                Active filters ({activeFilterCount}):
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setAuthors([]);
                                    setInstitutions([]);
                                    setOnlyOpenAccess(false);
                                    setFilterQuery("");
                                }}
                                className="h-6 px-3 text-xs"
                            >
                                Clear all
                            </Button>
                        </div>

                        {/* Filter badges row */}
                        <div className="flex flex-wrap gap-2">
                            {onlyOpenAccess && (
                                <Badge variant="secondary" className="gap-1 text-xs">
                                    Open Access
                                    <button
                                        onClick={() => setOnlyOpenAccess(false)}
                                        className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                </Badge>
                            )}

                            {authors.map((author) => (
                                <Badge key={author.id} variant="outline" className="gap-1 text-xs">
                                    <User className="h-2.5 w-2.5" />
                                    {author.display_name}
                                    <button
                                        onClick={() => removeAuthor(author.id)}
                                        className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                </Badge>
                            ))}

                            {institutions.map((institution) => (
                                <Badge key={institution.id} variant="outline" className="gap-1 text-xs">
                                    <Building2 className="h-2.5 w-2.5" />
                                    {institution.display_name}
                                    <button
                                        onClick={() => removeInstitution(institution.id)}
                                        className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Rest of your component remains the same */}
            {!results && !loading && (
                <FinderIntro
                    onExampleClick={(query) => {
                        setQuery(query);
                        inputRef.current?.focus();
                    }}
                    onExampleFilterClick={(filter) => {
                        filterButtonRef.current?.click();
                        setTimeout(() => filterInputRef.current?.focus(), 100);
                        setFilterQuery(filter);
                    }}
                    />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading && [...Array(6)].map((_, i) => (
                    <Card key={`skeleton-${i}`} className="flex flex-col">
                        <CardHeader>
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-full mt-2" />
                        </CardContent>
                    </Card>
                ))}

                {results?.results.map((paper) => (
                    <PaperResultCard key={paper.id} paper={paper} />
                ))}
            </div>

            {results?.results.length === 0 && (
                <div className="text-center text-muted-foreground">
                    No results found
                </div>
            )}

            {
                error && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-destructive">
                                Something went wrong
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {error}
                        </CardContent>
                        <CardFooter className="flex justify-end items-center gap-2">
                            <Button asChild variant="outline" size="sm">
                                <Link href="https://github.com/khoj-ai/openpaper/issues">Report Issue</Link>
                            </Button>
                            <Button
                                onClick={() => setError(null)}
                                variant="outline"
                                size="sm"
                            >
                                Dismiss
                            </Button>
                        </CardFooter>
                    </Card>
                )
            }

            {results && totalPages > 1 && (
                <Pagination>
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious
                                onClick={() => handlePageChange(page - 1)}
                                className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>

                        {getPageNumbers().map((pageNum, idx) => (
                            pageNum === 'ellipsis' ? (
                                <PaginationItem key={`ellipsis-${idx}`}>
                                    <PaginationEllipsis />
                                </PaginationItem>
                            ) : (
                                <PaginationItem key={`page-${pageNum}`}>
                                    <PaginationLink
                                        isActive={pageNum === page}
                                        onClick={() => handlePageChange(pageNum as number)}
                                    >
                                        {pageNum}
                                    </PaginationLink>
                                </PaginationItem>
                            )
                        ))}

                        <PaginationItem>
                            <PaginationNext
                                onClick={() => handlePageChange(page + 1)}
                                className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            )}
        </div>
    )
}
