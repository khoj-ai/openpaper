import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectPageSkeleton() {
    return (
        <div className="container mx-auto p-4">
            {/* Breadcrumb Skeleton */}
            <div className="mb-4">
                <Skeleton className="h-4 w-1/4" />
            </div>

            {/* Project Header Skeleton */}
            <div className="group relative mb-6">
                <Skeleton className="h-9 w-1/2 mb-2" />
                <Skeleton className="h-6 w-3/4" />
            </div>

            <div className="flex gap-6 -mx-4">
                {/* Left side - Conversations Skeleton */}
                <div className="w-2/3 px-4 space-y-6">
                    {/* Conversation Input Skeleton */}
                    <Skeleton className="h-24 w-full" />

                    {/* Conversations List Skeleton */}
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <Skeleton className="h-8 w-1/4" />
                        </div>
                        <div className="space-y-4">
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                    </div>
                </div>

                {/* Right side - Papers Skeleton */}
                <div className="w-1/3 px-4 space-y-4">
                    <div className="flex justify-between items-center mb-4">
                        <Skeleton className="h-8 w-1/4" />
                        <Skeleton className="h-10 w-24" />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-24 w-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}
