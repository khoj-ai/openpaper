"use client"

import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { History } from "lucide-react"

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
}

export default function DiscoverHistory({ searches, onSelect }: DiscoverHistoryProps) {
    if (searches.length === 0) return null

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <History className="h-3.5 w-3.5" />
                    History
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2 max-h-80 overflow-y-auto" align="end">
                <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                        Past Searches
                    </p>
                    {searches.map((search) => (
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
                                {" · "}
                                {search.subqueries?.length || 0} subqueries
                                {" · "}
                                {Object.values(search.results || {}).flat().length} results
                            </div>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}
