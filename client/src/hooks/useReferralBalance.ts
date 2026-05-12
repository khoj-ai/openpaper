import { useCallback, useEffect, useState } from "react";

import { fetchFromApi } from "@/lib/api";

export interface ReferralBalance {
    pending_cents: number;
    available_cents: number;
    total_converted: number;
    referee_discount_percent: number;
    referee_discount_available: boolean;
}

export interface UseReferralBalanceReturn {
    balance: ReferralBalance | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

/**
 * Read-only fetch of the user's referral standing. Used for "you have $X
 * waiting" surfaces (account menu, pricing page). Does NOT lazy-create a
 * referral code — that only happens when the user opens the share dialog.
 */
export function useReferralBalance(enabled: boolean = true): UseReferralBalanceReturn {
    const [balance, setBalance] = useState<ReferralBalance | null>(null);
    const [loading, setLoading] = useState<boolean>(enabled);
    const [error, setError] = useState<string | null>(null);

    const fetchBalance = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetchFromApi("/api/referral/balance");
            setBalance(response);
        } catch (err) {
            console.error("Error fetching referral balance:", err);
            setError(err instanceof Error ? err.message : "Failed to fetch referral balance");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;
        fetchBalance();
    }, [enabled, fetchBalance]);

    return { balance, loading, error, refetch: fetchBalance };
}

export function hasUnusedReferralValue(balance: ReferralBalance | null): boolean {
    if (!balance) return false;
    return (
        balance.available_cents > 0 ||
        balance.pending_cents > 0 ||
        balance.referee_discount_available
    );
}
