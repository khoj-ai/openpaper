import { useState, useEffect } from "react";
import { Citation } from "@/lib/schema";
import { PaperItem } from "@/lib/schema";
import PaperCard from "./PaperCard";
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
        <div className="my-0">
            {Object.entries(paperCitationGroups).map(([paperId, paperCitations]) => {
                const paper = papers.find(p => p.id === paperId);
                if (!paper) return null;
                const citationNumbers = paperCitations.map(c => parseInt(c.key));
                const cardId = messageId ? `${messageId}-reference-paper-card-${paper.id}` : `${messageIndex}-reference-paper-card-${paper.id}`;
                const isHighlighted = highlightedPaper === paper.id;

                return (
                    <div
                        key={`${paper.id}-${messageId || messageIndex}`}
                        className={`flex flex-col w-full items-start py-2 gap-2 transition-all duration-500 ${isHighlighted ? 'bg-blue-100 dark:bg-blue-900/30 rounded-lg' : ''}`}
                        id={cardId}
                    >
                        <div className="flex flex-col items-center cursor-pointer bg-secondary rounded-lg p-1" onClick={() => toggleExpanded(paper.id)}>
                            <span className="text-xs font-bold text-gray-500">{groupConsecutiveNumbers(citationNumbers)}</span>
                        </div>
                        <div className="w-full">
                            <PaperCard paper={paper} minimalist={true} />
                            {expandedPaper === paper.id && (
                                <div className="p-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-b-lg expand-height">
                                    {paperCitations.map(c => (
                                        <p key={c.key} className="mb-2">[{c.key}] {c.reference}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
