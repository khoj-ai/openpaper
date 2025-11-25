"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Quote, Loader, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { fetchFromApi } from '@/lib/api';
import { PaperData, PaperItem } from '@/lib/schema';
import { useIsMobile } from '@/hooks/use-mobile';
import { citationStyles, copyToClipboard } from '@/components/utils/paperUtils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface CitePaperButtonProps {
    paper?: PaperData | PaperItem;
    paperId?: string;
    minimalist?: boolean;
}

export function CitePaperButton({ paper, paperId: providedPaperId, minimalist = false }: CitePaperButtonProps) {
    const pathname = usePathname();
    const [derivedPaperId, setDerivedPaperId] = useState<string | null>(null);
    const [paperData, setPaperData] = useState<PaperData | PaperItem | null>(paper || null);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedStyle, setSelectedStyle] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('citationStyle');
            return saved || citationStyles[0].name;
        }
        return citationStyles[0].name;
    });
    const [copied, setCopied] = useState(false);
    const isMobile = useIsMobile();

    // Determine the paper ID to use
    const effectivePaperId = providedPaperId || derivedPaperId;

    // Save selected style to localStorage whenever it changes
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('citationStyle', selectedStyle);
        }
    }, [selectedStyle]);

    useEffect(() => {
        // If paper prop is provided, use it directly
        if (paper) {
            setPaperData(paper);
            return;
        }

        // Otherwise, try to derive paper ID from pathname
        if (pathname && !providedPaperId) {
            const segments = pathname.split('/');
            if (segments[1] === 'paper' && segments.length === 3 && segments[2]) {
                setDerivedPaperId(segments[2]);
            } else {
                setDerivedPaperId(null);
            }
        }
    }, [pathname, paper, providedPaperId]);

    useEffect(() => {
        // Skip fetch if we already have paper data from props
        if (paper) return;

        if (!effectivePaperId || !isOpen) return;

        const fetchPaperData = async () => {
            try {
                const data = await fetchFromApi(`/api/paper?id=${effectivePaperId}`);
                setPaperData(data);
            } catch {
                toast.error("Failed to fetch paper details.");
            }
        };

        fetchPaperData();
    }, [effectivePaperId, isOpen, paper]);

    if (!effectivePaperId && !paper) {
        return null;
    }

    const triggerButton = (
        <Button variant="ghost" size="sm">
            {!minimalist && <Quote className="h-4 w-4 mr-2" />}
            <span className={minimalist ? "text-sm" : ""}>Cite</span>
        </Button>
    );

    const content = (
        <div className="grid gap-4">
            {!paperData ? (
                <div className="flex items-center justify-center h-24">
                    <Loader className="animate-spin h-6 w-6" />
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Citation Style</label>
                        <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select citation style" />
                            </SelectTrigger>
                            <SelectContent>
                                {citationStyles.map((style) => (
                                    <SelectItem key={style.name} value={style.name}>
                                        {style.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {(() => {
                        const selectedStyleObj = citationStyles.find(s => s.name === selectedStyle);
                        if (!selectedStyleObj) return null;

                        const paperBase = {
                            id: effectivePaperId || '',
                            title: paperData.title,
                            authors: paperData.authors,
                            created_at: paperData.publish_date,
                        };
                        const citation = selectedStyleObj.generator(paperBase);

                        return (
                            <div className="space-y-2">
                                <div className="text-xs bg-muted p-3 rounded overflow-x-auto">
                                    {citation}
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        copyToClipboard(citation, selectedStyle);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    }}
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-4 w-4 mr-2" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-4 w-4 mr-2" />
                                            Copy Citation
                                        </>
                                    )}
                                </Button>
                            </div>
                        );
                    })()}
                </div>
            )}
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
                        <DrawerTitle>Cite Paper</DrawerTitle>
                    </DrawerHeader>
                    <div className="px-4 pb-4">
                        {content}
                    </div>
                </DrawerContent>
            </Drawer>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {triggerButton}
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Cite Paper</DialogTitle>
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    );
}
