"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { fetchFromApi } from "@/lib/api"
import { useEffect, useState } from "react"
import { PaperItem } from "@/components/AppSidebar"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"


export default function PapersPage() {
    const [papers, setPapers] = useState<PaperItem[]>([])
    const [searchTerm, setSearchTerm] = useState<string>("")
    const [filteredPapers, setFilteredPapers] = useState<PaperItem[]>([])

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
            }
        }

        fetchPapers()
    }, [])

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


    return (
        <div className="container mx-auto w-1/2 p-8">
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
                    <Card key={paper.id}>
                        <CardHeader>
                            <a
                                href={`/paper/${paper.id}`}
                                className="hover:underline"
                            >
                                {paper.title || paper.filename}
                            </a>
                        </CardHeader>
                        <CardContent>
                            <CardDescription>
                                {
                                    paper.keywords && paper.keywords.length > 0 && (
                                        <div className="mb-2 flex flex-wrap gap-2">
                                            {
                                                paper.keywords.map((keyword, index) => (
                                                    <span
                                                        key={index}
                                                        className="inline-block bg-blue-200 dark:bg-blue-800 text-sm font-semibold mr-2 px-2.5 py-0.5 rounded"
                                                    >
                                                        {keyword}
                                                    </span>
                                                ))
                                            }
                                        </div>
                                    )
                                }
                                {
                                    paper.authors && (
                                        <p className="text-sm text-gray-500 mb-2">
                                            {paper.authors.slice(0, 5).join(", ")}
                                            {paper.authors.length > 5 && `, et al.`}
                                        </p>
                                    )
                                }
                            </CardDescription>
                            {paper.abstract && (
                                <p className="text-sm text-gray-500 line-clamp-3">
                                    {paper.abstract}
                                </p>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-row justify-between items-start">
                            <p className="text-sm text-gray-500">
                                {new Date(paper.created_at || "").toLocaleDateString()}
                            </p>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant={"ghost"}
                                    >
                                        <Trash2 size={16} className="text-secondary-foreground" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogTitle>Delete Paper</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to delete {paper.title || paper.filename}?
                                        This action cannot be undone.
                                    </AlertDialogDescription>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={() => deletePaper(paper.id)}
                                        >
                                            Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </div>
    )
}
