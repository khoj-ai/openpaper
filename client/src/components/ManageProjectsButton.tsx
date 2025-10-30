"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { PaperProjects } from '@/components/PaperProjects';
import { useIsMobile } from '@/hooks/use-mobile';

export function ManageProjectsButton() {
    const params = useParams();
    const paperId = (params.id && (Array.isArray(params.id) ? params.id[0] : params.id)) as string | null;
    const [isOpen, setIsOpen] = useState(false);
    const isMobile = useIsMobile();

    if (!paperId) {
        return null;
    }

    const triggerButton = (
        <Button variant="ghost" size="sm">
            <FolderKanban className="h-4 w-4 mr-2" />
            <span>Projects</span>
        </Button>
    );

    const content = (
        <div className="grid gap-4">
            {isOpen && paperId ? <PaperProjects id={paperId} /> : null}
        </div>
    );

    if (isMobile) {
        return (
            <Drawer open={isOpen} onOpenChange={setIsOpen}>
                <DrawerTrigger asChild>
                    {triggerButton}
                </DrawerTrigger>
                <DrawerContent>
                    <DrawerHeader>
                        <DrawerTitle>Projects</DrawerTitle>
                    </DrawerHeader>
                    <div className="px-4 pb-4">
                        {content}
                    </div>
                </DrawerContent>
            </Drawer>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                {triggerButton}
            </PopoverTrigger>
            <PopoverContent className="w-80">
                {content}
            </PopoverContent>
        </Popover>
    );
}
