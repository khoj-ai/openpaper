"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Calendar, CheckCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import CheckoutSheet from "./checkout";
import { fetchFromApi } from "@/lib/api";
import { UserSubscription } from "@/lib/schema";
import PricingTable from "./pricingTable";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

const monthlyPrice = 12;
const annualPrice = 8;

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState("basic");
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
    const [loading, setLoading] = useState(true);
    const [isPortalLoading, setIsPortalLoading] = useState(false);
    const [isIntervalChangeLoading, setIsIntervalChangeLoading] = useState(false);
    const [isResubscribeLoading, setIsResubscribeLoading] = useState(false);
    const { user } = useAuth();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const router = useRouter();

    const annualSavings = (monthlyPrice - annualPrice) * 12;

    // Fetch user subscription status
    useEffect(() => {
        const fetchSubscription = async () => {
            try {
                const response: UserSubscription = await fetchFromApi("/api/subscription/user-subscription", {
                    method: "GET",
                });

                setUserSubscription(response);

                // Set billing toggle based on user's current subscription
                if (response.has_subscription) {
                    setIsAnnual(response.subscription.interval === "year");
                }
            } catch (error) {
                console.error('Failed to fetch subscription:', error);
            } finally {
                setLoading(false);
            }
        };

        if (user) {
            fetchSubscription();
        } else {
            setLoading(false);
        }
    }, [user]);

    const handleManageSubscription = async () => {
        setIsPortalLoading(true);
        try {
            const response = await fetchFromApi("/api/subscription/create-portal-session", {
                method: "POST",
            });

            if (response.url) {
                window.location.href = response.url;
            }
        } catch (error) {
            console.error('Failed to create portal session:', error);
            // You might want to show a toast notification here
            toast.error('Failed to open subscription management portal. Please try again later. Contact support if the issue persists.');
        } finally {
            setIsPortalLoading(false);
        }
    };

    const handleIntervalChange = async (newInterval: "month" | "year") => {
        setIsIntervalChangeLoading(true);
        try {
            const response = await fetchFromApi(`/api/subscription/change-interval?new_interval=${newInterval}`, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (response.success) {
                // Update the local state to reflect the change
                setIsAnnual(newInterval === "year");

                toast.success(`Billing interval changed to ${newInterval === "year" ? "annual" : "monthly"} successfully.`);

                // Add delay to ensure backend state is updated before refreshing
                await new Promise(resolve => setTimeout(resolve, 800));

                // Optionally refresh the subscription data
                const updatedSubscription = await fetchFromApi("/api/subscription/user-subscription", {
                    method: "GET",
                });
                setUserSubscription(updatedSubscription);
            } else {
                console.error('Failed to change interval:', response.message);
                // You might want to show an error toast here
                toast.error(`Failed to change billing interval: ${response.message}`);
            }
        } catch (error) {
            console.error('Failed to change interval:', error);
            // You might want to show an error toast here
            toast.error('Failed to change billing interval. Please try again later.');
        } finally {
            setIsIntervalChangeLoading(false);
        }
    };

    const handleResubscribe = async () => {
        setIsResubscribeLoading(true);
        try {
            const response = await fetchFromApi("/api/subscription/resubscribe", {
                method: "POST",
            });

            if (response.success) {
                toast.success('Resubscription successful', {
                    description: 'Thank you for supporting open research! Your subscription has been reactivated.',
                });

                // Add delay to ensure backend state is updated before refreshing
                await new Promise(resolve => setTimeout(resolve, 800));

                // Refresh the subscription data to reflect the reactivated subscription
                const updatedSubscription = await fetchFromApi("/api/subscription/user-subscription", {
                    method: "GET",
                });

                setUserSubscription(updatedSubscription);
            } else {
                console.error('Failed to resubscribe:', response.error);
                // You might want to show an error toast here
                toast.error(`Failed to resubscribe: ${response.error}`);
            }
        } catch (error) {
            console.error('Failed to resubscribe:', error);
            // You might want to show an error toast here
            toast.error('Failed to resubscribe. Please try again later.');
        } finally {
            setIsResubscribeLoading(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const isCurrentlySubscribed = userSubscription?.has_subscription;
    const subscriptionStatus = userSubscription?.subscription?.status;
    const isActiveSubscription = subscriptionStatus === 'active' || subscriptionStatus === 'trialing';
    const isCanceled = subscriptionStatus === 'canceled' || userSubscription?.subscription?.cancel_at_period_end;
    const canResubscribe = userSubscription?.has_subscription && isCanceled;

    const getStatusBadgeColor = (status: string | undefined) => {
        switch (status) {
            case 'active':
                return 'bg-green-600 text-white border-green-600';
            case 'trialing':
                return 'bg-yellow-600 text-white border-yellow-600';
            case 'canceled':
                return 'bg-red-400 text-white border-red-400';
            case 'past_due':
                return 'bg-amber-600 text-white border-amber-600';
            case 'incomplete':
                return 'bg-amber-400 text-white border-amber-400';
            case 'unpaid':
                return 'bg-amber-400 text-white border-amber-400';
            default:
                return 'bg-slate-400 text-white border-slate-400';
        }
    };

    const getStatusDisplay = (status: string | undefined) => {
        switch (status) {
            case 'active':
                return 'Active';
            case 'trialing':
                return 'Trial';
            case 'canceled':
                return 'Canceled';
            case 'past_due':
                return 'Past Due';
            case 'incomplete':
                return 'Incomplete';
            case 'unpaid':
                return 'Unpaid';
            default:
                return 'Unknown';
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-2 sm:p-8 space-y-16">
            {/* Header */}
            <div className="text-center space-y-6">
                <div className="space-y-3">
                    <h1 className="text-4xl font-light tracking-tight text-slate-900 dark:text-slate-100">
                        Research Plans
                    </h1>
                    <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
                        Choose the plan that fits your research workflow. All plans include unlimited annotations and comprehensive note-taking capabilities.
                    </p>
                </div>
            </div>

            {/* Loading Skeleton for Subscription Card */}
            {loading && (
                <Card className="border-2 border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                    <CardHeader className="py-4">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="h-4 w-24" />
                            </div>
                            <Skeleton className="h-6 w-16 rounded-full" />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 my-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                            <div className="text-center sm:text-left space-y-2">
                                <Skeleton className="h-6 w-28 mx-auto sm:mx-0" />
                                <Skeleton className="h-4 w-36 mx-auto sm:mx-0" />
                            </div>
                            <div className="text-center space-y-2">
                                <Skeleton className="h-6 w-20 mx-auto" />
                                <Skeleton className="h-4 w-24 mx-auto" />
                            </div>
                            <div className="text-center sm:text-right space-y-2 sm:col-span-2 md:col-span-1">
                                <Skeleton className="h-5 w-32 mx-auto sm:ml-auto sm:mr-0" />
                                <Skeleton className="h-4 w-16 mx-auto sm:ml-auto sm:mr-0" />
                            </div>
                        </div>
                        <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                            <Skeleton className="h-10 w-full" />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Current Subscription Card */}
            {isCurrentlySubscribed && !loading && (
                <Card className={cn(
                    "border-2 transition-all duration-200",
                    isActiveSubscription
                        ? "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30"
                )}>
                    <CardHeader className="py-4">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "p-2 rounded-full",
                                isActiveSubscription
                                    ? "bg-slate-100 dark:bg-slate-800"
                                    : "bg-slate-100 dark:bg-slate-800"
                            )}>
                                <CheckCircle className={cn(
                                    "h-4 w-4",
                                    isActiveSubscription
                                        ? "text-slate-700 dark:text-slate-300"
                                        : "text-slate-500 dark:text-slate-400"
                                )} />
                            </div>
                            <div className="flex-1">
                                <CardTitle className="text-lg font-medium text-slate-900 dark:text-slate-100">
                                    Your Research Plan
                                </CardTitle>
                                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                                    {isActiveSubscription ? "Currently active" : "Subscription not active"}
                                </CardDescription>
                            </div>
                            <Badge className={cn("font-normal", getStatusBadgeColor(subscriptionStatus))}>
                                {getStatusDisplay(subscriptionStatus)}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 my-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                            <div className="text-center sm:text-left space-y-1">
                                <div className="text-lg sm:text-xl font-medium text-slate-900 dark:text-slate-100">
                                    Researcher Plan
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                    Full access to all features
                                </div>
                            </div>
                            <div className="text-center space-y-1">
                                <div className="text-lg sm:text-xl font-medium text-slate-900 dark:text-slate-100">
                                    ${userSubscription?.subscription.interval === "year" ? annualPrice : monthlyPrice}
                                    <span className="text-sm sm:text-base font-normal text-slate-500 dark:text-slate-400">/month</span>
                                </div>
                                <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                    Billed {userSubscription?.subscription.interval === "year" ? "annually" : "monthly"}
                                    {isIntervalChangeLoading && (
                                        <Badge variant="secondary" className="ml-2 text-xs">
                                            Updating...
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            <div className="text-center sm:text-right space-y-1 sm:col-span-2 md:col-span-1">
                                <div className="flex items-center justify-center sm:justify-end gap-2 text-sm sm:text-lg font-medium text-slate-900 dark:text-slate-100">
                                    <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                                    <span className="break-words">
                                        {userSubscription?.subscription.current_period_end &&
                                            formatDate(userSubscription.subscription.current_period_end)
                                        }
                                    </span>
                                </div>
                                <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                    {subscriptionStatus === 'canceled' || userSubscription?.subscription.cancel_at_period_end ? "Expires" : "Renews"}
                                </div>
                            </div>
                        </div>

                        {/* Status-specific alerts */}
                        {subscriptionStatus === 'canceled' && (
                            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 sm:p-4">
                                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                    <Clock className="h-4 w-4 flex-shrink-0" />
                                    <span className="font-medium text-sm sm:text-base">Subscription Canceled</span>
                                </div>
                                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                                    Your subscription will end on {userSubscription?.subscription.current_period_end &&
                                        formatDate(userSubscription.subscription.current_period_end)}.
                                    You can reactivate anytime before this date.
                                </p>
                            </div>
                        )}

                        {userSubscription?.subscription.cancel_at_period_end && subscriptionStatus === 'active' && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 sm:p-4">
                                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                                    <Clock className="h-4 w-4 flex-shrink-0" />
                                    <span className="font-medium text-sm sm:text-base">Subscription Ending</span>
                                </div>
                                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400 mt-1">
                                    Your subscription will end on {userSubscription?.subscription.current_period_end &&
                                        formatDate(userSubscription.subscription.current_period_end)}.
                                    You can reactivate anytime before this date.
                                </p>
                            </div>
                        )}

                        {subscriptionStatus === 'past_due' && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 sm:p-4">
                                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                                    <Clock className="h-4 w-4 flex-shrink-0" />
                                    <span className="font-medium text-sm sm:text-base">Payment Past Due</span>
                                </div>
                                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400 mt-1">
                                    Your payment is past due. Please update your payment method to continue your subscription.
                                </p>
                            </div>
                        )}

                        {subscriptionStatus === 'incomplete' && (
                            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 sm:p-4">
                                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                    <Clock className="h-4 w-4 flex-shrink-0" />
                                    <span className="font-medium text-sm sm:text-base">Payment Incomplete</span>
                                </div>
                                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                                    Your payment is incomplete. Please complete the payment process to activate your subscription.
                                </p>
                            </div>
                        )}

                        {/* Action buttons based on subscription status */}
                        <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                            {canResubscribe ? (
                                <Button
                                    className="w-full bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-medium"
                                    onClick={handleResubscribe}
                                    disabled={isResubscribeLoading}
                                >
                                    {isResubscribeLoading ? "Reactivating..." : "Reactivate Subscription"}
                                </Button>
                            ) : (
                                <Button
                                    className="w-full bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-medium"
                                    onClick={handleManageSubscription}
                                    disabled={isPortalLoading}
                                >
                                    {isPortalLoading ? "Loading..." : "Manage Subscription"}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Billing Toggle */}
            {!loading && (
                <div className="flex flex-col items-center justify-center gap-3 sm:gap-6 mt-12 px-4">
                    {/* Toggle Row */}
                    <div className="flex items-center gap-3 sm:gap-4">
                        <span className={cn(
                            "text-xs sm:text-sm font-medium transition-colors",
                            !isAnnual ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                        )}>
                            Monthly
                        </span>
                        {isActiveSubscription ? (
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="relative p-0"
                                        disabled={isIntervalChangeLoading}
                                    >
                                        <div className={cn(
                                            "w-12 h-6 sm:w-14 sm:h-7 rounded-full transition-all duration-200",
                                            isAnnual ? "bg-slate-800 dark:bg-slate-200" : "bg-slate-200 dark:bg-slate-700"
                                        )}>
                                            <div className={cn(
                                                "w-4 h-4 sm:w-5 sm:h-5 rounded-full transition-all duration-200 mt-1",
                                                isAnnual
                                                    ? "translate-x-7 sm:translate-x-8 bg-white dark:bg-slate-800"
                                                    : "translate-x-1 bg-slate-600 dark:bg-slate-300"
                                            )} />
                                        </div>
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="border-slate-200 dark:border-slate-700 mx-4">
                                    <DialogHeader>
                                        <DialogTitle className="text-slate-900 dark:text-slate-100">
                                            Change Billing Cycle
                                        </DialogTitle>
                                        <DialogDescription className="text-slate-600 dark:text-slate-400">
                                            Switch from {isAnnual ? "annual" : "monthly"} to {isAnnual ? "monthly" : "annual"} billing.
                                            The change will take effect at the end of your current billing cycle.
                                        </DialogDescription>
                                        {!isAnnual && (
                                            <DialogDescription className="text-slate-600 dark:text-slate-400">
                                                You will be charged the prorated amount for the remainder of the new billing cycle, effective immediately.
                                            </DialogDescription>
                                        )}
                                    </DialogHeader>
                                    <div className="flex gap-3 mt-4">
                                        <DialogTrigger asChild>
                                            <Button variant="outline" className="flex-1">
                                                Cancel
                                            </Button>
                                        </DialogTrigger>
                                        <Button
                                            className="flex-1 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900"
                                            onClick={() => handleIntervalChange(isAnnual ? "month" : "year")}
                                            disabled={isIntervalChangeLoading}
                                        >
                                            {isIntervalChangeLoading ? "Changing..." : `Switch to ${isAnnual ? "Monthly" : "Annual"}`}
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsAnnual(!isAnnual)}
                                className="relative p-0"
                                disabled={isActiveSubscription}
                            >
                                <div className={cn(
                                    "w-12 h-6 sm:w-14 sm:h-7 rounded-full transition-all duration-200",
                                    isAnnual ? "bg-slate-800 dark:bg-slate-200" : "bg-slate-200 dark:bg-slate-700"
                                )}>
                                    <div className={cn(
                                        "w-4 h-4 sm:w-5 sm:h-5 rounded-full transition-all duration-200 mt-1",
                                        isAnnual
                                            ? "translate-x-7 sm:translate-x-8 bg-white dark:bg-slate-800"
                                            : "translate-x-1 bg-slate-600 dark:bg-slate-300"
                                    )} />
                                </div>
                            </Button>
                        )}
                        <div className="flex items-center gap-1 sm:gap-2">
                            <span className={cn(
                                "text-xs sm:text-sm font-medium transition-colors",
                                isAnnual ? "text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                            )}>
                                Annual
                            </span>
                            <Badge variant="secondary" className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-0 text-xs px-2 py-0.5">
                                {isCurrentlySubscribed && isAnnual ? `Saving $${annualSavings}/year!` : `Save $${annualSavings}/year`}
                            </Badge>
                        </div>
                    </div>

                </div>
            )}

            {/* Pricing Cards */}
            <div className="grid md:grid-cols-3 gap-8 py-4">
                {/* Base Plan */}
                <Card className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:shadow-lg transition-shadow duration-200">
                    <CardHeader className="pb-4">
                        <div className="space-y-2">
                            <CardTitle className="text-xl font-medium text-slate-900 dark:text-slate-100">
                                Base
                            </CardTitle>
                            <CardDescription className="text-slate-600 dark:text-slate-400">
                                Perfect for getting started with research
                            </CardDescription>
                        </div>
                        <div className="pt-4">
                            <div className="text-3xl font-light text-slate-900 dark:text-slate-100">
                                $0
                                <span className="text-lg font-normal text-slate-500 dark:text-slate-400">/month</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Button
                            className="w-full font-medium border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                            variant="outline"
                            onClick={() => { window.location.href = '/login' }}
                            disabled={isActiveSubscription}
                        >
                            {isActiveSubscription ? "Researcher Plan Active" : "Get Started"}
                        </Button>
                    </CardContent>
                </Card>

                {/* Researcher Plan */}
                <Card className={cn(
                    "relative border-2 transition-all duration-200",
                    isActiveSubscription
                        ? "border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/50 shadow-lg"
                        : "border-slate-900 dark:border-slate-100 bg-white dark:bg-slate-900 shadow-lg"
                )}>
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className={cn(
                            "font-normal px-3 py-1",
                            isActiveSubscription
                                ? "bg-blue-800 dark:bg-blue-200 text-white dark:text-slate-900"
                                : "bg-blue-900 dark:bg-blue-100 text-white dark:text-slate-900"
                        )}>
                            {isActiveSubscription ? "Your Plan" : "Recommended"}
                        </Badge>
                    </div>
                    <CardHeader className="pb-4">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <CardTitle className="text-xl font-medium text-slate-900 dark:text-slate-100">
                                    Researcher
                                </CardTitle>
                                {isActiveSubscription && (
                                    <CheckCircle className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                                )}
                            </div>
                            <CardDescription className="text-slate-600 dark:text-slate-400">
                                For independent researchers and academics
                            </CardDescription>
                        </div>
                        <div className="pt-4">
                            <div className="text-3xl font-light text-slate-900 dark:text-slate-100">
                                ${isAnnual ? annualPrice : monthlyPrice}
                                <span className="text-lg font-normal text-slate-500 dark:text-slate-400">/month</span>
                            </div>
                            {isAnnual && (
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                    Billed annually at ${annualPrice * 12}/year
                                </p>
                            )}
                        </div>
                        {isActiveSubscription && (
                            <Badge variant="outline" className="w-fit mt-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                                Active since {userSubscription?.subscription.current_period_start &&
                                    formatDate(userSubscription.subscription.current_period_start)
                                }
                            </Badge>
                        )}
                    </CardHeader>
                    <CardContent>
                        <Button
                            className={cn(
                                "w-full font-medium transition-colors",
                                isActiveSubscription
                                    ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-default"
                                    : "bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900"
                            )}
                            onClick={() => {
                                if (!user) {
                                    setIsModalOpen(true);
                                } else if (canResubscribe) {
                                    handleResubscribe();
                                } else {
                                    setIsCheckoutOpen(true);
                                }
                            }}
                            disabled={isActiveSubscription || isResubscribeLoading}
                        >
                            {isActiveSubscription
                                ? "Current Plan"
                                : canResubscribe
                                    ? (isResubscribeLoading ? "Reactivating..." : "Reactivate Subscription")
                                    : "Upgrade to Researcher"}
                        </Button>
                    </CardContent>
                </Card>

                <CheckoutSheet
                    open={isCheckoutOpen}
                    onOpenChange={setIsCheckoutOpen}
                    interval={isAnnual ? "year" : "month"}
                    planName="Researcher"
                    annualSavings={annualSavings}
                    isResubscription={canResubscribe}
                />

                {/* Teams Plan */}
                <Card className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 opacity-60 relative">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge variant="secondary" className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-0">
                            Coming Soon
                        </Badge>
                    </div>
                    <CardHeader className="pb-4">
                        <div className="space-y-2">
                            <CardTitle className="text-xl font-medium text-slate-900 dark:text-slate-100">
                                Teams
                            </CardTitle>
                            <CardDescription className="text-slate-600 dark:text-slate-400">
                                For research teams and organizations
                            </CardDescription>
                        </div>
                        <div className="pt-4">
                            <div className="text-3xl font-light text-slate-900 dark:text-slate-100">
                                TBD
                                <span className="text-lg font-normal text-slate-500 dark:text-slate-400">/month</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Button
                            className="w-full font-medium border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
                            variant="outline"
                            disabled
                        >
                            Coming Soon
                        </Button>
                    </CardContent>
                </Card>
            </div>

            <PricingTable
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
                isActiveSubscription={isActiveSubscription}
                canResubscribe={canResubscribe ?? false}
                isCurrentlySubscribed={isCurrentlySubscribed || false}
            />

            {/* Support Section */}
            <div className="text-center space-y-6 pt-12 border-t border-slate-200 dark:border-slate-700">
                <div className="space-y-3">
                    <h3 className="text-xl font-medium text-slate-900 dark:text-slate-100">
                        Questions about pricing?
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                        We&apos;re here to help you find the right plan for your research needs.
                        Our team understands the unique requirements of academic work.
                    </p>
                </div>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="outline" className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">
                            Contact Support
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="border-slate-200 dark:border-slate-700">
                        <DialogHeader>
                            <DialogTitle className="text-slate-900 dark:text-slate-100">Contact Support</DialogTitle>
                            <DialogDescription className="text-slate-600 dark:text-slate-400">
                                If you have any questions about our pricing or need help choosing a plan, please reach out to us.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="mt-4">
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                You can email us at{" "}
                                <a href="mailto:saba@openpaper.ai" className="text-slate-900 dark:text-slate-100 underline underline-offset-2">
                                    saba@openpaper.ai
                                </a>
                            </p>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Please Log In</DialogTitle>
                        <DialogDescription>
                            You need to be logged in to view the pricing details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                            Close
                        </Button>
                        <Button onClick={() => router.push("/login")}>
                            Log In
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
