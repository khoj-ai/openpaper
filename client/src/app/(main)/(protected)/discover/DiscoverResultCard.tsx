"use client"

import { ExternalLink } from "lucide-react"
import type { ReactNode } from "react"

export interface DiscoverResult {
    title: string
    url: string
    authors?: string[]
    published_date?: string | null
    text?: string | null
    highlights?: string[]
    highlight_scores?: number[]
    favicon?: string | null
    summary?: string | null
    cited_by_count?: number | null
    source?: string | null
    institutions?: string[]
    publication_type?: string | null
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

// Only types that qualify how much weight to give a result are worth a badge.
// "article" is the reader's default assumption, so labelling it adds noise.
const PUBLICATION_TYPE_LABELS: Record<string, string> = {
    preprint: "Preprint",
    review: "Review",
}

function formatPublicationType(publicationType?: string | null): string | null {
    if (!publicationType) return null
    return PUBLICATION_TYPE_LABELS[publicationType.toLowerCase()] ?? null
}

export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
    const publishedYear = result.published_date
        ? new Date(result.published_date).getFullYear()
        : null

    const authorsDisplay = formatAuthors(result.authors)
    const institutionsDisplay = formatInstitutions(result.institutions)
    const publicationTypeLabel = formatPublicationType(result.publication_type)

    const snippet = sanitizeSnippet(
        result.summary || result.text || result.highlights?.[0] || ""
    );

    // Sources fill these in unevenly, so collect whatever is present and let the
    // separators fall out of the list rather than conditioning on each pairing.
    const metadata: { key: string; node: ReactNode }[] = []
    if (authorsDisplay) metadata.push({ key: "authors", node: authorsDisplay })
    if (result.source) metadata.push({ key: "source", node: <span className="italic">{result.source}</span> })
    if (publishedYear) metadata.push({ key: "year", node: publishedYear })
    if (result.cited_by_count != null && result.cited_by_count > 0) {
        metadata.push({ key: "citations", node: `${result.cited_by_count.toLocaleString()} citations` })
    }

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

                {(metadata.length > 0 || publicationTypeLabel) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {publicationTypeLabel && (
                            <span className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] font-medium uppercase tracking-wide">
                                {publicationTypeLabel}
                            </span>
                        )}
                        {metadata.map((item, idx) => (
                            // Separator trails its item so a wrapped line never opens with a
                            // stray dot — these rows wrap often once a venue is present.
                            <span key={item.key} className="flex items-center gap-x-2">
                                <span>{item.node}</span>
                                {idx < metadata.length - 1 && <span aria-hidden="true">&middot;</span>}
                            </span>
                        ))}
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
