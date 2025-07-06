import { useState, useEffect, useCallback } from 'react';
import { fetchFromApi } from '@/lib/api';

export interface SubscriptionLimits {
    paper_uploads: number;
    knowledge_base_size: number;
    chat_credits_daily: number;
    audio_overviews_monthly: number;
    model: string[];
}

export interface SubscriptionUsage {
    paper_uploads: number;
    paper_uploads_remaining: number;
    knowledge_base_size: number;
    knowledge_base_size_remaining: number;
    chat_credits_used: number;
    chat_credits_remaining: number;
    audio_overviews_used: number;
    audio_overviews_remaining: number;
}

export interface SubscriptionData {
    plan: 'basic' | 'researcher';
    limits: SubscriptionLimits;
    usage: SubscriptionUsage;
}

export interface UseSubscriptionReturn {
    subscription: SubscriptionData | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export const useSubscription = (): UseSubscriptionReturn => {
    const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSubscription = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetchFromApi("/api/subscription/usage");
            setSubscription(response);
        } catch (err) {
            console.error("Error fetching subscription:", err);
            setError(err instanceof Error ? err.message : "Failed to fetch subscription data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSubscription();
    }, [fetchSubscription]);

    return {
        subscription,
        loading,
        error,
        refetch: fetchSubscription
    };
};

// Helper functions for common subscription checks
export const getStorageUsagePercentage = (subscription: SubscriptionData | null): number => {
    if (!subscription) return 0;
    const { knowledge_base_size, knowledge_base_size_remaining } = subscription.usage;
    const total = knowledge_base_size + knowledge_base_size_remaining;
    if (total === 0) return 0;
    return (knowledge_base_size / total) * 100;
};

export const isStorageNearLimit = (subscription: SubscriptionData | null, threshold: number = 75): boolean => {
    return getStorageUsagePercentage(subscription) >= threshold;
};

export const isStorageAtLimit = (subscription: SubscriptionData | null): boolean => {
    return getStorageUsagePercentage(subscription) >= 100;
};

export const getPaperUploadPercentage = (subscription: SubscriptionData | null): number => {
    if (!subscription) return 0;
    const { paper_uploads, paper_uploads_remaining } = subscription.usage;
    const total = paper_uploads + paper_uploads_remaining;
    if (total === 0) return 0;
    return (paper_uploads / total) * 100;
};

export const isPaperUploadNearLimit = (subscription: SubscriptionData | null, threshold: number = 75): boolean => {
    return getPaperUploadPercentage(subscription) >= threshold;
};

export const isPaperUploadAtLimit = (subscription: SubscriptionData | null): boolean => {
    return getPaperUploadPercentage(subscription) >= 100;
};

export const formatFileSize = (sizeInKb: number): string => {
    if (sizeInKb < 1024) {
        return `${sizeInKb.toFixed(1)} KB`;
    } else if (sizeInKb < 1024 * 1024) {
        return `${(sizeInKb / 1024).toFixed(1)} MB`;
    } else {
        return `${(sizeInKb / (1024 * 1024)).toFixed(1)} GB`;
    }
};

// Audio overview credit helper functions
export const getAudioOverviewUsagePercentage = (subscription: SubscriptionData | null): number => {
    if (!subscription) return 0;
    const { audio_overviews_used: audio_overviews, audio_overviews_remaining } = subscription.usage;
    const total = audio_overviews + audio_overviews_remaining;
    if (total === 0) return 0;
    return (audio_overviews / total) * 100;
};

export const isAudioOverviewNearLimit = (subscription: SubscriptionData | null, threshold: number = 75): boolean => {
    return getAudioOverviewUsagePercentage(subscription) >= threshold;
};

export const isAudioOverviewAtLimit = (subscription: SubscriptionData | null): boolean => {
    return getAudioOverviewUsagePercentage(subscription) >= 100;
};

// Calculate next Monday at 12 AM UTC for credit reset
export const nextMonday = (() => {
    const now = new Date();
    const currentDayUTC = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const daysUntilMonday = currentDayUTC === 0 ? 1 : (8 - currentDayUTC) % 7; // Days until next Monday
    const nextMondayUTC = new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);

    // Set to start of day in UTC (00:00:00 UTC)
    nextMondayUTC.setUTCHours(0, 0, 0, 0);

    return nextMondayUTC;
})();
