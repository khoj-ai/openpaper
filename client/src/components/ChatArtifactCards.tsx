import { ChartArtifact, ChatArtifact, CitationArtifact } from "@/lib/schema";
import { CitationArtifactCard } from "@/components/CitationArtifactCard";
import { ChartArtifactCard } from "@/components/ChartArtifactCard";

/** Viewer-page links for the chart artifacts in a message, in the order those
 * cards render. A chart still streaming has no id yet and stays unlinked until
 * the conversation is next loaded. */
export function chartViewerHrefs(artifacts: ChatArtifact[], projectId?: string): string[] {
    return artifacts
        .filter((artifact): artifact is ChartArtifact => artifact.kind === "chart")
        .map(artifact =>
            projectId && artifact.artifact_id
                ? `/projects/${projectId}/charts/${artifact.artifact_id}`
                : "",
        );
}

export function ChatArtifactCards({ artifacts, onOpenPaper, chatHref, chartDetailHrefs }: {
    artifacts: ChatArtifact[];
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
    chatHref?: string;
    chartDetailHrefs?: string[];
}) {
    const citations = artifacts.filter((artifact): artifact is CitationArtifact => artifact.kind === "citation");
    return <>
        {citations.length > 0 && <CitationArtifactCard artifacts={citations} />}
        {artifacts.filter(artifact => artifact.kind === "chart").map((artifact, index) => <ChartArtifactCard key={artifact.plan.title} artifact={artifact} onOpenPaper={onOpenPaper} chatHref={chatHref} detailHref={chartDetailHrefs?.[index] || undefined} />)}
    </>;
}
