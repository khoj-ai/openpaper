"use client"

import { ExternalLink } from "lucide-react"

export interface DiscoverResult {
    title: string
    url: string
    author?: string | null
    published_date?: string | null
    text?: string | null
    highlights?: string[]
    score?: number | null
}

interface DiscoverResultCardProps {
    result: DiscoverResult
}

export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
    const publishedYear = result.published_date
        ? new Date(result.published_date).getFullYear()
        : null

    return (
        <div className="py-4 border-b border-slate-200 dark:border-slate-800 group">
            <div className="space-y-1.5">
                <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sm hover:underline flex items-start gap-1.5"
                >
                    <span className="flex-1">{result.title}</span>
                    <ExternalLink className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {result.author && <span>{result.author}</span>}
                    {result.author && publishedYear && <span>&middot;</span>}
                    {publishedYear && <span>{publishedYear}</span>}
                </div>

                {result.text && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                        {result.text}
                    </p>
                )}

                {result.highlights && result.highlights.length > 0 && !result.text && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                        {result.highlights[0]}
                    </p>
                )}
            </div>
        </div>
    )
}
