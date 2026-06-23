import { hasUnusedReferralValue, ReferralBalance } from "@/hooks/useReferralBalance";

export interface ReferralEntry {
    label: string;
    sublabel?: string;
    onClick: () => void;
}

// TODO: remove this gate once we're ready to offer referrals to all users
// (paid + basic). Until then the entry only renders for paid users, or for
// basic users with banked credits / a pending discount.
export const REFERRAL_ENABLED_FOR_BASIC =
    process.env.NEXT_PUBLIC_REFERRAL_BASIC_ENABLED === "true";

/**
 * Builds the "refer a friend" / "credit waiting" menu entry, or null when the
 * user shouldn't see one. Pure — the caller supplies the navigation actions so
 * this stays free of router/state dependencies.
 */
export function buildReferralEntry({
    referralBalance,
    isPaid,
    onNavigateToPricing,
    onOpenReferral,
}: {
    referralBalance: ReferralBalance | null;
    isPaid: boolean;
    onNavigateToPricing: () => void;
    onOpenReferral: () => void;
}): ReferralEntry | null {
    const hasValue = hasUnusedReferralValue(referralBalance);

    // Basic users with a banked credit or pending discount: route them to
    // pricing — they can't "use" the credit until they upgrade.
    if (!isPaid && hasValue && referralBalance) {
        const dollars = (referralBalance.available_cents / 100).toFixed(0);
        const hasCredit = referralBalance.available_cents > 0;
        const hasDiscount = referralBalance.referee_discount_available;
        let label = "Referral credit waiting";
        if (hasCredit && hasDiscount) label = `$${dollars} credit + 50% off waiting`;
        else if (hasCredit) label = `$${dollars} credit waiting`;
        else if (hasDiscount) label = `${referralBalance.referee_discount_percent}% off waiting`;
        return {
            label,
            sublabel: "Upgrade to redeem",
            onClick: onNavigateToPricing,
        };
    }

    if (isPaid || REFERRAL_ENABLED_FOR_BASIC) {
        const earned =
            referralBalance && referralBalance.available_cents > 0
                ? `$${(referralBalance.available_cents / 100).toFixed(0)} earned`
                : undefined;
        return {
            label: "Refer a friend",
            sublabel: earned,
            onClick: onOpenReferral,
        };
    }

    return null;
}
