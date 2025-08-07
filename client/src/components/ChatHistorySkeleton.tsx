
import { Skeleton } from "@/components/ui/skeleton";

export function ChatHistorySkeleton() {
    return (
        <div className="space-y-4 p-4">
            <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-6 w-1/4" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            </div>
            <div className="flex items-end gap-2 justify-end">
                <div className="flex-1 space-y-2 max-w-md">
                    <Skeleton className="h-6 w-1/4 ml-auto" />
                    <Skeleton className="h-4 w-full" />
                </div>
            </div>
            <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-6 w-1/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-5/6" />
                </div>
            </div>
        </div>
    );
}
