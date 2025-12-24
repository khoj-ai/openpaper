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
}

export default function ReferencePaperCards({ citations, papers, messageId, messageIndex, highlightedPaper, onHighlightClear }: ReferencePaperCardsProps) {
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
        <div className="my-0 space-y-4">
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
                            className="flex items-start gap-3 pb-3 border-b cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => toggleExpanded(paper.id)}
                        >
                            <div className="flex-shrink-0 bg-secondary rounded-lg px-2 py-1">
                                <span className="text-xs font-bold text-gray-500">{groupConsecutiveNumbers(citationNumbers)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm line-clamp-2 mt-0 mb-0">{paper.title}</p>
                                {paper.authors && paper.authors.length > 0 && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {paper.authors.slice(0, 5).join(', ')}{paper.authors.length > 5 ? ' et al.' : ''}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Citations - Expandable */}
                        {isExpanded && (
                            <div className="space-y-2">
                                {paperCitations.map((citation) => (
                                    <div
                                        key={citation.key}
                                        className="p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                                    >
                                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 mr-2">
                                            [{citation.key}]
                                        </span>
                                        <span className="text-sm text-foreground">{citation.reference}</span>
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
