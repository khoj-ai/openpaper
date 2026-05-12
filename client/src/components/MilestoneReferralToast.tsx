"use client";

import { useEffect, useRef } from "react";
import { Gift } from "lucide-react";
import { toast } from "sonner";

import { fetchFromApi } from "@/lib/api";
import { SubscriptionData } from "@/lib/schema";

const LOCAL_STORAGE_KEY = "op_referral_toast_seen";

const PAPER_MILESTONE = 10;
const CHAT_CREDIT_MILESTONE = 5000;
const AUDIO_OVERVIEW_MILESTONE = 3;
const PROJECT_MILESTONE = 2;

function hasHitAnyMilestone(s: SubscriptionData): boolean {
    const u = s.usage;
    return (
        u.paper_uploads >= PAPER_MILESTONE ||
        u.chat_credits_used >= CHAT_CREDIT_MILESTONE ||
        u.audio_overviews_used >= AUDIO_OVERVIEW_MILESTONE ||
        u.projects >= PROJECT_MILESTONE
    );
}

/**
 * Renders nothing. Watches the user's subscription usage and fires a one-shot
 * sonner toast nudging them to share when any quota milestone is hit. The
 * "seen" state is cached in localStorage to avoid hitting the server on every
 * page load, and synced server-side so it survives a browser change.
 */
export function MilestoneReferralToast({
    subscription,
    onOpenReferral,
}: {
    subscription: SubscriptionData | null;
    onOpenReferral: () => void;
}) {
    const firedRef = useRef(false);

    useEffect(() => {
        if (firedRef.current) return;
        if (!subscription) return;
        if (!hasHitAnyMilestone(subscription)) return;

        // Fast local check — most of the time the user has already seen it.
        if (typeof window !== "undefined") {
            if (localStorage.getItem(LOCAL_STORAGE_KEY) === "true") {
                firedRef.current = true;
                return;
            }
        }

        let cancelled = false;
        firedRef.current = true; // claim the slot immediately to dedupe

        (async () => {
            try {
                const status = await fetchFromApi("/api/referral/toast-status");
                if (cancelled) return;
                if (status?.toast_seen) {
                    localStorage.setItem(LOCAL_STORAGE_KEY, "true");
                    return;
                }

                toast(
                    "You're getting a lot out of Open Paper — share with a friend?",
                    {
                        description: "Give $6, get $6 toward your subscription.",
                        icon: <Gift className="h-4 w-4" />,
                        duration: 12000,
                        action: {
                            label: "Refer a friend",
                            onClick: onOpenReferral,
                        },
                    },
                );

                // Mark seen now even if they ignore it — we don't want to
                // re-nudge on every page load. Best-effort.
                try {
                    await fetchFromApi("/api/referral/toast-seen", { method: "POST" });
                } catch (err) {
                    console.debug("toast-seen POST failed:", err);
                }
                localStorage.setItem(LOCAL_STORAGE_KEY, "true");
            } catch (err) {
                // If the status check fails, retry next page load.
                firedRef.current = false;
                console.debug("referral toast check failed:", err);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [subscription, onOpenReferral]);

    return null;
}
