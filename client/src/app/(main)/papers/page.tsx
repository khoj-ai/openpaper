"use client"

import { fetchFromApi } from "@/lib/api";
import { useEffect, useState } from "react";
import { PaperItem } from "@/components/AppSidebar";
import { Input } from "@/components/ui/input";
import PaperCard from "@/components/PaperCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

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
                paper.filename?.toLowerCase().includes(term) ||
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
            <div className="mb-4">
                <Input
                    type="text"
                    placeholder="Search your paper bank"
                    value={searchTerm}
                    onChange={handleSearch}
                    className="w-full p-2 border border-gray-300 rounded"
                />
            </div>
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
        </div>
    )
}
