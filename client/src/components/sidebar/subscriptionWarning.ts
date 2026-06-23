import { User } from "@/lib/auth";
import { SubscriptionData } from "@/lib/schema";
import {
    isStorageAtLimit,
    isPaperUploadAtLimit,
    isStorageNearLimit,
    isPaperUploadNearLimit,
    isChatCreditAtLimit,
    isChatCreditNearLimit,
} from "@/hooks/useSubscription";

export interface SubscriptionWarning {
    type: "error" | "warning";
    key: string;
    title: string;
    description: string;
}

/**
 * Derives the single most important subscription warning to surface (critical
 * "at limit" states take priority over "near limit" ones), or null when there's
 * nothing to warn about.
 */
export function getSubscriptionWarning(
    subscription: SubscriptionData | null,
    user: User | null,
    loading: boolean,
): SubscriptionWarning | null {
    if (!subscription || !user || loading) return null;

    // Check for critical states first (red warnings)
    if (isStorageAtLimit(subscription)) {
        return {
            type: "error",
            key: "storage-limit",
            title: "Storage limit reached",
            description: "Upgrade your plan or delete papers to continue.",
        };
    }

    if (isPaperUploadAtLimit(subscription)) {
        return {
            type: "error",
            key: "upload-limit",
            title: "Upload limit reached",
            description: "Upgrade your plan to upload more.",
        };
    }

    // Check for warning states (yellow warnings)
    if (isStorageNearLimit(subscription)) {
        return {
            type: "warning",
            key: "storage-near-limit",
            title: "Storage nearly full",
            description: "Consider upgrading your plan.",
        };
    }

    if (isPaperUploadNearLimit(subscription)) {
        return {
            type: "warning",
            key: "upload-near-limit",
            title: "Upload limit approaching",
            description: "Consider upgrading your plan.",
        };
    }

    if (isChatCreditAtLimit(subscription)) {
        return {
            type: "error",
            key: "chat-credit-limit",
            title: "Chat credits exhausted",
            description: "Upgrade your plan to continue using chat features.",
        };
    }

    if (isChatCreditNearLimit(subscription)) {
        return {
            type: "warning",
            key: "chat-credit-near-limit",
            title: "Chat credits nearly exhausted",
            description: "Consider upgrading your plan to avoid interruptions.",
        };
    }

    return null;
}
