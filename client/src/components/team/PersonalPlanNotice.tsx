"use client"

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fetchFromApi } from "@/lib/api";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Shown to someone whose team now covers them while they're still paying for a
 * personal plan. We don't cancel it for them; the billing portal lets them
 * cancel at the end of the period they've already paid for.
 */
export function PersonalPlanNotice({ teamName }: { teamName: string }) {
    const [opening, setOpening] = useState(false);

    const openPortal = async () => {
        setOpening(true);
        try {
            const { url } = await fetchFromApi("/api/subscription/create-portal-session", { method: "POST" });
            window.location.href = url;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not open billing.");
            setOpening(false);
        }
    };

    return (
        <Alert>
            <CreditCard className="h-4 w-4" />
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <span>
                    {teamName} covers your plan, but you&apos;re still paying for a personal Researcher plan.
                    Cancel it to avoid paying twice. You keep it until the end of the period you&apos;ve paid for.
                </span>
                <Button size="sm" variant="outline" onClick={openPortal} disabled={opening} className="shrink-0">
                    {opening && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Manage personal plan
                </Button>
            </AlertDescription>
        </Alert>
    );
}
