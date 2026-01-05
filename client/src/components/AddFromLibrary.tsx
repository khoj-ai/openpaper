
"use client";

import { PaperItem } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { toast } from "sonner";
import { LibraryTable } from "./LibraryTable";

interface AddFromLibraryProps {
    projectId: string;
    onPapersAdded: () => void;
    projectPaperIds?: string[];
    onUploadClick?: () => void;
}

export default function AddFromLibrary({ projectId, onPapersAdded, projectPaperIds, onUploadClick }: AddFromLibraryProps) {

    const handleAddPapers = (papers: PaperItem[], action: string) => {
        if (action !== "Add") return;

        const paperIds = papers.map(p => p.id);

        fetchFromApi(`/api/projects/papers/${projectId}`, {
            method: 'POST',
            body: JSON.stringify({ paper_ids: paperIds })
        })
            .then(() => {
                toast.success("Papers added to project successfully!");
                onPapersAdded();
            })
            .catch(error => {
                console.error("Failed to add papers to project", error);
                toast.error("Failed to add papers to project.");
            });
    };

    return (
        <LibraryTable
            selectable={true}
            actionOptions={["Add"]}
            onSelectFiles={handleAddPapers}
            projectPaperIds={projectPaperIds}
            onUploadClick={onUploadClick}
        />
    );
}
