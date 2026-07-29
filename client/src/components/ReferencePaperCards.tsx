import { useState, useEffect } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { Citation } from "@/lib/schema";
import { PaperItem } from "@/lib/schema";
import { groupConsecutiveNumbers } from "@/lib/utils";

interface ReferencePaperCardsProps {
    citations: Citation[];
    papers: PaperItem[];
    messageId?: string;
    messageIndex: number;
    highlightedPaper: string | null;
    onHighlightClear: () => void;
    onPaperClick?: (paper: PaperItem) => void;
}

export default function ReferencePaperCards({ citations, papers, messageId, messageIndex, highlightedPaper, onHighlightClear, onPaperClick }: ReferencePaperCardsProps) {
    const [expandedPaper, setExpandedPaper] = useState<string | null>(null);

    useEffect(() => {
        if (highlightedPaper) {
            const timer = setTimeout(() => {
                onHighlightClear();
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [highlightedPaper, onHighlightClear]);

    const toggleExpanded = (paperId: string) => {
        setExpandedPaper(expandedPaper === paperId ? null : paperId);
    };

    const paperCitationGroups = citations.reduce((acc, c) => {
        if (c.paper_id) {
            if (!acc[c.paper_id]) {
                acc[c.paper_id] = [];
            }
            acc[c.paper_id].push(c);
        }
        return acc;
    }, {} as Record<string, Citation[]>);

    return (
        <div className="mt-2 space-y-2">
            {Object.entries(paperCitationGroups).map(([paperId, paperCitations]) => {
                const paper = papers.find(p => p.id === paperId);
                if (!paper) return null;
                const citationNumbers = paperCitations.map(c => parseInt(c.key));
                const cardId = messageId ? `${messageId}-reference-paper-card-${paper.id}` : `${messageIndex}-reference-paper-card-${paper.id}`;
                const isHighlighted = highlightedPaper === paper.id;
                const isExpanded = expandedPaper === paper.id;

                return (
                    <div
                        key={`${paper.id}-${messageId || messageIndex}`}
                        id={cardId}
                        className={`rounded-md bg-card shadow-sm shadow-slate-950/[0.03] transition-colors duration-200 dark:shadow-black/20 ${isHighlighted
                            ? 'bg-blue-50/60 dark:bg-blue-900/15'
                            : 'hover:bg-muted/50'
                            }`}
                    >
                        <button
                            type="button"
                            onClick={() => toggleExpanded(paper.id)}
                            aria-expanded={isExpanded}
                            aria-controls={`${cardId}-details`}
                            className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)_1rem] items-start gap-2 px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        >
                            <span className="pt-px text-center text-xs leading-5 tabular-nums text-muted-foreground">
                                {groupConsecutiveNumbers(citationNumbers)}
                            </span>
                            <div
                                className="min-w-0 flex-1"
                            >
                                <span className="block truncate text-sm font-medium leading-5">{paper.title}</span>
                                {paper.authors && paper.authors.length > 0 && (
                                    <span className="block truncate text-xs leading-4 text-muted-foreground">
                                        {paper.authors.slice(0, 5).join(', ')}{paper.authors.length > 5 ? ' et al.' : ''}
                                    </span>
                                )}
                            </div>
                            <ChevronDown className={`mt-0.5 h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>

                        {isExpanded && (
                            <div id={`${cardId}-details`} className="mx-2 mb-2 rounded-sm bg-muted/50 px-3 pb-3 pt-2.5">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-xs text-muted-foreground">
                                        {paperCitations.length} {paperCitations.length === 1 ? 'citation' : 'citations'}
                                    </span>
                                    {onPaperClick && (
                                        <button
                                            type="button"
                                            onClick={() => onPaperClick(paper)}
                                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                        >
                                            View paper
                                            <BookOpen className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                                <div className="space-y-2.5">
                                {paperCitations.map((citation) => (
                                    <div key={citation.key} className="flex gap-2">
                                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0 leading-relaxed">
                                            [{citation.key}]
                                        </span>
                                        <span className="text-sm leading-5 text-foreground/90">
                                            {citation.reference}
                                        </span>
                                    </div>
                                ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
