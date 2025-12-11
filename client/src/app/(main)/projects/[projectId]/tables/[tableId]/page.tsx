"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PaperItem } from "@/lib/schema";
import DataTableGenerationView from "@/components/DataTableGenerationView";
import { ColumnDefinition } from "@/components/DataTableSchemaModal";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface DataTable {
    id: string;
    project_id: string;
    columns: ColumnDefinition[];
    created_at: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
}

// Mock data for testing
const mockDataTable: DataTable = {
    id: "table-1",
    project_id: "project-1",
    columns: [
        {
            id: "col-1",
            label: "Sample Size",
            type: "number"
        },
        {
            id: "col-2",
            label: "Study Type",
            type: "string"
        },
        {
            id: "col-3",
            label: "Publication Year",
            type: "number"
        },
        {
            id: "col-4",
            label: "Conclusion",
            type: "string"
        }
    ],
    created_at: new Date().toISOString(),
    status: 'completed'
};

const mockPapers: PaperItem[] = [
    {
        id: "paper-1",
        title: "Deep Learning Approaches to Natural Language Processing",
        authors: ["Smith, J.", "Johnson, A."],
        abstract: "This paper explores various deep learning architectures for NLP tasks...",
        file_url: "/sample1.pdf",
        created_at: new Date().toISOString(),
    },
    {
        id: "paper-2",
        title: "Transformers in Computer Vision: A Survey",
        authors: ["Chen, L.", "Wang, M.", "Li, X."],
        abstract: "A comprehensive survey of transformer-based models in computer vision applications...",
        file_url: "/sample2.pdf",
        created_at: new Date().toISOString(),
    },
    {
        id: "paper-3",
        title: "Neural Architecture Search for Image Classification",
        authors: ["Brown, T.", "Davis, K."],
        abstract: "Automated methods for discovering optimal neural network architectures...",
        file_url: "/sample3.pdf",
        created_at: new Date().toISOString(),
    }
];

export default function DataTablePage() {
    const params = useParams();
    const router = useRouter();
    const projectId = params.projectId as string;
    const tableId = params.tableId as string;

    const [dataTable, setDataTable] = useState<DataTable | null>(null);
    const [papers, setPapers] = useState<PaperItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Simulate loading delay for realistic testing
        const timer = setTimeout(() => {
            setDataTable(mockDataTable);
            setPapers(mockPapers);
            setIsLoading(false);
        }, 500);

        return () => clearTimeout(timer);
    }, [projectId, tableId]);

    const handleClose = () => {
        router.push(`/projects/${projectId}`);
    };

    if (isLoading) {
        return (
            <div className="container mx-auto py-8 px-4 max-w-7xl">
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        <p className="text-muted-foreground">Loading data table...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !dataTable) {
        return (
            <div className="container mx-auto py-8 px-4 max-w-7xl">
                <div className="mb-6">
                    <Button
                        variant="ghost"
                        onClick={handleClose}
                        className="mb-4"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Project
                    </Button>
                </div>
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="text-center">
                        <p className="text-red-600 dark:text-red-400 mb-4">
                            {error || "Data table not found"}
                        </p>
                        <Button onClick={handleClose}>
                            Return to Project
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto py-8 px-4 max-w-7xl">
            <div className="mb-6">
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink href={`/projects/${projectId}`}>
                                Project
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Data Table</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </div>

            <DataTableGenerationView
                columns={dataTable.columns}
                papers={papers}
                onClose={handleClose}
            />
        </div>
    );
}
