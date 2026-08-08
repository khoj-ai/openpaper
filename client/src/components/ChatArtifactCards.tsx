import { ChatArtifact, CitationArtifact } from "@/lib/schema";
import { CitationArtifactCard } from "@/components/CitationArtifactCard";
import { ChartArtifactCard } from "@/components/ChartArtifactCard";

export function ChatArtifactCards({ artifacts }: { artifacts: ChatArtifact[] }) {
    const citations = artifacts.filter((artifact): artifact is CitationArtifact => artifact.kind === "citation");
    return <>
        {citations.length > 0 && <CitationArtifactCard artifacts={citations} />}
        {artifacts.filter(artifact => artifact.kind === "chart").map(artifact => <ChartArtifactCard key={artifact.plan.title} artifact={artifact} />)}
    </>;
}
