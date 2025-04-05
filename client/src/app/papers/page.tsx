"use client"

import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchFromApi } from "@/lib/api"
import { useEffect, useState } from "react"
import { PaperItem } from "@/components/AppSidebar"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"


export default function PapersPage() {
    const [papers, setPapers] = useState<PaperItem[]>([])

    useEffect(() => {
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all")
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setPapers(sortedPapers);
            } catch (error) {
                console.error("Error fetching papers:", error)
            }
        }

        fetchPapers()
    }, [])

    const deletePaper = async (paperId: string) => {
        try {
            await fetchFromApi(`/api/paper?id=${paperId}`, {
                method: "DELETE",
            })
            setPapers(papers.filter((paper) => paper.id !== paperId))
        } catch (error) {
            console.error("Error deleting paper:", error)
        }
    }

    const handleDelete = (paperId: string) => {
        if (confirm("Are you sure you want to delete this paper?")) {
            deletePaper(paperId)
        }
    }

    return (
        <div className="container mx-auto p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {papers.map((paper) => (
                    <Card key={paper.id}>
                        <CardHeader>
                            <a
                                href={`/paper/${paper.id}`}
                                className="hover:underline"
                            >
                                {paper.title || paper.filename}
                            </a>
                        </CardHeader>
                        <CardFooter className="flex flex-row justify-between items-start">
                            <p className="text-sm text-gray-500">
                                {new Date(paper.created_at || "").toLocaleDateString()}
                            </p>
                            <Button
                            variant={"ghost"}
                                onClick={() => handleDelete(paper.id)}
                            >
                                <Trash2 size={16} className="text-secondary-foreground" />
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </div>
    )
}
