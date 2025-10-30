"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Loader, LockIcon, ShareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { fetchFromApi } from '@/lib/api';
import { PaperData } from '@/lib/schema';
import { useIsMobile } from '@/hooks/use-mobile';

export function SharePaperButton() {
    const pathname = usePathname();
    const [paperId, setPaperId] = useState<string | null>(null);
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [isSharing, setIsSharing] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const isMobile = useIsMobile();

    useEffect(() => {
        if (pathname) {
            const segments = pathname.split('/');
            if (segments[1] === 'paper' && segments.length === 3 && segments[2]) {
                setPaperId(segments[2]);
            } else {
                setPaperId(null);
            }
        }
    }, [pathname]);

    useEffect(() => {
        if (!paperId || !isOpen) return;

        const fetchPaperData = async () => {
            try {
                const data = await fetchFromApi(`/api/paper?id=${paperId}`);
                setPaperData(data);
            } catch {
                toast.error("Failed to fetch paper details.");
            }
        };

        fetchPaperData();
    }, [paperId, isOpen]);

    const handleShare = useCallback(async () => {
        if (!paperId) return;
        setIsSharing(true);
        try {
            const response = await fetchFromApi(`/api/paper/share?id=${paperId}`, { method: 'POST' });
            if (paperData) {
                setPaperData({ ...paperData, share_id: response.share_id });
            } else {
                const data = await fetchFromApi(`/api/paper?id=${paperId}`);
                setPaperData(data);
            }
            toast.success("Paper shared successfully!");
        } catch {
            toast.error("Failed to share paper.");
        } finally {
            setIsSharing(false);
        }
    }, [paperId, paperData]);

    const handleUnshare = useCallback(async () => {
        if (!paperId || !paperData || !paperData.share_id || isSharing) return;
        setIsSharing(true);
        try {
            await fetchFromApi(`/api/paper/unshare?id=${paperId}`, {
                method: 'POST',
            });
            setPaperData(prev => prev ? { ...prev, share_id: "" } : null);
            toast.success("Paper is now private.");
        } catch (error) {
            console.error('Error unsharing paper:', error);
            toast.error("Failed to make paper private.");
        } finally {
            setIsSharing(false);
        }
    }, [paperId, paperData, isSharing]);

    if (!paperId) {
        return null;
    }

    const triggerButton = (
        <Button variant="ghost" size="sm">
            <ShareIcon className="h-4 w-4 mr-2" />
            Share
        </Button>
    );

    const content = (
        <div className="grid gap-4">
            {!paperData ? (
                <div className="flex items-center justify-center h-24">
                    <Loader className="animate-spin h-6 w-6" />
                </div>
            ) : (
                <div>
                    {paperData.share_id ? (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">This paper is currently public. Anyone with the link can view it.</p>
                            <div className="flex items-center space-x-2">
                                <Input
                                    readOnly
                                    value={`${window.location.origin}/paper/share/${paperData.share_id}`}
                                    className="flex-1"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(`${window.location.origin}/paper/share/${paperData.share_id}`);
                                        toast.success("Link copied!");
                                    }}
                                >
                                    Copy
                                </Button>
                            </div>
                            <Button
                                variant="destructive"
                                onClick={handleUnshare}
                                disabled={isSharing}
                                className="w-fit"
                            >
                                {isSharing ? <Loader className="animate-spin mr-2 h-4 w-4" /> : <LockIcon className="mr-2 h-4 w-4" />}
                                Make Private
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">Make this paper public to share it with others via a unique link. All of your <b>annotations and chats</b> will be visible to anyone with the link.</p>
                            <Button
                                onClick={handleShare}
                                disabled={isSharing}
                                className="w-fit"
                            >
                                {isSharing ? <Loader className="animate-spin mr-2 h-4 w-4" /> : <ShareIcon className="mr-2 h-4 w-4" />}
                                Share Publicly
                            </Button>
                        </div>
                    )}
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
                        <DrawerTitle>Share Paper</DrawerTitle>
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
