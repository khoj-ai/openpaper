"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink, Users, CalendarDays, Search } from "lucide-react"
import { fetchFromApi } from "@/lib/api"
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
                display_name?: string
            }
            institutions?: {
                display_name: string
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
    return (
        <Card key={paper.id} className="flex flex-col">
            <CardHeader>
                <CardTitle className="text-lg">{paper.title}</CardTitle>
                <CardDescription className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    {paper.publication_date}
                </CardDescription>
            </CardHeader>

            <CardContent className="flex-grow space-y-4">
                {paper.authorships && (
                    <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        <span className="text-sm text-muted-foreground">
                            {paper.authorships.map(a => a.author?.display_name).filter(Boolean).join(", ")}
                        </span>
                    </div>
                )}

                {paper.keywords && (
                    <div className="flex flex-wrap gap-2">
                        {paper.keywords.map((keyword, i) => (
                            <Badge key={i} variant="secondary">
                                {keyword.display_name}
                            </Badge>
                        ))}
                    </div>
                )}
                {
                    paper.topics && (
                        <div className="flex flex-wrap gap-2">
                            {paper.topics.map((topic, i) => (
                                <Badge key={i} variant="secondary">
                                    {topic.display_name}
                                </Badge>
                            ))}
                        </div>
                    )
                }
                {
                    paper.abstract && (
                        <p className="text-sm text-muted-foreground">
                            {paper.abstract.length > 200
                                ? paper.abstract.slice(0, 200) + "..."
                                : paper.abstract}
                        </p>
                    )
                }
            </CardContent>

            <CardFooter className="flex justify-between items-center">
                {paper.cited_by_count && (
                    <Badge variant={"default"}>
                        {paper.cited_by_count} citations
                    </Badge>
                )}
                {paper.doi && (
                    <Button variant="ghost" size="sm" asChild>
                        <a
                            href={`https://doi.org/${paper.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2"
                        >
                            <ExternalLink className="h-4 w-4" />
                            DOI
                        </a>
                    </Button>
                )}
                {
                    paper.open_access?.oa_url && (
                        <Button variant="ghost" size="sm" asChild>
                            <a
                                href={paper.open_access.oa_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2"
                            >
                                <ExternalLink className="h-4 w-4" />
                                Open PDF
                            </a>
                        </Button>
                    )
                }
                {
                    paper.open_access && !paper.open_access.is_oa && (
                        <Badge variant={"secondary"}>
                            {paper.open_access.oa_status}
                        </Badge>
                    )
                }
            </CardFooter>
        </Card>
    )
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
