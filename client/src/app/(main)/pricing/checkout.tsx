'use client';

import {
    EmbeddedCheckoutProvider,
    EmbeddedCheckout
} from '@stripe/react-stripe-js';
import { fetchFromApi } from "@/lib/api";
import { loadStripe } from '@stripe/stripe-js';
import { useCallback, useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY || '');

interface CheckoutSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    interval: "month" | "year";
    planName?: string;
    annualSavings?: number;
}

export default function CheckoutSheet({ open, onOpenChange, interval, planName, annualSavings }: CheckoutSheetProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchClientSecret = useCallback(() => {
        setIsLoading(true);
        setError(null);

        console.log("CREATING CHECKOUT SESSION", interval);
        return fetchFromApi(`/api/subscription/create-checkout-session?interval=${interval}`, {
            method: "POST",
        })
            .then((data) => {
                console.log("CHECKOUT SESSION CREATED", data);
                setIsLoading(false);
                return data.client_secret;
            })
            .catch((err) => {
                setError('An error occurred while setting up the checkout. Please try again.');
                setIsLoading(false);
                console.error(err);
                throw err;
            });
    }, [interval]);

    const options = { fetchClientSecret };

    // Reset error state when sheet opens/closes
    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) {
            setError(null);
            setIsLoading(false);
        }
        onOpenChange(newOpen);
    };

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetContent className="w-full sm:max-w-6xl overflow-auto py-2">
                <SheetHeader>
                    <SheetTitle>
                        Complete Your Subscription
                        {planName && ` - ${planName}`}
                    </SheetTitle>
                    <SheetDescription>
                        Secure checkout powered by Stripe. Your subscription will be billed {interval === 'month' ? 'monthly' : 'annually'}. {interval === 'year' ? `You are saving $${annualSavings} with annual billing!` : `Save $${annualSavings} with annual billing!`}
                    </SheetDescription>
                </SheetHeader>

                <div className="mt-0">
                    {error && (
                        <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md p-3 mb-4 text-sm text-red-800 dark:text-red-200">
                            {error}
                        </div>
                    )}

                    {isLoading && (
                        <div className="text-center py-8">
                            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                            <p className="mt-2 text-sm text-muted-foreground">Setting up your checkout...</p>
                        </div>
                    )}

                    <div className="min-h-[400px]">
                        <EmbeddedCheckoutProvider
                            stripe={stripePromise}
                            options={options}
                        >
                            <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
