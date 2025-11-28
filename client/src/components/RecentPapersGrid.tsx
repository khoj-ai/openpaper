"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Clock } from "lucide-react";
import { fetchFromApi } from "@/lib/api";
import { PaperItem } from "@/lib/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

interface RecentPapersGridProps {
    papers?: PaperItem[];
    limit?: number;
}

function PaperCardCompact({ paper }: { paper: PaperItem }) {
    const createdAt = paper.created_at ? formatDate(paper.created_at) : null;

    return (
        <Link
            href={`/paper/${paper.id}`}
            className="group flex flex-col rounded-xl border border-border/50 bg-card hover:border-border hover:shadow-sm transition-all h-full overflow-hidden"
        >
            {paper.preview_url ? (
                <div className="relative w-full aspect-[4/3] bg-muted">
                    <img
                        src={paper.preview_url}
                        alt={paper.title || "Paper preview"}
                        className="w-full h-full object-cover"
                    />
                </div>
            ) : (
                <div className="flex items-start justify-between gap-2 p-4 pb-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex-shrink-0">
                        <FileText className="h-4 w-4" />
                    </div>
                </div>
            )}

            <div className={`flex flex-col flex-1 ${paper.preview_url ? "p-4" : "px-4 pb-4"}`}>
                <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors flex-1">
                    {paper.title || "Untitled Paper"}
                </h3>

                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                    {paper.authors && paper.authors.length > 0 && (
                        <span className="truncate">
                            {paper.authors[0]}
                            {paper.authors.length > 1 && ` +${paper.authors.length - 1}`}
                        </span>
                    )}
                </div>

                {createdAt && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {createdAt}
                    </div>
                )}
            </div>
        </Link>
    );
}

function PaperCardSkeleton() {
    return (
        <div className="flex flex-col p-4 rounded-xl border border-border/50 bg-card h-full">
            <div className="flex items-start justify-between gap-2 mb-2">
                <Skeleton className="w-8 h-8 rounded-lg" />
                <Skeleton className="w-6 h-4" />
            </div>
            <Skeleton className="h-4 w-full mb-1" />
            <Skeleton className="h-4 w-3/4 mb-3" />
            <Skeleton className="h-3 w-1/2 mt-auto" />
        </div>
    );
}

export function RecentPapersGrid({ papers: propPapers, limit = 6 }: RecentPapersGridProps) {
    const [papers, setPapers] = useState<PaperItem[]>(propPapers || []);
    const [isLoading, setIsLoading] = useState(!propPapers);

    useEffect(() => {
        if (propPapers) {
            setPapers(propPapers.slice(0, limit));
            setIsLoading(false);
            return;
        }

        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/relevant");
                setPapers((response?.papers || []).slice(0, limit));
            } catch (error) {
                console.error("Error fetching papers:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPapers();
    }, [propPapers, limit]);

    if (isLoading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-24" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(limit)].map((_, i) => (
                        <PaperCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        );
    }

    if (papers.length === 0) {
        return null; // Don't show section if no papers
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-500" />
                    <h2 className="text-lg font-semibold">Recent Papers</h2>
                </div>
                <Link
                    href="/papers"
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                    View library
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {papers.map((paper) => (
                    <PaperCardCompact key={paper.id} paper={paper} />
                ))}
            </div>
        </div>
    );
}
