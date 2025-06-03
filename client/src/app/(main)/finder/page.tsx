"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
    SheetClose,
} from '@/components/ui/sheet';
import { ExternalLink, Users, CalendarDays, Search, Building2, BookOpen, Quote, Tag, Globe } from "lucide-react"
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
import Link from "next/link"

interface OpenAlexResponse {
    meta: {
        count: number
        page: number | null
        per_page: number
    },
    results: Array<{
        id: string
        title: string
        doi?: string
        publication_year: number
        publication_date: string
        open_access?: {
            is_oa: boolean
            oa_status: string
            oa_url?: string
        }
        keywords?: Array<{
            display_name: string
            score?: number
        }>
        authorships?: Array<{
            author?: {
                id: string
                orcid?: string
                display_name?: string
            }
            institutions?: {
                id: string
                type: string
                display_name: string
                ror?: string
            }[]
        }>
        topics?: Array<{
            display_name: string
            score?: number,
            subfield: {
                display_name: string
            },
            field: {
                display_name: string
            },
            domain: {
                display_name: string
            }
        }>
        cited_by_count?: number
        abstract?: string
    }>
}

interface PaperResultCardProps {
    paper: OpenAlexResponse["results"][number]
}
function PaperResultCard({ paper }: PaperResultCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false); // Renamed from isDialogOpen

    // Get unique institutions from authorships
    const institutions = paper.authorships?.flatMap(a => a.institutions || []).filter(Boolean).filter((inst, index, self) =>
        index === self.findIndex(i => i.id === inst.id)
    ) || [];

    const hasInstitutions = institutions.length > 0;
    const hasAuthors = paper.authorships?.some(a => a.author?.display_name) || false;
    const numAuthors = paper.authorships?.length || 0;

    return (
        <>
            <Card
                className="group flex flex-col transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-blue-500/10 hover:border-blue-200 cursor-pointer bg-secondary/10 dark:bg-secondary/80"
                onClick={() => setIsSheetOpen(true)} // Changed to setIsSheetOpen
            >
                <CardHeader className="relative">
                    <CardTitle className="text-lg leading-tight group-hover:text-blue-700 group-hover:dark:text-blue-300 transition-colors duration-200 pr-8">
                        {paper.title}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 text-accent-foreground">
                        <CalendarDays className="h-4 w-4 text-blue-500" />
                        {paper.publication_date}
                        {paper.publication_year && (
                            <Badge variant="outline" className="ml-2 text-xs">
                                {paper.publication_year}
                            </Badge>
                        )}
                    </CardDescription>
                </CardHeader>

                <CardContent className="flex-grow space-y-4">
                    {hasAuthors && (
                        <div className="flex items-start gap-2">
                            <Users className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                            <div className="text-sm text-accent-foreground leading-relaxed">
                                {paper.authorships?.slice(0, 3).map((a, index) => (
                                    <span key={a.author?.id || index}>
                                        {index > 0 && ", "}
                                        {a.author?.orcid ? (
                                            <a
                                                href={`${a.author.orcid}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-emerald-600 dark:text-green-200 hover:text-emerald-700 hover:underline transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {a.author.display_name}
                                            </a>
                                        ) : (
                                            <span className="text-accent-foreground">
                                                {a.author?.display_name || "Unknown Author"}
                                            </span>
                                        )}
                                    </span>
                                ))}
                                {numAuthors > 3 && (
                                    <span className="italic">
                                        {" "}and {numAuthors - 3} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {hasInstitutions && (
                        <div className="flex items-start gap-2">
                            <Building2 className="h-4 w-4 mt-0.5 text-purple-500 flex-shrink-0" />
                            <div className="text-sm leading-relaxed">
                                {institutions.slice(0, 2).map((institution, index) => (
                                    <span key={institution.id}>
                                        {index > 0 && ", "}
                                        <a
                                            href={`${institution.ror}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-purple-600 dark:text-purple-200 hover:underline transition-colors"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {institution.display_name}
                                        </a>
                                    </span>
                                ))}
                                {institutions.length > 2 && (
                                    <span className="text-slate-500 italic">
                                        {" "}and {institutions.length - 2} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {(paper.keywords || paper.topics) && (
                        <div className="flex flex-wrap gap-2">
                            {paper.keywords?.slice(0, 2).map((keyword, i) => (
                                <Badge key={`keyword-${i}`} variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 transition-colors">
                                    <Tag className="h-3 w-3 mr-1" />
                                    {keyword.display_name}
                                </Badge>
                            ))}
                            {paper.topics?.slice(0, 1).map((topic, i) => (
                                <Badge key={`topic-${i}`} variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 transition-colors">
                                    <Globe className="h-3 w-3 mr-1" />
                                    {topic.display_name}
                                </Badge>
                            ))}
                        </div>
                    )}

                    {paper.abstract && (
                        <div className="bg-secondary p-3 border-l-4 border-slate-300">
                            <p className="text-sm text-secondary-foreground leading-relaxed">
                                {paper.abstract.length > 150
                                    ? paper.abstract.slice(0, 150) + "..."
                                    : paper.abstract}
                            </p>
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex flex-col md:flex-row md:justify-between items-start md:items-center pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                        {paper.cited_by_count !== undefined && (
                            <Badge variant="default" className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors">
                                <Quote className="h-3 w-3 mr-1" />
                                {paper.cited_by_count} citations
                            </Badge>
                        )}
                        {paper.open_access?.is_oa && (
                            <Badge className="bg-green-100 text-green-700">
                                Open Access
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {paper.doi && (
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            >
                                <a
                                    href={`https://doi.org/${paper.doi}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    DOI
                                </a>
                            </Button>
                        )}
                        {paper.open_access?.oa_url && (
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="hover:bg-green-50 hover:text-green-700 transition-colors"
                            >
                                <a
                                    href={paper.open_access.oa_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <BookOpen className="h-4 w-4" />
                                    PDF
                                </a>
                            </Button>
                        )}
                    </div>
                </CardFooter>
            </Card>

            {/* ==== Sheet Implementation ==== */}
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent
                    side="right" // Or "left", "top", "bottom"
                    className="w-full md:w-3/4 lg:w-1/2 xl:max-w-2xl p-6 h-full overflow-y-auto"
                >
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-xl leading-tight pr-8">
                            {paper.title}
                        </SheetTitle>
                        <SheetDescription className="flex items-start flex-col gap-4 text-base pt-2">
                            <div className="flex items-center gap-2">
                                <span className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4" />
                                    {paper.publication_date}
                                </span>
                                {paper.publication_year && (
                                    <Badge variant="outline">
                                        {paper.publication_year}
                                    </Badge>
                                )}
                            </div>
                            {/* Links */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                {paper.doi && (
                                    <Button
                                        variant={"outline"}
                                        asChild>
                                        <a
                                            href={`https://doi.org/${paper.doi}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            View DOI
                                        </a>
                                    </Button>
                                )}
                                {paper.open_access?.oa_url && (
                                    <Button variant="default" asChild>
                                        <a
                                            href={paper.open_access.oa_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                        >
                                            <BookOpen className="h-4 w-4" />
                                            Open Access PDF
                                        </a>
                                    </Button>
                                )}
                            </div>
                        </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6">
                        {/* Abstract */}
                        {paper.abstract && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3">Abstract</h3>
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 border-l-4 border-slate-300">
                                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {paper.abstract}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Authors Section */}
                        {hasAuthors && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                                    <Users className="h-5 w-5 text-emerald-500" />
                                    Authors ({numAuthors})
                                </h3>
                                <div className="grid gap-2">
                                    {paper.authorships?.map((authorship, index) => (
                                        <div key={index} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <div>
                                                {authorship.author?.orcid ? (
                                                    <a
                                                        href={authorship.author.orcid}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                                                    >
                                                        {authorship.author.display_name}
                                                    </a>
                                                ) : (
                                                    <span className="font-medium">
                                                        {authorship.author?.display_name || "Unknown Author"}
                                                    </span>
                                                )}
                                                {authorship.institutions && authorship.institutions.length > 0 && (
                                                    <div className="text-sm text-slate-600 mt-1">
                                                        {authorship.institutions.map((inst, i) => (
                                                            <span key={inst.id}>
                                                                {i > 0 && ", "}
                                                                {inst.display_name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Institutions Section */}
                        {hasInstitutions && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-purple-500" />
                                    Institutions ({institutions.length})
                                </h3>
                                <div className="grid gap-2">
                                    {institutions.map(institution => (
                                        <div key={institution.id} className="p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <a
                                                href={institution.ror}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium text-purple-600 dark:text-purple-400 hover:underline"
                                            >
                                                {institution.display_name}
                                            </a>
                                            <div className="text-sm text-slate-600 mt-1">
                                                Type: {institution.type}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Keywords and Topics */}
                        {(paper.keywords || paper.topics) && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                                    <Tag className="h-5 w-5 text-blue-500" />
                                    Keywords & Topics
                                </h3>
                                <div className="space-y-3">
                                    {paper.keywords && paper.keywords.length > 0 && (
                                        <div>
                                            <h4 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2">Keywords:</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {paper.keywords.map((keyword, i) => (
                                                    <Badge key={i} variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                                                        {keyword.display_name}
                                                        {keyword.score && (
                                                            <span className="ml-1 text-xs opacity-70">
                                                                ({keyword.score.toFixed(2)})
                                                            </span>
                                                        )}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {paper.topics && paper.topics.length > 0 && (
                                        <div>
                                            <h4 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2 mt-3">Topics:</h4>
                                            <div className="space-y-2">
                                                {paper.topics.map((topic, i) => (
                                                    <div key={i} className="p-2 bg-slate-50 rounded-lg dark:bg-slate-900">
                                                        <div className="font-medium text-amber-600 dark:text-amber-400">
                                                            {topic.display_name}
                                                            {topic.score && (
                                                                <span className="ml-2 text-xs opacity-70">
                                                                    Score: {topic.score.toFixed(2)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-amber-700 mt-1 dark:text-amber-300">
                                                            {topic.domain.display_name} → {topic.field.display_name} → {topic.subfield.display_name}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Metadata */}
                        <div>
                            <h3 className="font-semibold text-lg mb-3">Publication Details</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {paper.cited_by_count !== undefined && (
                                    <div className="bg-slate-50 p-3 rounded-lg dark:bg-slate-900">
                                        <div className="font-medium text-slate-600 dark:text-slate-300">Citations</div>
                                        <div className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">
                                            {paper.cited_by_count}
                                        </div>
                                    </div>
                                )}
                                {paper.open_access && (
                                    <div className="bg-slate-50 p-3 rounded-lg dark:bg-slate-900">
                                        <div className="font-medium text-slate-600 dark:text-slate-300">Open Access Status</div>
                                        <Badge className={`mt-1 ${paper.open_access.is_oa ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                                            {paper.open_access.oa_status}
                                        </Badge>
                                    </div>
                                )}
                            </div>
                        </div>
                        <SheetFooter className="mt-6">
                            {/* Links again */}
                            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t mt-4">
                                {paper.doi && (
                                    <Button
                                        variant={"outline"}
                                        asChild>
                                        <a
                                            href={`https://doi.org/${paper.doi}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            View DOI
                                        </a>
                                    </Button>
                                )}
                                {paper.open_access?.oa_url && (
                                    <Button variant="default" asChild>
                                        <a
                                            href={paper.open_access.oa_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                        >
                                            <BookOpen className="h-4 w-4" />
                                            Open Access PDF
                                        </a>
                                    </Button>
                                )}
                            </div>
                            <SheetClose asChild>
                                <Button variant="outline" className="w-fit">Close</Button>
                            </SheetClose>
                        </SheetFooter>
                    </div>
                    {/* The iframe for PDF is commented out, because it's not yet reliable */}
                    {/* <iframe
                        src={`${paper.open_access?.oa_url || paper.doi ? `https://doi.org/${paper.doi}` : ''}`} // Simplified logic slightly
                        className="w-full h-96 mt-4 border rounded-lg"
                        title="Paper PDF"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLIFrameElement).style.display = 'none';
                            console.error("Failed to load PDF for paper:", paper.id);
                        }}
                    ></iframe> */}
                </SheetContent>
            </Sheet >
        </>
    );
}
export default function FinderPage() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<OpenAlexResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(25);
    const [totalResults, setTotalResults] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async (pageNumber = page) => {
        if (!query.trim()) return

        setResults(null);
        setLoading(true);
        try {
            const response: OpenAlexResponse = await fetchFromApi(
                `/api/paper_search/search?query=${encodeURIComponent(query)}&page=${pageNumber}&per_page=${perPage}`
            )
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

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex gap-4">
                <Input
                    placeholder="Search for papers..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="max-w-2xl"
                />
                <Button onClick={() => handleSearch(1)} disabled={loading}>
                    Search
                </Button>
            </div>

            {!results && !loading && (
                <Card className="bg-muted/50">
                    <CardContent className="pt-6">
                        <div className="flex gap-4 items-start">
                            <div className="bg-primary/10 p-3 rounded-full">
                                <Search className="h-6 w-6 text-primary" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-medium">Paper Finder</h3>
                                <p className="text-muted-foreground">
                                    Search for academic papers by paper title or research topic.
                                    We search a public database to find relevant papers in your area of interest.
                                </p>
                                <p className="text-muted-foreground">
                                    Some papers will be available as open access, while others may require institutional access.
                                    For all papers, we provide DOIs (Digital Object Identifiers) that link to the original source.
                                </p>
                                <div className="pt-2">
                                    <Badge variant="outline" className="mr-2">Example: Attention is All You Need</Badge>
                                    <Badge variant="outline" className="mr-2">Example: natural language processing</Badge>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
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
                                <Link href="https://github.com/sabaimran/openpaper/issues">Report Issue</Link>
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
