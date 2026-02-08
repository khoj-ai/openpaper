"use client"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface SubqueryListProps {
    subqueries: string[]
    loading: boolean
    activeSubquery?: string
    completedSubqueries?: Set<string>
}

export default function SubqueryList({ subqueries, loading, activeSubquery, completedSubqueries }: SubqueryListProps) {
    if (loading && subqueries.length === 0) {
        return (
            <div className="flex flex-wrap gap-2">
                {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-7 w-40 rounded-full" />
                ))}
            </div>
        )
    }

    const pendingSubqueries = subqueries.filter((sq) => !completedSubqueries?.has(sq))

    if (subqueries.length === 0 || pendingSubqueries.length === 0) return null

    return (
        <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Searching for:</p>
            <div className="flex flex-wrap gap-2">
                {pendingSubqueries.map((sq, i) => (
                    <Badge
                        key={i}
                        variant={activeSubquery === sq ? "default" : "secondary"}
                        className="text-xs"
                    >
                        {sq}
                    </Badge>
                ))}
            </div>
        </div>
    )
}
