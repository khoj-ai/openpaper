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
import { citationStyles, copyToClipboard, PaperBase } from '@/components/utils/paperUtils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface CitePaperButtonProps {
    paper?: (PaperData | PaperItem)[];
    paperId?: string;
    minimalist?: boolean;
    variant?: "ghost" | "outline";
}

export function CitePaperButton({ paper, paperId: providedPaperId, minimalist = false, variant = "ghost" }: CitePaperButtonProps) {
    const pathname = usePathname();
    const [derivedPaperId, setDerivedPaperId] = useState<string | null>(null);
    const [paperData, setPaperData] = useState<(PaperData | PaperItem)[] | null>(paper || null);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedStyle, setSelectedStyle] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('citationStyle');
            // Validate saved preference exists in current options, otherwise use default
            const isValid = saved && citationStyles.some(style => style.name === saved);
            return isValid ? saved : citationStyles[0].name;
        }
        return citationStyles[0].name;
    });
    const [copied, setCopied] = useState(false);
    const isMobile = useIsMobile();

    // Check if we're in bibliography mode (more than one paper)
    const isBibliography = paperData && paperData.length > 1;

    // Determine the paper ID to use (only for single paper mode)
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

        // Otherwise, try to derive paper ID from pathname (single paper mode only)
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
        if (paper && paper.length > 0) return;

        if (!effectivePaperId || !isOpen) return;

        const fetchPaperData = async () => {
            try {
                const data = await fetchFromApi(`/api/paper?id=${effectivePaperId}`);
                // Wrap single paper in array
                setPaperData([data]);
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
        <Button variant={variant} size="sm" className={variant === "outline" ? "h-8 px-3 text-xs" : ""}>
            {(!minimalist || variant === "outline") && <Quote className="h-3.5 w-3.5 mr-1.5" />}
            <span className={minimalist && variant !== "outline" ? "text-sm" : ""}>{isBibliography ? 'Bibliography' : 'Cite'}</span>
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
                        if (!selectedStyleObj || !paperData) return null;

                        const paperAsPaperBase = (p: PaperData | PaperItem, id?: string): PaperBase => {
                            const combined = p as Partial<PaperData> & Partial<PaperItem>;
                            return {
                                id: id || combined.id || '',
                                title: combined.title || '',
                                authors: combined.authors || [],
                                created_at: combined.publish_date || combined.created_at,
                                journal: combined.journal,
                                publisher: combined.publisher,
                                doi: combined.doi,
                            };
                        };

                        // Generate citation(s) - special handling for single paper (length === 1)
                        let citation: string;
                        if (paperData.length === 1) {
                            // Single paper citation
                            const singlePaper = paperData[0];
                            const paperBase = paperAsPaperBase(singlePaper, effectivePaperId || undefined);
                            citation = selectedStyleObj.generator(paperBase);
                        } else {
                            // Generate bibliography from multiple papers
                            citation = paperData.map((p, index) => {
                                const paperBase = paperAsPaperBase(p);
                                const singleCitation = selectedStyleObj.generator(paperBase);
                                // For numbered styles like IEEE, add numbering
                                if (selectedStyle === 'IEEE') {
                                    return `[${index + 1}] ${singleCitation}`;
                                }
                                return singleCitation;
                            }).join('\n\n');
                        }

                        return (
                            <div className="space-y-2">
                                <div className="text-xs bg-muted p-3 rounded overflow-x-auto overflow-y-auto max-h-96 whitespace-pre-wrap">
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
                                            Copy
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
                        <DrawerTitle>{isBibliography ? 'Bibliography' : 'Cite Paper'}</DrawerTitle>
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
                    <DialogTitle>{isBibliography ? 'Bibliography' : 'Cite Paper'}</DialogTitle>
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    );
}
