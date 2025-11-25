"use client";

import React, { useState } from 'react';
import { MenuIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger
} from '@/components/ui/sheet';
import { SharePaperButton } from '@/components/SharePaperButton';
import { CitePaperButton } from '@/components/CitePaperButton';
import { ManageProjectsButton } from '@/components/ManageProjectsButton';

export function MobilePaperMenu() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="md:hidden">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon">
                        <MenuIcon className="h-5 w-5" />
                        <span className="sr-only">Open menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80">
                    <SheetHeader>
                        <SheetTitle>Paper Actions</SheetTitle>
                    </SheetHeader>
                    <div className="m-0">
                        {/* Mobile-styled buttons that take full width and are left-aligned */}
                        <div className="w-full [&>*]:w-full [&>*>button]:w-full [&>*>button]:justify-start [&>*>button]:text-left [&>*>button]:px-4 [&>*>button]:py-3 [&>*>button]:h-auto [&>*>button]:flex [&>*>button]:items-center">
                            <CitePaperButton />
                        </div>
                        <div className="w-full [&>*]:w-full [&>*>button]:w-full [&>*>button]:justify-start [&>*>button]:text-left [&>*>button]:px-4 [&>*>button]:py-3 [&>*>button]:h-auto [&>*>button]:flex [&>*>button]:items-center">
                            <SharePaperButton />
                        </div>
                        <div className="w-full [&>*]:w-full [&>*>button]:w-full [&>*>button]:justify-start [&>*>button]:text-left [&>*>button]:px-4 [&>*>button]:py-3 [&>*>button]:h-auto [&>*>button]:flex [&>*>button]:items-center">
                            <ManageProjectsButton />
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
