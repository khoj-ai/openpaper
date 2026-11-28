"use client"

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { fetchFromApi } from "@/lib/api";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PersonalPlanNoticeProps {
    teamName: string;
    // Ask right away, as someone becomes covered by the team.
    askNow?: boolean;
    onCanceled: () => void;
}

/**
 * Shown to someone a paid team covers while their personal plan still renews.
 * Canceling stops it renewing; they keep it to the end of the period they've paid for.
 */
export function PersonalPlanNotice({ teamName, askNow = false, onCanceled }: PersonalPlanNoticeProps) {
    const [asking, setAsking] = useState(askNow);
    const [canceling, setCanceling] = useState(false);

    const cancel = async () => {
        setCanceling(true);
        try {
            const { current_period_end }: { current_period_end: string | null } = await fetchFromApi(
                "/api/organization/personal-plan/cancel",
                { method: "POST" },
            );
            const until = current_period_end
                ? ` You keep it until ${new Date(current_period_end).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`
                : "";
            toast.success(`Your Researcher plan won't renew.${until}`);
            setAsking(false);
            onCanceled();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not cancel your plan.");
        } finally {
            setCanceling(false);
        }
    };

    return (
        <>
            <Alert>
                <CreditCard className="h-4 w-4" />
                <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <span>
                        {teamName} covers your plan, but you&apos;re still paying for a personal Researcher plan.
                        Cancel it to avoid paying twice.
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setAsking(true)} className="shrink-0">
                        Cancel personal plan
                    </Button>
                </AlertDescription>
            </Alert>

            <AlertDialog open={asking} onOpenChange={(open) => !canceling && setAsking(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancel your Researcher plan?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {teamName} now covers your plan, so you don&apos;t need to pay for Researcher too.
                            It won&apos;t renew, and you keep it until the end of the period you&apos;ve paid for.
                            Your papers and projects stay as they are.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={canceling}>Keep paying</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={canceling}
                            onClick={(e) => {
                                e.preventDefault();
                                cancel();
                            }}
                        >
                            {canceling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Cancel Researcher
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
