import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectPageSkeleton() {
    return (
        <div className="container mx-auto p-4">
            {/* Breadcrumb Skeleton */}
            <div className="mb-4">
                <Skeleton className="h-4 w-48" />
            </div>

            {/* Project Header Skeleton */}
            <div className="group relative mb-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                        <Skeleton className="h-9 w-64 mb-2" />
                        <Skeleton className="h-6 w-96 max-w-full" />
                    </div>
                    {/* Collaborators skeleton */}
                    <div className="flex -space-x-2">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 -mx-4">
                {/* Left side - Conversations Skeleton */}
                <div className="w-full lg:w-2/3 px-4 space-y-6">
                    {/* Conversation Input Skeleton */}
                    <Skeleton className="h-[80px] w-full rounded-md" />

                    {/* Conversations List Skeleton */}
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <Skeleton className="h-8 w-20" />
                        </div>
                        <div className="space-y-4">
                            <Skeleton className="h-20 w-full rounded-lg" />
                            <Skeleton className="h-20 w-full rounded-lg" />
                            <Skeleton className="h-20 w-full rounded-lg" />
                        </div>
                    </div>

                    {/* Artifacts Skeleton */}
                    <div className="mt-8">
                        <div className="flex justify-between items-center mb-4">
                            <Skeleton className="h-8 w-24" />
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <Skeleton className="h-9 w-36 rounded-md" />
                            <Skeleton className="h-9 w-28 rounded-md" />
                        </div>
                    </div>
                </div>

                {/* Right side - Papers Skeleton */}
                <div className="w-full lg:w-1/3 px-4 space-y-4">
                    <div className="flex justify-between items-center mb-4">
                        <Skeleton className="h-8 w-20" />
                        <Skeleton className="h-9 w-20 rounded-md" />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <Skeleton className="h-24 w-full rounded-lg" />
                        <Skeleton className="h-24 w-full rounded-lg" />
                        <Skeleton className="h-24 w-full rounded-lg" />
                    </div>
                </div>
            </div>
        </div>
    );
}
