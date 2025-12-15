import { useState, useEffect, useCallback } from 'react';
import { fetchFromApi } from '@/lib/api';
import { SubscriptionData, UseSubscriptionReturn } from '@/lib/schema';

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

// Chat credit helper functions
export const getChatCreditUsagePercentage = (subscription: SubscriptionData | null): number => {
    if (!subscription) return 0;
    const { chat_credits_used, chat_credits_remaining } = subscription.usage;
    const total = chat_credits_used + chat_credits_remaining;
    console.log("Chat credits used:", chat_credits_used, "remaining:", chat_credits_remaining, "total:", total);
    if (total === 0) return 0;
    return (chat_credits_used / total) * 100;
};

export const isChatCreditNearLimit = (subscription: SubscriptionData | null, threshold: number = 75): boolean => {
    return getChatCreditUsagePercentage(subscription) >= threshold;
};

export const isChatCreditAtLimit = (subscription: SubscriptionData | null): boolean => {
    return getChatCreditUsagePercentage(subscription) >= 100;
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

// Project usage helper functions
export const getProjectUsagePercentage = (subscription: SubscriptionData | null): number => {
    if (!subscription) return 0;
    const { projects, projects_remaining } = subscription.usage;
    const total = projects + projects_remaining;
    if (total === 0) return 0;
    return (projects / total) * 100;
};

export const isProjectNearLimit = (subscription: SubscriptionData | null, threshold: number = 75): boolean => {
    return getProjectUsagePercentage(subscription) >= threshold;
};

export const isProjectAtLimit = (subscription: SubscriptionData | null): boolean => {
    return getProjectUsagePercentage(subscription) >= 100;
};

// Data table usage helper functions
export const getDataTableUsagePercentage = (subscription: SubscriptionData | null): number => {
    if (!subscription) return 0;
    const { data_tables_used, data_tables_remaining } = subscription.usage;
    const total = data_tables_used + data_tables_remaining;
    if (total === 0) return 0;
    return (data_tables_used / total) * 100;
};

export const isDataTableNearLimit = (subscription: SubscriptionData | null, threshold: number = 75): boolean => {
    return getDataTableUsagePercentage(subscription) >= threshold;
};

export const isDataTableAtLimit = (subscription: SubscriptionData | null): boolean => {
    return getDataTableUsagePercentage(subscription) >= 100;
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
