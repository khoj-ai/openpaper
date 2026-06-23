"use client"

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SubscriptionData } from "@/lib/schema";
import {
    formatFileSize,
    getStorageUsagePercentage,
    getPaperUploadPercentage,
    getChatCreditUsagePercentage,
    getAudioOverviewUsagePercentage,
    getProjectUsagePercentage,
    getDataTableUsagePercentage,
    getDiscoverSearchUsagePercentage,
} from "@/hooks/useSubscription";

export const UsageLimitCard = ({
    subscription,
    loading
}: {
    subscription: SubscriptionData | null,
    loading: boolean
}) => {
    if (loading || !subscription) {
        return (
            <div className="p-4 space-y-3">
                <div className="text-sm font-medium">Loading usage data...</div>
            </div>
        );
    }

    const formatUsage = (used: number, total: number, unit: string = "") => {
        return `${used}${unit} / ${total}${unit}`;
    };

    const UsageItem = ({
        label,
        used,
        total,
        unit = "",
        percentage,
        formatValue
    }: {
        label: string,
        used: number,
        total: number,
        unit?: string,
        percentage: number,
        formatValue?: (value: number) => string
    }) => (
        <div className="space-y-2">
            <div className="flex justify-between items-center">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">
                    {formatValue ?
                        `${formatValue(used)} / ${formatValue(total)}` :
                        formatUsage(used, total, unit)
                    }
                </span>
            </div>
            <div className="relative">
                <Progress value={Math.min(percentage, 100)} className="h-2" />
            </div>
            <div className="text-xs text-muted-foreground">
                {percentage.toFixed(1)}% used
            </div>
        </div>
    );

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Usage Limits</h3>
                <Badge variant={subscription.plan === 'researcher' ? "default" : "secondary"}>
                    {subscription.plan === 'researcher' ? 'Researcher' : 'Basic'}
                </Badge>
            </div>

            <div className="space-y-4">
                <UsageItem
                    label="Paper Uploads"
                    used={subscription.usage.paper_uploads}
                    total={subscription.limits.paper_uploads}
                    percentage={getPaperUploadPercentage(subscription)}
                />

                <UsageItem
                    label="Storage"
                    used={subscription.usage.knowledge_base_size}
                    total={subscription.limits.knowledge_base_size}
                    percentage={getStorageUsagePercentage(subscription)}
                    formatValue={formatFileSize}
                />

                <UsageItem
                    label="Weekly Chat Credits"
                    used={subscription.usage.chat_credits_used}
                    total={subscription.limits.chat_credits_weekly}
                    percentage={getChatCreditUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Weekly Audio Overviews"
                    used={subscription.usage.audio_overviews_used}
                    total={subscription.limits.audio_overviews_weekly}
                    percentage={getAudioOverviewUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Weekly Data Tables"
                    used={subscription.usage.data_tables_used}
                    total={subscription.limits.data_tables_weekly}
                    percentage={getDataTableUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Weekly Discover Searches"
                    used={subscription.usage.discover_searches_used}
                    total={subscription.limits.discover_searches_weekly}
                    percentage={getDiscoverSearchUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Projects"
                    used={subscription.usage.projects}
                    total={subscription.limits.projects}
                    percentage={getProjectUsagePercentage(subscription)}
                />
            </div>

            <div className="pt-2 border-t">
                <Link href="/pricing" className="w-full">
                    <Button size="sm" className="w-full">
                        {subscription.plan === 'researcher' ? 'Manage' : 'Upgrade'}
                    </Button>
                </Link>
            </div>
        </div>
    );
}
