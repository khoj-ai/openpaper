'use client';

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCallback, useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { fetchFromApi } from "@/lib/api";
import { formatPrice, TeamInterval, TeamPricing, teamPriceTotal } from "./teamPricing";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface TeamCheckoutSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    teamId: string;
    teamName: string;
    seats: number;
    interval: TeamInterval;
    pricing: TeamPricing;
}

export function TeamCheckoutSheet({ open, onOpenChange, teamId, teamName, seats, interval, pricing }: TeamCheckoutSheetProps) {
    const [error, setError] = useState<string | null>(null);

    const fetchClientSecret = useCallback(() => {
        setError(null);
        return fetchFromApi(`/api/organization/${teamId}/checkout`, {
            method: "POST",
            body: JSON.stringify({ interval, seats }),
        })
            .then((data) => data.client_secret)
            .catch((err) => {
                setError(err instanceof Error ? err.message : 'Could not start checkout. Please try again.');
                throw err;
            });
    }, [teamId, interval, seats]);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-2xl overflow-auto py-2">
                <SheetHeader>
                    <SheetTitle>Buy seats for {teamName}</SheetTitle>
                    <SheetDescription>
                        {seats} {seats === 1 ? "seat" : "seats"}, {formatPrice(teamPriceTotal(pricing, seats, interval))} billed{" "}
                        {interval === "month" ? "monthly" : "annually"} by{" "}
                        <a href="https://khoj.dev" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">
                            Khoj Inc.
                        </a>
                        {" "}You can add or remove seats later.
                    </SheetDescription>
                </SheetHeader>
                {error && (
                    <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md p-3 my-4 text-sm text-red-800 dark:text-red-200">
                        {error}
                    </div>
                )}
                {/* Remount when the order changes so Stripe fetches a fresh session. */}
                <div className="min-h-[400px]" key={`${interval}-${seats}`}>
                    {open && (
                        <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
                            <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
