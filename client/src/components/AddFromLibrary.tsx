
"use client";

import { useEffect, useState } from "react";
import { PaperItem } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "./ui/button";
import PaperCard from "./PaperCard";
import { Checkbox } from "./ui/checkbox";
import { toast } from "sonner";

interface AddFromLibraryProps {
    projectId: string;
    onPapersAdded: () => void;
}

export default function AddFromLibrary({ projectId, onPapersAdded }: AddFromLibraryProps) {
    const [papers, setPapers] = useState<PaperItem[]>([]);
    const [selectedPapers, setSelectedPapers] = useState<string[]>([]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (open) {
            fetchFromApi("/api/paper/all")
                .then(response => {
                    setPapers(response.papers);
                })
                .catch(error => {
                    console.error("Failed to fetch papers", error);
                    toast.error("Failed to fetch papers from your library.");
                });
        }
    }, [open]);

    const handleSelectPaper = (paperId: string) => {
        setSelectedPapers(prevSelected =>
            prevSelected.includes(paperId)
                ? prevSelected.filter(id => id !== paperId)
                : [...prevSelected, paperId]
        );
    };

    const handleDone = () => {
        fetchFromApi(`/api/projects/papers/${projectId}`, {
            method: 'POST',
            body: JSON.stringify({ paper_ids: selectedPapers })
        })
            .then(() => {
                toast.success("Papers added to project successfully!");
                onPapersAdded();
                setOpen(false);
                setSelectedPapers([]);
            })
            .catch(error => {
                console.error("Failed to add papers to project", error);
                toast.error("Failed to add papers to project.");
            });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>Add from Library</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                    <DialogTitle>Add Papers from Your Library</DialogTitle>
                </DialogHeader>
                <Command>
                    <CommandInput placeholder="Search for papers..." />
                    <CommandList>
                        <CommandEmpty>No papers found.</CommandEmpty>
                        <CommandGroup>
                            {papers.map(paper => (
                                <CommandItem key={paper.id} onSelect={() => handleSelectPaper(paper.id)}>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            checked={selectedPapers.includes(paper.id)}
                                            onCheckedChange={() => handleSelectPaper(paper.id)}
                                        />
                                        <PaperCard paper={paper} minimalist={true} />
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
                <div className="flex justify-end space-x-2 mt-4">
                    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={handleDone}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
