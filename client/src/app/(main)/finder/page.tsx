"use client"

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Sheet,
    SheetContent,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { fetchFromApi } from "@/lib/api";
import { OpenAlexPaper, OpenAlexResponse } from "@/lib/schema";
import { ArrowDownNarrowWide, Building2, CheckIcon, ChevronDown, Filter, Search, User, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FinderIntro } from "./FinderIntro";
import PaperPreviewPanel from "./PaperPreviewPanel";
import PaperResultCard from "./PaperResultCard";
import { getOpenAlexTypeAheadAuthors, getOpenAlexTypeAheadInstitutions, OpenAlexTypeAheadAuthor, OpenAlexTypeAheadInstitution } from "./utils";

interface SearchPaperRequest {
    authors?: string[];
    institutions?: string[];
    only_oa?: boolean;
}

function FinderPageContent() {
    const searchParams = useSearchParams();

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
    const [selectedPaper, setSelectedPaper] = useState<OpenAlexPaper | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [initializedFromUrl, setInitializedFromUrl] = useState(false);

    const [sort, setSort] = useState<string>("");

    const sortLabel =
        sort === "cited_by_count:desc"
            ? "Most cited"
            : sort === "publication_date:desc"
                ? "Newest"
                : "Sort";


    // Check for mobile viewport
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Update URL with current search state
    const updateUrl = useCallback((
        searchQuery: string,
        pageNum: number,
        authorList: OpenAlexTypeAheadAuthor[],
        institutionList: OpenAlexTypeAheadInstitution[],
        openAccess: boolean,
        sortValue: string,
    ) => {
        const params = new URLSearchParams();
        if (searchQuery) params.set('q', searchQuery);
        if (pageNum > 1) params.set('page', pageNum.toString());
        if (openAccess) params.set('oa', '1');
        if (sortValue) params.set("sort", sortValue);

        // Store authors as JSON with id and display_name
        if (authorList.length > 0) {
            params.set('authors', JSON.stringify(authorList.map(a => ({ id: a.id, display_name: a.display_name, hint: a.hint }))));
        }

        // Store institutions as JSON with id and display_name
        if (institutionList.length > 0) {
            params.set('institutions', JSON.stringify(institutionList.map(i => ({ id: i.id, display_name: i.display_name, hint: i.hint }))));
        }

        const queryString = params.toString();
        const newUrl = queryString ? `/finder?${queryString}` : '/finder';
        window.history.pushState({}, '', newUrl);
    }, []);

    // Initialize state from URL params on mount and trigger search if needed
    useEffect(() => {
        if (initializedFromUrl) return;

        const urlQuery = searchParams.get('q');
        const urlPage = searchParams.get('page');
        const urlOa = searchParams.get('oa');
        const urlAuthors = searchParams.get('authors');
        const urlInstitutions = searchParams.get('institutions');
        const urlSort = searchParams.get("sort");

        let parsedAuthors: OpenAlexTypeAheadAuthor[] = [];
        let parsedInstitutions: OpenAlexTypeAheadInstitution[] = [];
        const parsedPage = urlPage ? parseInt(urlPage, 10) : 1;
        const parsedOa = urlOa === '1';

        if (urlQuery) {
            setQuery(urlQuery);
        }

        if (urlPage) {
            setPage(parsedPage);
        }

        if (parsedOa) {
            setOnlyOpenAccess(true);
        }

        if (urlAuthors) {
            try {
                parsedAuthors = JSON.parse(urlAuthors) as OpenAlexTypeAheadAuthor[];
                setAuthors(parsedAuthors);
            } catch (e) {
                console.error('Failed to parse authors from URL:', e);
            }
        }

        if (urlInstitutions) {
            try {
                parsedInstitutions = JSON.parse(urlInstitutions) as OpenAlexTypeAheadInstitution[];
                setInstitutions(parsedInstitutions);
            } catch (e) {
                console.error('Failed to parse institutions from URL:', e);
            }
        }

        if (urlSort) setSort(urlSort);

        setInitializedFromUrl(true);

        // If there's a URL query, trigger search directly with parsed values
        if (urlQuery) {
            performSearch(urlQuery, parsedPage, parsedAuthors, parsedInstitutions, parsedOa, urlSort ?? "", false);
        }
    }, [searchParams, initializedFromUrl]);

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

    // Core search function
    const performSearch = async (
        searchQuery: string,
        pageNumber: number,
        authorList: OpenAlexTypeAheadAuthor[],
        institutionList: OpenAlexTypeAheadInstitution[],
        openAccess: boolean,
        sortValue: string,
        shouldUpdateUrl: boolean = true
    ) => {
        if (!searchQuery.trim()) return;

        setResults(null);
        setLoading(true);
        inputRef.current?.blur();
        setError(null);

        try {
            const filter: SearchPaperRequest = {
                authors: authorList.map(author => author.id),
                institutions: institutionList.map(institution => institution.id),
                only_oa: openAccess,
            };

            const hasFilters = (filter.authors?.length ?? 0 > 0) || (filter.institutions?.length ?? 0 > 0) || filter.only_oa;

            const sortParam = sortValue ? `&sort=${encodeURIComponent(sortValue)}` : "";
            const response: OpenAlexResponse = await fetchFromApi(
                `/api/search/global/search?query=${encodeURIComponent(searchQuery)}&page=${pageNumber}&per_page=${perPage}${sortParam}`,
                {
                    method: "POST",
                    ...(hasFilters && { body: JSON.stringify(filter) }),
                }
            );

            setResults(response);
            setTotalResults(response.meta.count);
            setPerPage(response.meta.per_page);
            setPage(pageNumber);

            // Update URL after successful search
            if (shouldUpdateUrl) {
                updateUrl(searchQuery, pageNumber, authorList, institutionList, openAccess, sortValue);
            }
        } catch (error) {
            console.error("Search failed:", error);
            setError("Failed to fetch results. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Search triggered by user action (updates URL)
    const handleSearch = async (pageNumber = page) => {
        await performSearch(query, pageNumber, authors, institutions, onlyOpenAccess, sort, true);
    };

    const totalPages = Math.ceil(totalResults / perPage);

    // Handle page change
    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) {
            return;
        }
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

    const hasActiveFilters = authors.length > 0 || institutions.length > 0 || onlyOpenAccess;
    const filterCount = authors.length + institutions.length + (onlyOpenAccess ? 1 : 0);
    const hasActiveConstraints = hasActiveFilters || !!sort;
    const activeConstraintCount = filterCount + (sort ? 1 : 0);

    return (
        <div className="w-full px-4 py-6 space-y-6 overflow-x-hidden">
            <Alert className="max-w-2xl">
                <AlertTitle>This feature will be deprecated</AlertTitle>
                <AlertDescription>
                    For a free alternative, visit{" "}
                    <a href="https://openalex.org" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                        OpenAlex.org
                    </a>
                    , or try the new{" "}
                    <Link href="/discover" className="underline font-medium">
                        Discover
                    </Link>
                    {" "}feature.
                </AlertDescription>
            </Alert>
            <div className="space-y-4">
                {/* Main search bar */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
                    <div className="relative flex-1 max-w-2xl">
                        <Input
                            ref={inputRef}
                            placeholder="Search by topic, title, keywords..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch(1)}
                        />
                    </div>

                    {/* Filter button */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="flex items-center gap-2" ref={filterButtonRef} >
                                <Filter className="h-4 w-4" />
                                Filters
                                {hasActiveFilters && (
                                    <Badge variant="secondary" className="ml-1 px-1 py-0 text-xs flex items-center gap-1">
                                        {filterCount}
                                    </Badge>
                                )}
                                <ChevronDown className="h-3 w-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-4" align={isMobile ? "center" : "end"} sideOffset={isMobile ? 8 : 4}>
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


                    {/* Sort dropdown (match Filters style) */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="flex items-center gap-2">
                                <ArrowDownNarrowWide className="h-4 w-4" />
                                Sort
                                {sort && (
                                    <Badge variant="secondary" className="ml-1 px-1 py-0 text-xs flex items-center gap-1">
                                        1
                                    </Badge>
                                )}
                                <ChevronDown className="h-3 w-3" />
                            </Button>
                        </PopoverTrigger>

                        <PopoverContent className="w-56 p-2" align={isMobile ? "center" : "start"} sideOffset={isMobile ? 8 : 4}>
                            <div className="flex flex-col">

                                <button
                                    className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2"
                                    onClick={() => {
                                        setSort("cited_by_count:desc");
                                    }}
                                >
                                    {
                                        sortLabel == 'Most cited' ? (
                                            <CheckIcon className="h-4 w-4 mb-1 text-primary" />
                                        ) : null
                                    }
                                    Most cited
                                </button>

                                <button
                                    className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2"
                                    onClick={() => {
                                        setSort("publication_date:desc");
                                    }}
                                >
                                    {
                                        sortLabel == 'Newest' ? (
                                            <CheckIcon className="h-4 w-4 mb-1 text-primary" />
                                        ) : null
                                    }
                                    Newest
                                </button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button onClick={() => handleSearch(1)} disabled={loading}>
                        Search
                    </Button>
                </div>

                {/* Active filters display */}
                {hasActiveConstraints && (
                    <div className="space-y-2">
                        {/* Header row with label and clear button */}
                        <div className="flex items-center flex-row gap-2">
                            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                <Search className="h-3 w-3" />
                                Active filters ({activeConstraintCount}):
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setAuthors([]);
                                    setInstitutions([]);
                                    setOnlyOpenAccess(false);
                                    setFilterQuery("");
                                    setSort("");
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

                            {sort && (
                                <Badge variant="secondary" className="gap-1 text-xs">
                                    {sortLabel}
                                    <button
                                        onClick={() => setSort("")}
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

            {/* Split pane layout - results on left, preview on right (desktop) */}
            {(loading || results) && (
                <div className="flex gap-6 overflow-hidden">
                    {/* Results column - always use fixed height scroll container to avoid scroll reset when preview opens */}
                    <div className={`${selectedPaper ? 'hidden lg:block lg:flex-1 lg:pr-2 min-w-0' : 'w-full max-w-5xl'} lg:h-[calc(100vh-8rem)] lg:overflow-y-auto overflow-x-hidden`}>
                        {loading && [...Array(6)].map((_, i) => (
                            <div key={`skeleton-${i}`} className="py-4 border-b border-slate-200 dark:border-slate-800">
                                <Skeleton className="h-5 w-3/4 mb-2" />
                                <Skeleton className="h-4 w-1/2 mb-2" />
                                <Skeleton className="h-4 w-full mb-1" />
                                <Skeleton className="h-4 w-2/3" />
                            </div>
                        ))}

                        {results?.results.map((paper) => (
                            <PaperResultCard
                                key={paper.id}
                                paper={paper}
                                isSelected={selectedPaper?.id === paper.id}
                                onSelect={setSelectedPaper}
                            />
                        ))}

                        {results?.results.length === 0 && (
                            <div className="text-center text-muted-foreground py-8">
                                No results found
                            </div>
                        )}
                    </div>

                    {/* Preview panel - desktop only */}
                    {selectedPaper && (
                        <div className="hidden lg:block lg:w-80 xl:w-96 flex-shrink-0 sticky top-6 h-[calc(100vh-8rem)] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                            <PaperPreviewPanel
                                paper={selectedPaper}
                                onClose={() => setSelectedPaper(null)}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Mobile sheet for paper preview */}
            <Sheet open={selectedPaper !== null && isMobile} onOpenChange={(open) => !open && setSelectedPaper(null)}>
                <SheetContent side="right" className="w-full sm:w-3/4 p-0">
                    {selectedPaper && (
                        <PaperPreviewPanel
                            paper={selectedPaper}
                            onClose={() => setSelectedPaper(null)}
                        />
                    )}
                </SheetContent>
            </Sheet>

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
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    handlePageChange(page - 1);
                                }}
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
                                        href="#"
                                        isActive={pageNum === page}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            handlePageChange(pageNum as number);
                                        }}
                                    >
                                        {pageNum}
                                    </PaginationLink>
                                </PaginationItem>
                            )
                        ))}

                        <PaginationItem>
                            <PaginationNext
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    handlePageChange(page + 1);
                                }}
                                className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            )}
        </div>
    )
}

export default function FinderPage() {
    return (
        <Suspense fallback={<div className="w-full px-4 py-6">Loading...</div>}>
            <FinderPageContent />
        </Suspense>
    )
}
