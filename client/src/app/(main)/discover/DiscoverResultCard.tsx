"use client"

import { ExternalLink } from "lucide-react"

export interface DiscoverResult {
    title: string
    url: string
    author?: string | null
    published_date?: string | null
    text?: string | null
    highlights?: string[]
    highlight_scores?: number[]
    favicon?: string | null
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

export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
    const publishedYear = result.published_date
        ? new Date(result.published_date).getFullYear()
        : null

    const snippet = result.highlights?.[0]
        ? sanitizeSnippet(result.highlights[0])
        : result.text
          ? sanitizeSnippet(result.text)
          : null

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

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {result.author && <span>{result.author}</span>}
                    {result.author && publishedYear && <span>&middot;</span>}
                    {publishedYear && <span>{publishedYear}</span>}
                </div>

                {snippet && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                        {snippet}
                    </p>
                )}
            </div>
        </div>
    )
}
