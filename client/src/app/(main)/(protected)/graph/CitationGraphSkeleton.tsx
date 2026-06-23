import { Skeleton } from "@/components/ui/skeleton";

export function CitationGraphSkeleton() {
    return (
        <div className="space-y-6">
            {/* Paper Card Skeleton */}
            <div className="bg-card border rounded-xl p-6 space-y-4">
                {/* Title row with icon */}
                <div className="flex items-start gap-3">
                    <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-3/4" />
                    </div>
                </div>

                {/* Authors */}
                <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-32" />
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap gap-3">
                    <Skeleton className="h-7 w-32 rounded" />
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-12" />
                </div>

                {/* Abstract */}
                <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                </div>
            </div>

            {/* Tabs Skeleton */}
            <Skeleton className="h-10 w-64 rounded-lg" />

            {/* Papers List Skeleton */}
            <div className="bg-card border rounded-xl overflow-hidden">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div
                        key={i}
                        className={`p-4 space-y-3 ${i < 5 ? "border-b" : ""}`}
                    >
                        {/* Paper title */}
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-4/5" />

                        {/* Authors */}
                        <Skeleton className="h-4 w-1/2" />

                        {/* Meta */}
                        <div className="flex gap-3">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-3 w-12" />
                            <Skeleton className="h-3 w-20" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
