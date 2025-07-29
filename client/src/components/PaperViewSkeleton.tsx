import { Skeleton } from "@/components/ui/skeleton";

export default function PaperViewSkeleton() {
    return (
        <div className="flex flex-row w-full h-[calc(100vh-64px)]">
            <div className="w-full h-full flex items-center justify-center gap-0">
                {/* PDF Viewer Skeleton */}
                <div
                    className="border-r-2 dark:border-gray-800 border-gray-200 p-4 h-full w-3/5"
                >
                    <Skeleton className="h-full w-full" />
                </div>

                {/* Resizable Divider Skeleton */}
                <div
                    className="w-2 bg-gray-200 dark:bg-gray-800 h-full rounded-2xl"
                />

                {/* Right Side Panel Skeleton */}
                <div
                    className="flex flex-col h-full relative p-4 w-2/5 space-y-4"
                >
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-48 w-full" />
                    <div className="flex-grow" />
                    <Skeleton className="h-16 w-full" />
                </div>
            </div >
        </div >
    );
}
