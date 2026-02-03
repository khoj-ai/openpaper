"use client"

import { fetchFromApi, fetchStreamFromApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { RotateCcw } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import DiscoverHistory, { DiscoverSearchHistory } from "./DiscoverHistory"
import DiscoverInput from "./DiscoverInput"
import DiscoverResultCard, { DiscoverResult } from "./DiscoverResultCard"
import SubqueryList from "./SubqueryList"

const END_DELIMITER = "END_OF_STREAM"

interface SubqueryResults {
    subquery: string
    results: DiscoverResult[]
}

function DiscoverPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [question, setQuestion] = useState("")
    const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [subqueries, setSubqueries] = useState<string[]>([])
    const [activeSubquery, setActiveSubquery] = useState<string>("")
    const [resultGroups, setResultGroups] = useState<SubqueryResults[]>([])
    const [history, setHistory] = useState<DiscoverSearchHistory[]>([])
    const [error, setError] = useState<string | null>(null)

    const loadSearchById = useCallback(async (id: string) => {
        try {
            const data = await fetchFromApi(`/api/discover/${id}`)
            setQuestion(data.question)
            setSubmittedQuestion(data.question)
            setSubqueries(data.subqueries || [])
            setError(null)

            const groups: SubqueryResults[] = []
            if (data.results) {
                for (const [subquery, results] of Object.entries(data.results)) {
                    groups.push({
                        subquery,
                        results: results as DiscoverResult[],
                    })
                }
            }
            setResultGroups(groups)
        } catch {
            setError("Search not found")
        }
    }, [])

    const fetchHistory = useCallback(async () => {
        try {
            const data = await fetchFromApi("/api/discover/history")
            setHistory(data)
        } catch {
            // Silently fail for history
        }
    }, [])

    useEffect(() => {
        fetchHistory()
    }, [fetchHistory])

    // Load search from URL ?id= param on mount
    useEffect(() => {
        const id = searchParams.get("id")
        if (id) {
            loadSearchById(id)
        }
    }, [searchParams, loadSearchById])

    const handleReset = () => {
        setQuestion("")
        setSubmittedQuestion(null)
        setSubqueries([])
        setResultGroups([])
        setActiveSubquery("")
        setError(null)
        router.push("/discover")
    }

    const handleSearch = async () => {
        if (!question.trim() || loading) return

        const q = question.trim()
        setSubmittedQuestion(q)
        setLoading(true)
        setSubqueries([])
        setResultGroups([])
        setActiveSubquery("")
        setError(null)

        try {
            const stream = await fetchStreamFromApi("/api/discover/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question.trim() }),
            })

            const reader = stream.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })

                // Process complete chunks
                const chunks = buffer.split(END_DELIMITER)
                buffer = chunks.pop() || ""

                for (const chunk of chunks) {
                    const trimmed = chunk.trim()
                    if (!trimmed) continue

                    try {
                        const parsed = JSON.parse(trimmed)

                        if (parsed.type === "subqueries") {
                            setSubqueries(parsed.content)
                        } else if (parsed.type === "results") {
                            setActiveSubquery(parsed.subquery || "")
                            setResultGroups((prev) => [
                                ...prev,
                                {
                                    subquery: parsed.subquery || "",
                                    results: parsed.content || [],
                                },
                            ])
                        } else if (parsed.type === "done") {
                            if (parsed.search_id) {
                                router.replace(`/discover?id=${parsed.search_id}`)
                            }
                        } else if (parsed.type === "error") {
                            setError(parsed.content)
                        }
                    } catch {
                        // Skip unparseable chunks
                    }
                }
            }

            // Refresh history after successful search
            fetchHistory()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Search failed")
        } finally {
            setLoading(false)
            setActiveSubquery("")
        }
    }

    const handleHistorySelect = (search: DiscoverSearchHistory) => {
        router.push(`/discover?id=${search.id}`)
    }

    // Normalize title for comparison (lowercase, remove punctuation, collapse whitespace)
    const normalizeTitle = (title: string) =>
        title.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim()

    // Deduplicate by URL and similar titles
    const globalSeenUrls = new Set<string>()
    const globalSeenTitles = new Set<string>()
    const dedupedGroups = resultGroups.map((group) => {
        const dedupedResults = group.results.filter((r) => {
            if (globalSeenUrls.has(r.url)) return false
            const normalizedTitle = normalizeTitle(r.title)
            if (globalSeenTitles.has(normalizedTitle)) return false
            globalSeenUrls.add(r.url)
            globalSeenTitles.add(normalizedTitle)
            return true
        })
        return { ...group, results: dedupedResults }
    })

    const totalResults = dedupedGroups.reduce((sum, g) => sum + g.results.length, 0)

    // Subqueries that have received results (even if empty after dedup)
    const completedSubqueries = new Set(resultGroups.map((g) => g.subquery))

    const hasResults = submittedQuestion !== null

    return (
        <div className="w-full px-4 py-6 space-y-6 overflow-x-hidden">
            {!hasResults ? (
                <>
                    <DiscoverInput
                        value={question}
                        onChange={setQuestion}
                        onSubmit={handleSearch}
                        loading={loading}
                    />

                    {history.length > 0 && (
                        <div className="max-w-2xl mx-auto flex justify-center">
                            <DiscoverHistory searches={history} onSelect={handleHistorySelect} />
                        </div>
                    )}
                </>
            ) : (
                <>
                    {/* Results header */}
                    <div className="max-w-2xl mx-auto flex items-start justify-between gap-4">
                        <h1 className="text-xl font-semibold">{submittedQuestion}</h1>
                        {history.length > 0 && (
                            <DiscoverHistory searches={history} onSelect={handleHistorySelect} />
                        )}
                    </div>

                    {(subqueries.length > 0 || loading) && (
                        <div className="max-w-2xl mx-auto">
                            <SubqueryList
                                subqueries={subqueries}
                                loading={loading && subqueries.length === 0}
                                activeSubquery={activeSubquery}
                                completedSubqueries={completedSubqueries}
                            />
                        </div>
                    )}

                    {error && (
                        <div className="max-w-2xl mx-auto text-sm text-destructive bg-destructive/10 rounded-md p-3">
                            {error}
                        </div>
                    )}

                    {/* Results grouped by subquery */}
                    <div className="max-w-2xl mx-auto space-y-10">
                        {loading && resultGroups.length === 0 && subqueries.length > 0 && (
                            <div className="space-y-4">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="py-4 border-b border-slate-200 dark:border-slate-800">
                                        <Skeleton className="h-5 w-3/4 mb-2" />
                                        <Skeleton className="h-3 w-1/3 mb-2" />
                                        <Skeleton className="h-4 w-full mb-1" />
                                        <Skeleton className="h-4 w-2/3" />
                                    </div>
                                ))}
                            </div>
                        )}

                        {dedupedGroups.map((group) => {
                            if (group.results.length === 0) return null
                            return (
                                <div key={group.subquery}>
                                    <div className="bg-slate-100 dark:bg-slate-800/50 rounded-md px-3 py-2 mb-2">
                                        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                            {group.subquery}
                                        </h3>
                                    </div>
                                    <div>
                                        {group.results.map((result, idx) => (
                                            <DiscoverResultCard
                                                key={`${result.url}-${idx}`}
                                                result={result}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )
                        })}

                        {!loading && totalResults === 0 && subqueries.length > 0 && (
                            <div className="text-center text-muted-foreground py-8">
                                No results found. Try a different question.
                            </div>
                        )}
                    </div>

                    {/* Ask another question */}
                    {!loading && (
                        <div className="fixed bottom-6 right-6">
                            <Button onClick={handleReset} className="gap-2 shadow-lg">
                                <RotateCcw className="h-4 w-4" />
                                Ask another question
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

export default function DiscoverPage() {
    return (
        <Suspense fallback={<div className="w-full px-4 py-6">Loading...</div>}>
            <DiscoverPageContent />
        </Suspense>
    )
}
