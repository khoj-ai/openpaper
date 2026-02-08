"use client"

import { ExternalLink } from "lucide-react"

export interface DiscoverResult {
    title: string
    url: string
    authors?: string[]
    published_date?: string | null
    text?: string | null
    highlights?: string[]
    highlight_scores?: number[]
    favicon?: string | null
    cited_by_count?: number | null
    source?: string | null
    institutions?: string[]
}

interface DiscoverResultCardProps {
    result: DiscoverResult
}

/**
 * Sanitize text by removing common metadata artifacts from scraped content.
 */
function sanitizeSnippet(text: string): string {
    // Remove patterns like [_icon_ \ Label] or [Label]
    let cleaned = text.replace(/\[_?\w+\s*icon_?\s*\\?\s*\\?\s*\w*\]/gi, "")
    // Remove markdown-style artifacts like **Authors** or \Content
    cleaned = cleaned.replace(/\*\*\w+\*\*/g, "")
    cleaned = cleaned.replace(/\\\s*\w+/g, " ")
    // Remove "Document Type : ..." prefix
    cleaned = cleaned.replace(/^Document Type\s*:\s*\w+\s*/i, "")
    // Remove orphaned brackets and pipes
    cleaned = cleaned.replace(/\[\s*\]/g, "")
    cleaned = cleaned.replace(/\s*\|\s*/g, " ")
    // Collapse multiple spaces
    cleaned = cleaned.replace(/\s{2,}/g, " ").trim()
    return cleaned
}

function formatAuthors(authors?: string[]): string | null {
    if (!authors || authors.length === 0) return null
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
    return `${authors[0]} et al.`
}

function formatInstitutions(institutions?: string[]): string | null {
    if (!institutions || institutions.length === 0) return null
    if (institutions.length === 1) return institutions[0]
    if (institutions.length === 2) return `${institutions[0]}, ${institutions[1]}`
    return `${institutions[0]}, ${institutions[1]} +${institutions.length - 2} more`
}

export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
    const publishedYear = result.published_date
        ? new Date(result.published_date).getFullYear()
        : null

    const authorsDisplay = formatAuthors(result.authors)
    const institutionsDisplay = formatInstitutions(result.institutions)

    const snippet = sanitizeSnippet(
        result.text || result.highlights?.[0] || ""
    );

    // Build metadata items for the first line
    const hasMetadata = authorsDisplay || publishedYear || result.source || (result.cited_by_count != null && result.cited_by_count > 0)

    return (
        <div className="py-4 border-b border-slate-200 dark:border-slate-800 last:border-b-0 group">
            <div className="space-y-1.5">
                <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sm hover:underline flex items-start gap-1.5"
                >
                    {result.favicon && (
                        <img
                            src={result.favicon}
                            alt=""
                            className="h-4 w-4 mt-0.5 flex-shrink-0 rounded-sm"
                        />
                    )}
                    <span className="flex-1">{result.title}</span>
                    <ExternalLink className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>

                {hasMetadata && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {authorsDisplay && <span>{authorsDisplay}</span>}
                        {authorsDisplay && (publishedYear || result.source) && <span>&middot;</span>}
                        {result.source && <span className="italic">{result.source}</span>}
                        {result.source && publishedYear && <span>&middot;</span>}
                        {publishedYear && <span>{publishedYear}</span>}
                        {(authorsDisplay || publishedYear || result.source) && result.cited_by_count != null && result.cited_by_count > 0 && <span>&middot;</span>}
                        {result.cited_by_count != null && result.cited_by_count > 0 && (
                            <span>{result.cited_by_count.toLocaleString()} citations</span>
                        )}
                    </div>
                )}

                {institutionsDisplay && (
                    <div className="text-xs text-muted-foreground/70">
                        {institutionsDisplay}
                    </div>
                )}

                {snippet && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                        {snippet}
                    </p>
                )}
            </div>
        </div>
    )
}
