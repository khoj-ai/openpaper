
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
    remainingPaperSlots?: number;
    paperHardLimit?: number;
}

export default function AddFromLibrary({ projectId, onPapersAdded, projectPaperIds, onUploadClick, remainingPaperSlots, paperHardLimit }: AddFromLibraryProps) {

    const handleAddPapers = (papers: PaperItem[], action: string) => {
        if (action !== "Add") return;

        // Check if adding these papers would exceed the limit
        if (remainingPaperSlots !== undefined && papers.length > remainingPaperSlots) {
            if (remainingPaperSlots === 0) {
                toast.error(`This project has reached the maximum of ${paperHardLimit} papers. Remove some papers before adding more.`);
            } else {
                toast.error(`You can only add ${remainingPaperSlots} more paper${remainingPaperSlots === 1 ? '' : 's'} to this project (limit: ${paperHardLimit}).`);
            }
            return;
        }

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
