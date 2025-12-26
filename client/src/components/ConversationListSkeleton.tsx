import { Skeleton } from "@/components/ui/skeleton";

interface ConversationListSkeletonProps {
    count?: number;
}

export function ConversationListSkeleton({ count = 3 }: ConversationListSkeletonProps) {
    return (
        <div className="space-y-4">
            {Array.from({ length: count }).map((_, index) => (
                <div
                    key={index}
                    className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                    <div className="flex items-start justify-between">
                        <div className="flex flex-col flex-1">
                            <Skeleton className="h-5 w-48 mb-2" />
                            <Skeleton className="h-4 w-24" />
                        </div>
                        <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}
