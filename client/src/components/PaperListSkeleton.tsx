import { Skeleton } from "@/components/ui/skeleton";

interface PaperListSkeletonProps {
    count?: number;
}

export function PaperListSkeleton({ count = 3 }: PaperListSkeletonProps) {
    return (
        <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: count }).map((_, index) => (
                <div
                    key={index}
                    className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                    <Skeleton className="h-5 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-1/2 mb-2" />
                    <Skeleton className="h-3 w-1/4" />
                </div>
            ))}
        </div>
    );
}
