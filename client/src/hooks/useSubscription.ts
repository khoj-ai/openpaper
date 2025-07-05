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
    chat_credits_used_today: number;
    chat_credits_remaining: number;
    audio_overviews: number;
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
