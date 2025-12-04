"use client";

import { Globe2, Sparkles, FileText, ExternalLink, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

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
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center max-w-3xl mx-auto">
            {/* Floating Icon Group */}
            <div className="relative mb-8">
                <div className="relative w-32 h-32 mx-auto">
                    {/* Background gradient circle */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-primary/5 to-transparent rounded-full blur-2xl" />

                    {/* Main icon container */}
                    <div className="relative w-full h-full bg-gradient-to-br from-blue-500/5 to-primary/10 dark:from-blue-500/10 dark:to-primary/20 rounded-2xl flex items-center justify-center border border-blue-500/10 shadow-sm">
                        <Globe2 className="w-14 h-14 text-primary" strokeWidth={1.5} />
                    </div>

                    {/* Floating accent icons */}
                    <div className="absolute -top-2 -right-2 w-12 h-12 bg-background dark:bg-card rounded-xl flex items-center justify-center border border-blue-500/20 shadow-md">
                        <Sparkles className="w-6 h-6 text-blue-500" strokeWidth={2} />
                    </div>
                    <div className="absolute -bottom-1 -left-2 w-10 h-10 bg-background dark:bg-card rounded-lg flex items-center justify-center border border-border shadow-md">
                        <FileText className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
                    </div>
                </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground mb-3">
                Explore the World of Research
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md">
                Discover academic papers by topic, title, or author. We tap into a vast public database to bring you relevant research.
            </p>

            {/* Examples Section */}
            <div className="bg-muted/20 dark:bg-muted/5 p-4 rounded-lg w-full max-w-lg">
                <h3 className="text-sm font-semibold text-foreground mb-3">Try these examples</h3>
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

            {/* Footer Section */}
            <div className="mt-12 pt-8 border-t border-border/50 w-full max-w-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">Powered by</span>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                        <Link href="https://openalex.org" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                            OpenAlex
                            <ExternalLink className="h-3 w-3" />
                        </Link>
                    </Button>
                </div>

                <Button variant="outline" size="sm" className="text-xs" asChild>
                    <Link href="https://github.com/khoj-ai/openpaper/issues" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                        <Github className="h-3 w-3" />
                        Feedback & Issues
                    </Link>
                </Button>
            </div>
        </div>
    );
}
