"use client";

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Import, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { fetchFromApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface ShareOwnerInfo {
    owner_id?: string;
}

export function ImportPaperButton() {
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();
    const [shareId, setShareId] = useState<string | null>(null);
    const [ownerInfo, setOwnerInfo] = useState<ShareOwnerInfo | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Extract shareId from path if on a share page
    useEffect(() => {
        if (pathname) {
            const segments = pathname.split('/');
            // Check for /paper/share/[id] pattern
            if (segments[1] === 'paper' && segments[2] === 'share' && segments[3]) {
                setShareId(segments[3]);
            } else {
                setShareId(null);
            }
        }
    }, [pathname]);

    // Fetch owner info when shareId is available
    useEffect(() => {
        if (!shareId) {
            setIsLoading(false);
            return;
        }

        const fetchOwnerInfo = async () => {
            setIsLoading(true);
            try {
                const response = await fetchFromApi(`/api/paper/share?id=${shareId}`);
                setOwnerInfo({ owner_id: response.owner?.id });
            } catch {
                // If we can't fetch owner info, we'll still show the button
                setOwnerInfo(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchOwnerInfo();
    }, [shareId]);

    const handleImport = async () => {
        if (!user) {
            // Store return URL and redirect to login page
            localStorage.setItem('returnTo', pathname || '/');
            router.push('/login');
            return;
        }

        if (!shareId) return;

        setIsImporting(true);
        const toastId = toast.loading("Importing paper to your library...");

        try {
            const response = await fetchFromApi('/api/paper/fork', {
                method: 'POST',
                body: JSON.stringify({ share_id: shareId }),
            });

            if (response.new_paper_id) {
                toast.success("Paper imported!", {
                    id: toastId,
                    description: "The paper has been added to your library.",
                    richColors: true,
                });
                router.push(`/paper/${response.new_paper_id}`);
            } else {
                throw new Error("Invalid response from server.");
            }
        } catch (error) {
            console.error("Failed to import paper:", error);
            toast.error("Import failed", {
                id: toastId,
                description: error instanceof Error ? error.message : "Could not import the paper. Please try again.",
                richColors: true,
            });
        } finally {
            setIsImporting(false);
        }
    };

    // Don't render if not on a share page
    if (!shareId) {
        return null;
    }

    // Don't render while loading owner info
    if (isLoading) {
        return null;
    }

    // Don't render if user is the owner
    if (ownerInfo?.owner_id && user?.id && ownerInfo.owner_id === user.id) {
        return null;
    }

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={handleImport}
            disabled={isImporting}
        >
            {isImporting ? (
                <Loader className="h-4 w-4 mr-2 animate-spin" />
            ) : (
                <Import className="h-4 w-4 mr-2" />
            )}
            Import
        </Button>
    );
}
