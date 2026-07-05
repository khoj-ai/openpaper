import { useState, useEffect } from "react";
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
        <div className="mt-3 space-y-3">
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
                        className={`space-y-3 p-4 rounded-lg border transition-all duration-500 ${isHighlighted
                            ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
                            : 'bg-card border-border'
                            }`}
                    >
                        {/* Paper Info - Clickable */}
                        <div
                            className={`flex items-start gap-3 ${isExpanded ? 'border-b pb-3' : ''}`}
                        >
                            <div
                                className="flex-shrink-0 bg-secondary rounded-lg px-2 py-1 cursor-pointer hover:bg-secondary/80 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpanded(paper.id);
                                }}
                            >
                                <span className="text-xs font-bold text-gray-500">{groupConsecutiveNumbers(citationNumbers)}</span>
                            </div>
                            <div
                                className="flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => {
                                    // file_url is loaded lazily by the click handler,
                                    // so don't gate the click on it being present.
                                    if (onPaperClick) {
                                        onPaperClick(paper);
                                    }
                                }}
                            >
                                <p className="font-medium text-sm line-clamp-2 mt-0 mb-0">{paper.title}</p>
                                {paper.authors && paper.authors.length > 0 && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {paper.authors.slice(0, 5).join(', ')}{paper.authors.length > 5 ? ' et al.' : ''}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Citations - Expandable. A clean hanging-indent list
                            rather than a stack of filled boxes. */}
                        {isExpanded && (
                            <div className="space-y-3">
                                {paperCitations.map((citation) => (
                                    <div key={citation.key} className="flex gap-2.5">
                                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0 leading-relaxed">
                                            [{citation.key}]
                                        </span>
                                        <span className="text-sm leading-relaxed text-foreground/90">
                                            {citation.reference}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
