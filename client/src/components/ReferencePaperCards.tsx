
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
                return <PaperCard key={paper.id} paper={paper} />;
            })}
        </div>
    );
}
