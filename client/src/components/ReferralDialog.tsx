"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, Share2, Twitter } from "lucide-react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchFromApi } from "@/lib/api";

interface ReferralSummary {
    total_referrals: number;
    total_converted: number;
    pending_cents: number;
    available_cents: number;
}

interface ReferralInfo {
    code: string;
    share_url: string;
    referrer_credit_cents_per_referral: number;
    referee_discount_percent: number;
    credit_hold_days: number;
    summary: ReferralSummary;
}

const formatDollars = (cents: number) =>
    `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function ReferralDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [info, setInfo] = useState<ReferralInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [copiedField, setCopiedField] = useState<"url" | "code" | null>(null);

    useEffect(() => {
        if (!open || info) return;
        let cancelled = false;
        setLoading(true);
        fetchFromApi("/api/referral/me")
            .then((data) => {
                if (!cancelled) setInfo(data);
            })
            .catch((err) => {
                console.error("Failed to load referral info:", err);
                toast.error("Could not load your referral link");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, info]);

    const copy = useCallback((value: string, field: "url" | "code") => {
        navigator.clipboard
            .writeText(value)
            .then(() => {
                setCopiedField(field);
                toast.success(field === "url" ? "Link copied" : "Code copied");
                window.setTimeout(() => setCopiedField(null), 1500);
            })
            .catch(() => toast.error("Copy failed"));
    }, []);

    const shareText = info
        ? `I've been using Open Paper to read research papers with AI — give it a try. ${info.share_url}`
        : "";
    const twitterHref = info
        ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`
        : "#";
    const emailHref = info
        ? `mailto:?subject=${encodeURIComponent(
              "You should try Open Paper",
          )}&body=${encodeURIComponent(shareText)}`
        : "#";

    const summary = info?.summary;
    const pendingCents = summary?.pending_cents ?? 0;
    const availableCents = summary?.available_cents ?? 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Share2 className="h-5 w-5" />
                        Give $6, get $6
                    </DialogTitle>
                    <DialogDescription>
                        Share your link. When a friend upgrades to Researcher,
                        they get 50% off their first month and you earn a $6
                        credit toward your subscription.
                    </DialogDescription>
                </DialogHeader>

                {loading || !info ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                                Your share link
                            </label>
                            <div className="flex gap-2">
                                <Input readOnly value={info.share_url} className="font-mono text-sm" />
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => copy(info.share_url, "url")}
                                    aria-label="Copy share link"
                                >
                                    {copiedField === "url" ? (
                                        <Check className="h-4 w-4" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                                Or share your code
                            </label>
                            <div className="flex gap-2">
                                <Input
                                    readOnly
                                    value={info.code}
                                    className="font-mono text-sm tracking-widest text-center"
                                />
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => copy(info.code, "code")}
                                    aria-label="Copy code"
                                >
                                    {copiedField === "code" ? (
                                        <Check className="h-4 w-4" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button asChild variant="outline" className="flex-1">
                                <a href={twitterHref} target="_blank" rel="noreferrer">
                                    <Twitter className="h-4 w-4 mr-2" />
                                    Tweet
                                </a>
                            </Button>
                            <Button asChild variant="outline" className="flex-1">
                                <a href={emailHref}>
                                    <Mail className="h-4 w-4 mr-2" />
                                    Email
                                </a>
                            </Button>
                        </div>

                        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Friends upgraded</span>
                                <span className="font-medium">{summary?.total_converted ?? 0}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Pending credit</span>
                                <span className="font-medium">{formatDollars(pendingCents)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Available credit</span>
                                <span className="font-medium">{formatDollars(availableCents)}</span>
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Credits clear our {info.credit_hold_days}-day hold
                            before they apply to your invoice. If your friend
                            refunds inside that window, the credit is reversed.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
