"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PaperProjects } from '@/components/PaperProjects';

export function ManageProjectsButton() {
    const params = useParams();
    const paperId = (params.id && (Array.isArray(params.id) ? params.id[0] : params.id)) as string | null;
    const [isOpen, setIsOpen] = useState(false);

    if (!paperId) {
        return null;
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                    <FolderKanban className="h-4 w-4 mr-2" />
                    <span>Projects</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
                <div className="grid gap-4">
                    {isOpen && paperId ? <PaperProjects id={paperId} /> : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}
