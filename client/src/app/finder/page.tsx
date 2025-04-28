"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink, Users, CalendarDays } from "lucide-react"
import { fetchFromApi } from "@/lib/api"

interface OpenAlexResponse {
    meta: {
        [key: string]: string | number
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
    }>
}

export default function FinderPage() {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<OpenAlexResponse | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSearch = async () => {
        if (!query.trim()) return

        setResults(null);
        setLoading(true);
        try {
            const response: OpenAlexResponse = await fetchFromApi(`/api/paper_search/search?query=${encodeURIComponent(query)}`)
            setResults(response)
        } catch (error) {
            console.error("Search failed:", error)
        } finally {
            setLoading(false)
        }
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
                <Button onClick={handleSearch} disabled={loading}>
                    Search
                </Button>
            </div>

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
                ))}
            </div>

            {results?.results.length === 0 && (
                <div className="text-center text-muted-foreground">
                    No results found
                </div>
            )}
        </div>
    )
}
