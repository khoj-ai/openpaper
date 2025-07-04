"use client"

import { fetchFromApi } from "@/lib/api";
import { useEffect, useState } from "react";
import { PaperItem } from "@/components/AppSidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PaperCard from "@/components/PaperCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { FileText, Upload, Search } from "lucide-react";
import Link from "next/link";

// TODO: We could add a search look-up for the paper journal name to avoid placeholders

export default function PapersPage() {
    const [papers, setPapers] = useState<PaperItem[]>([]);
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [filteredPapers, setFilteredPapers] = useState<PaperItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const { user, loading: authLoading } = useAuth();

    useEffect(() => {
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all")
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setPapers(sortedPapers)
                setFilteredPapers(sortedPapers)
            } catch (error) {
                console.error("Error fetching papers:", error)
            } finally {
                setLoading(false);
            }
        }

        fetchPapers()
    }, [])

    useEffect(() => {
        if (!authLoading && !user) {
            // Redirect to login if user is not authenticated
            window.location.href = `/login`;
        }
    }, [authLoading, user]);

    const deletePaper = async (paperId: string) => {
        try {
            await fetchFromApi(`/api/paper?id=${paperId}`, {
                method: "DELETE",
            })
            setPapers(papers.filter((paper) => paper.id !== paperId));
            setFilteredPapers(filteredPapers.filter((paper) => paper.id !== paperId));
        } catch (error) {
            console.error("Error deleting paper:", error)
        }
    }

    const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
        const term = event.target.value.toLowerCase()
        setSearchTerm(term)
        setFilteredPapers(
            papers.filter((paper) =>
                paper.title?.toLowerCase().includes(term) ||
                paper.keywords?.some((keyword) => keyword.toLowerCase().includes(term)) ||
                paper.abstract?.toLowerCase().includes(term) ||
                paper.authors?.some((author) => author.toLowerCase().includes(term)) ||
                paper.institutions?.some((institution) => institution.toLowerCase().includes(term)) ||
                paper.summary?.toLowerCase().includes(term)
            )
        )
    }

    const handlePaperSet = (paperId: string, paper: PaperItem) => {
        setPapers((prevPapers) =>
            prevPapers.map((p) => (p.id === paperId ? { ...p, ...paper } : p))
        )
        setFilteredPapers((prevFiltered) =>
            prevFiltered.map((p) => (p.id === paperId ? { ...p, ...paper } : p))
        )
    }

    const EmptyState = () => {
        // No papers uploaded at all
        if (papers.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-16 w-16 text-muted-foreground mb-6" />
                    <h3 className="text-xl font-medium text-foreground mb-3">Your paper library is empty</h3>
                    <p className="text-muted-foreground max-w-md mb-6">
                        Upload your first research paper to get started. All your papers will appear here for easy access and organization.
                    </p>
                    <Link href="/">
                        <Button className="inline-flex items-center gap-2">
                            <Upload className="h-4 w-4" />
                            Upload papers
                        </Button>
                    </Link>
                </div>
            );
        }

        // Has papers but search/filter returned no results
        if (papers.length > 0 && filteredPapers.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Search className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No papers found</h3>
                    <p className="text-muted-foreground max-w-md">
                        No papers match your search criteria. Try adjusting your search terms.
                    </p>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setSearchTerm("")
                            setFilteredPapers(papers);
                        }}
                        className="mt-4"
                    >
                        Clear search
                    </Button>
                </div>
            );
        }

        return null;
    }

    if (loading) {
        return (
            <div className="container mx-auto sm:w-2/3 p-8">
                <Skeleton className="h-10 w-full mb-4" />
                <div className="grid grid-cols-1 gap-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-24 w-full" />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto sm:w-2/3 p-8">
            {papers.length > 0 && (
                <div className="mb-6">
                    <Input
                        type="text"
                        placeholder="Search your paper bank"
                        value={searchTerm}
                        onChange={handleSearch}
                        className="w-full"
                    />
                </div>
            )}

            {filteredPapers.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                    {filteredPapers.map((paper) => (
                        <PaperCard
                            key={paper.id}
                            paper={paper}
                            handleDelete={deletePaper}
                            setPaper={handlePaperSet}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState />
            )}
        </div>
    )
}
