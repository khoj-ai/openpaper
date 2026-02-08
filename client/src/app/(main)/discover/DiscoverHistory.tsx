"use client"

import Link from "next/link"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ChevronRight } from "lucide-react"

export interface DiscoverSearchHistory {
    id: string
    question: string
    subqueries: string[]
    results: Record<string, unknown[]>
    created_at: string | null
}

interface DiscoverHistoryProps {
    searches: DiscoverSearchHistory[]
    onSelect: (search: DiscoverSearchHistory) => void
    maxVisible?: number
}

export default function DiscoverHistory({ searches, onSelect, maxVisible = 5 }: DiscoverHistoryProps) {
    if (searches.length === 0) return null

    const visibleSearches = searches.slice(0, maxVisible)
    const hasMore = searches.length > maxVisible

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Previous searches
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" align="end">
                <div className="space-y-1">
                    {visibleSearches.map((search) => (
                        <button
                            key={search.id}
                            onClick={() => onSelect(search)}
                            className="w-full px-2 py-2 text-left hover:bg-accent rounded-sm transition-colors"
                        >
                            <div className="text-sm font-medium truncate">{search.question}</div>
                            <div className="text-xs text-muted-foreground">
                                {search.created_at
                                    ? new Date(search.created_at).toLocaleDateString()
                                    : ""}
                            </div>
                        </button>
                    ))}
                    {hasMore && (
                        <Link
                            href="/discover/history"
                            className="flex items-center justify-between w-full px-2 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-sm transition-colors"
                        >
                            <span>View all searches</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
