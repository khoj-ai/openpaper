"use client"

import { useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import { SubscriptionLimits } from "@/lib/schema";

// Prices come from Stripe through the server, so trying a new price is a
// server config change only.
export interface TeamPricing {
    currency: string;
    monthly_per_seat: number;
    yearly_per_seat: number;
    limits: {
        team: Omit<SubscriptionLimits, "model">;
        researcher: Omit<SubscriptionLimits, "model">;
    };
}

export type TeamInterval = "month" | "year";

export const teamPriceTotal = (pricing: TeamPricing, seats: number, interval: TeamInterval): number =>
    seats * (interval === "month" ? pricing.monthly_per_seat : pricing.yearly_per_seat);

// What one seat costs per month, for comparing intervals.
export const perSeatMonthly = (pricing: TeamPricing, interval: TeamInterval): number =>
    interval === "month" ? pricing.monthly_per_seat : pricing.yearly_per_seat / 12;

export const formatPrice = (amount: number): string =>
    `$${Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(2)}`;

let cached: Promise<TeamPricing> | null = null;

export function useTeamPricing(): TeamPricing | null {
    const [pricing, setPricing] = useState<TeamPricing | null>(null);
    useEffect(() => {
        cached ??= fetchFromApi("/api/organization/pricing").catch((error) => {
            cached = null;
            throw error;
        });
        let active = true;
        cached.then((value) => active && setPricing(value)).catch(() => {});
        return () => {
            active = false;
        };
    }, []);
    return pricing;
}
