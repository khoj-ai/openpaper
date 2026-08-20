"use client";

import { useParams } from "next/navigation";
import { ProjectChartDetail } from "@/components/ProjectChartDetail";

export default function ProjectChartPage() {
    const params = useParams();
    return <ProjectChartDetail artifactId={params.artifactId as string} />;
}
