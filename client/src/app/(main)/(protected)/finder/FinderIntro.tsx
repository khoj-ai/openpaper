"use client";

import { Globe2, Search, Filter, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface ExampleBadgeProps {
    children: React.ReactNode
    onClick?: () => void
}

function ExampleBadge({ children, onClick }: ExampleBadgeProps) {
    return (
        <Badge
            variant="secondary"
            className="font-normal text-xs py-1.5 px-3 hover:bg-secondary/80 cursor-pointer transition-colors"
            onClick={onClick}
        >
            {children}
        </Badge>
    )
}

interface FinderIntroProps {
    onExampleClick: (example: string) => void
    onExampleFilterClick: (filter: string) => void
}

export function FinderIntro({ onExampleClick, onExampleFilterClick }: FinderIntroProps) {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center max-w-2xl mx-auto min-h-[60vh]">
            <h2 className="text-2xl font-bold text-foreground mb-3">
                Discover Research Papers
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md">
                Search millions of open access papers by topic, title, or author.
            </p>

            {/* Examples Section */}
            <div className="mb-12 w-full max-w-lg">
                <p className="text-sm text-muted-foreground mb-3">Try these examples</p>
                <div className="flex flex-wrap gap-2 justify-center">
                    <ExampleBadge onClick={() => onExampleClick("Attention is All You Need")}>
                        Attention is All You Need
                    </ExampleBadge>
                    <ExampleBadge onClick={() => onExampleClick("large language models")}>
                        large language models
                    </ExampleBadge>
                    <ExampleBadge onClick={() => onExampleClick("climate change impact")}>
                        climate change impact
                    </ExampleBadge>
                    <ExampleBadge onClick={() => onExampleFilterClick("University of Illinois")}>
                        Filter: University of Illinois
                    </ExampleBadge>
                </div>
            </div>

            {/* Feature highlights */}
            <div className="flex items-center justify-center gap-8 text-blue-500 mb-8">
                <div className="flex flex-col items-center gap-1 max-w-24">
                    <Search className="h-5 w-5" />
                    <span className="text-xs font-medium text-foreground">Search</span>
                    <span className="text-xs text-muted-foreground text-center">By topic or title</span>
                </div>
                <div className="flex flex-col items-center gap-1 max-w-24">
                    <Filter className="h-5 w-5" />
                    <span className="text-xs font-medium text-foreground">Filter</span>
                    <span className="text-xs text-muted-foreground text-center">By institution or author</span>
                </div>
                <div className="flex flex-col items-center gap-1 max-w-24">
                    <Globe2 className="h-5 w-5" />
                    <span className="text-xs font-medium text-foreground">Open Access</span>
                    <span className="text-xs text-muted-foreground text-center">Free to read and save</span>
                </div>
            </div>

            {/* Powered by */}
            <p className="text-xs text-muted-foreground">
                Powered by{" "}
                <Link
                    href="https://openalex.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                    OpenAlex
                    <ExternalLink className="h-3 w-3" />
                </Link>
            </p>
        </div>
    );
}
