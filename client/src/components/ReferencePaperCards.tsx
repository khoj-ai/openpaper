
import { Citation } from "@/lib/schema";
import { PaperItem } from "./AppSidebar";
import PaperCard from "./PaperCard";

interface ReferencePaperCardsProps {
    citations: Citation[];
    papers: PaperItem[];
}

export default function ReferencePaperCards({ citations, papers }: ReferencePaperCardsProps) {
    const paperIds = [...new Set(citations.map(c => c.paper_id).filter(id => id !== undefined))];

    return (
        <div className="my-4">
            {paperIds.map(paperId => {
                const paper = papers.find(p => p.id === paperId);
                if (!paper) return null;
                const paperCitations = citations.filter(c => c.paper_id === paperId);
                return (
                    <div key={paper.id} className="flex items-start gap-2">
                        <div className="flex flex-col items-center">
                            {paperCitations.map(c => (
                                <span key={c.key} className="text-xs font-bold text-gray-500">[{c.key}]</span>
                            ))}
                        </div>
                        <PaperCard paper={paper} minimalist={true} />
                    </div>
                );
            })}
        </div>
    );
}
