"use client"

import { fetchFromApi } from "@/lib/api"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { DiscoverSearchHistory } from "../DiscoverHistory"

export default function DiscoverHistoryPage() {
    const router = useRouter()
    const [searches, setSearches] = useState<DiscoverSearchHistory[]>([])
    const [loading, setLoading] = useState(true)

    const fetchHistory = useCallback(async () => {
        try {
            const data = await fetchFromApi("/api/discover/history")
            setSearches(data)
        } catch {
            // Silently fail
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchHistory()
    }, [fetchHistory])

    const handleSelect = (search: DiscoverSearchHistory) => {
        router.push(`/discover?id=${search.id}`)
    }

    return (
        <div className="w-full max-w-2xl mx-auto px-4 py-6">
            <div className="mb-6">
                <Link
                    href="/discover"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Discover
                </Link>
            </div>

            <h1 className="text-xl font-semibold mb-6">Search History</h1>

            {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
            ) : searches.length === 0 ? (
                <div className="text-sm text-muted-foreground">No searches yet.</div>
            ) : (
                <div className="space-y-1">
                    {searches.map((search) => (
                        <button
                            key={search.id}
                            onClick={() => handleSelect(search)}
                            className="w-full px-3 py-3 text-left hover:bg-accent rounded-md transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                        >
                            <div className="text-sm font-medium">{search.question}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                                {search.created_at
                                    ? new Date(search.created_at).toLocaleDateString(undefined, {
                                          year: "numeric",
                                          month: "short",
                                          day: "numeric",
                                      })
                                    : ""}
                                {" · "}
                                {search.subqueries?.length || 0} subqueries
                                {" · "}
                                {Object.values(search.results || {}).flat().length} results
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
