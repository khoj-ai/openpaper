"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PaperItem } from "@/lib/schema";
import DataTableGenerationView from "@/components/DataTableGenerationView";
import { ColumnDefinition } from "@/components/DataTableSchemaModal";
import { Loader2, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PdfViewer } from "@/components/PdfViewer";
import { useIsMobile } from "@/lib/useMobile";

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
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState<string | null>(null);
    const [isPdfVisible, setIsPdfVisible] = useState(false);
    const isMobile = useIsMobile();

    useEffect(() => {
        // Simulate loading delay for realistic testing
        const timer = setTimeout(() => {
            setDataTable(mockDataTable);
            setPapers(mockPapers);
            setIsLoading(false);
        }, 500);

        return () => clearTimeout(timer);
    }, [projectId, tableId]);

    const handleCitationClick = (paperId: string, searchTerm: string) => {
        const paper = papers.find(p => p.id === paperId);
        if (paper && paper.file_url) {
            setPdfUrl(paper.file_url);
            setSearchTerm(searchTerm);
            setIsPdfVisible(true);
        }
    };

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
        <div className="flex flex-row w-full h-screen">
            <div className={`flex flex-col transition-all duration-500 ease-in-out ${isMobile ? (isPdfVisible ? 'hidden' : 'w-full') : (isPdfVisible ? 'w-1/2' : 'w-full')} overflow-y-auto`}>
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
                        onCitationClick={handleCitationClick}
                    />
                </div>
            </div>

            {isPdfVisible && (
                <div className={`${isMobile ? 'w-full fixed inset-0 z-50 bg-background' : 'w-1/2 border-l-2'} flex flex-col animate-in slide-in-from-right-5 duration-500 ease-in-out`}>
                    {isMobile && (
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-semibold">Paper Reference</h3>
                            <Button onClick={() => setIsPdfVisible(false)} variant="ghost" size="icon">
                                <X className="h-6 w-6" />
                            </Button>
                        </div>
                    )}
                    {!isMobile && (
                        <div className="flex items-center justify-end p-2 border-b">
                            <Button onClick={() => setIsPdfVisible(false)} variant="ghost" size="sm">
                                <X className="h-4 w-4 mr-2" />
                                Close
                            </Button>
                        </div>
                    )}
                    <div className="flex-grow transition-all duration-300 ease-in-out overflow-y-auto">
                        {pdfUrl && (
                            <PdfViewer
                                pdfUrl={pdfUrl}
                                explicitSearchTerm={searchTerm || undefined}
                                highlights={[]}
                                activeHighlight={null}
                                setUserMessageReferences={() => { }}
                                setSelectedText={() => { }}
                                setTooltipPosition={() => { }}
                                setIsAnnotating={() => { }}
                                setIsHighlightInteraction={() => { }}
                                isHighlightInteraction={false}
                                setHighlights={() => { }}
                                selectedText={''}
                                tooltipPosition={null}
                                setActiveHighlight={() => { }}
                                addHighlight={async () => { throw new Error("Read-only"); }}
                                loadHighlights={async () => { }}
                                removeHighlight={() => { }}
                                handleTextSelection={() => { }}
                                renderAnnotations={() => { }}
                                annotations={[]}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
