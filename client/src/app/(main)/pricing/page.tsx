"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Crown, Calendar } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import CheckoutSheet from "./checkout";
import { fetchFromApi } from "@/lib/api";
import { UserSubscription } from "@/lib/schema";
import PricingTable from "./pricingTable";

const monthlyPrice = 12;
const annualPrice = 8;

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState("basic");
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
    const [loading, setLoading] = useState(true);

    const annualSavings = (monthlyPrice - annualPrice) * 12;

    // Fetch user subscription status
    useEffect(() => {
        const fetchSubscription = async () => {
            try {
                const response: UserSubscription = await fetchFromApi("/api/subscription/user-subscription", {
                    method: "GET",
                });

                console.log('Fetched user subscription:', response);

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

        fetchSubscription();
    }, []);

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
    const canResubscribe = userSubscription?.has_subscription && (subscriptionStatus === 'canceled' || userSubscription?.subscription?.cancel_at_period_end);

    const getStatusBadgeColor = (status: string | undefined) => {
        switch (status) {
            case 'active':
                return 'bg-green-600 text-white';
            case 'trialing':
                return 'bg-blue-600 text-white';
            case 'canceled':
                return 'bg-red-600 text-white';
            case 'past_due':
                return 'bg-yellow-600 text-white';
            case 'incomplete':
                return 'bg-orange-600 text-white';
            case 'unpaid':
                return 'bg-red-600 text-white';
            default:
                return 'bg-gray-600 text-white';
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
        <div className="max-w-6xl mx-auto p-2 sm:p-8 space-y-12">
            {/* Header */}
            <div className="text-center space-y-4">
                <h1 className="text-4xl font-bold">Simple, Transparent Pricing</h1>
                <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                    Choose the plan fit for your research needs. All plans include unlimited annotations and notes.
                </p>


                {/* Billing Toggle */}
                {!loading && (
                    <div className="flex items-center justify-center gap-4 mt-8">
                        <span className={cn("text-sm", !isAnnual && "font-semibold")}>Monthly</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsAnnual(!isAnnual)}
                            className="relative"
                            disabled={isActiveSubscription} // Only disable for truly active subscriptions
                        >
                            <div className={cn(
                                "w-12 h-6 rounded-full transition-colors",
                                isAnnual ? "bg-primary" : "bg-gray-300"
                            )}>
                                <div className={cn(
                                    "w-5 h-5 rounded-full bg-white transition-transform mt-0.5",
                                    isAnnual ? "translate-x-6 ml-0.5" : "translate-x-0.5"
                                )} />
                            </div>
                        </Button>
                        <span className={cn("text-sm", isAnnual && "font-semibold")}>
                            Annual
                            <Badge variant="secondary" className="ml-2">33% off</Badge>
                        </span>
                        {isCurrentlySubscribed && (
                            <Badge variant="outline" className="ml-2">
                                {isActiveSubscription ? "Current: " : "Previous: "}
                                {userSubscription?.subscription.interval === "year" ? "Annual" : "Monthly"}
                            </Badge>
                        )}
                    </div>
                )}
            </div>

            {/* Current Subscription Card */}
            {isCurrentlySubscribed && (
                <Card className={cn(
                    "border-2",
                    isActiveSubscription ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-red-500 bg-red-50 dark:bg-red-950/20"
                )}>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Crown className={cn(
                                "h-5 w-5",
                                isActiveSubscription ? "text-green-600" : "text-red-600"
                            )} />
                            <CardTitle className={cn(
                                "text-xl",
                                isActiveSubscription ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                            )}>
                                Your Current Subscription
                            </CardTitle>
                            <Badge className={getStatusBadgeColor(subscriptionStatus)}>
                                {getStatusDisplay(subscriptionStatus)}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid md:grid-cols-3 gap-4">
                            <div className="text-center">
                                <div className={cn(
                                    "text-2xl font-bold",
                                    isActiveSubscription ? "text-green-600" : "text-red-600"
                                )}>
                                    Researcher Plan
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {isActiveSubscription ? "Active Subscription" : "Subscription Not Active"}
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold">
                                    ${userSubscription?.subscription.interval === "year" ? annualPrice : monthlyPrice}
                                    <span className="text-lg font-normal text-muted-foreground">/mo</span>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    Billed {userSubscription?.subscription.interval === "year" ? "Annually" : "Monthly"}
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-1 text-lg font-semibold">
                                    <Calendar className="h-4 w-4" />
                                    {userSubscription?.subscription.current_period_end &&
                                        formatDate(userSubscription.subscription.current_period_end)
                                    }
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {subscriptionStatus === 'canceled' || userSubscription?.subscription.cancel_at_period_end ? "Expires" : "Renews"}
                                </div>
                            </div>
                        </div>

                        {/* Status-specific alerts */}
                        {subscriptionStatus === 'canceled' && (
                            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                                    <Clock className="h-4 w-4" />
                                    <span className="font-medium">Subscription Canceled</span>
                                </div>
                                <p className="text-sm text-red-600 dark:text-red-500 mt-1">
                                    Your subscription was canceled and will end on {userSubscription?.subscription.current_period_end &&
                                        formatDate(userSubscription.subscription.current_period_end)}.
                                    You can reactivate anytime before this date.
                                </p>
                            </div>
                        )}

                        {userSubscription?.subscription.cancel_at_period_end && subscriptionStatus === 'active' && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                                    <Clock className="h-4 w-4" />
                                    <span className="font-medium">Subscription Ending</span>
                                </div>
                                <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">
                                    Your subscription will end on {userSubscription?.subscription.current_period_end &&
                                        formatDate(userSubscription.subscription.current_period_end)}.
                                    You can reactivate anytime before this date.
                                </p>
                            </div>
                        )}

                        {subscriptionStatus === 'past_due' && (
                            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                                    <Clock className="h-4 w-4" />
                                    <span className="font-medium">Payment Past Due</span>
                                </div>
                                <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-1">
                                    Your payment is past due. Please update your payment method to continue your subscription.
                                </p>
                            </div>
                        )}

                        {subscriptionStatus === 'incomplete' && (
                            <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                                    <Clock className="h-4 w-4" />
                                    <span className="font-medium">Payment Incomplete</span>
                                </div>
                                <p className="text-sm text-orange-600 dark:text-orange-500 mt-1">
                                    Your payment is incomplete. Please complete the payment process to activate your subscription.
                                </p>
                            </div>
                        )}

                        {/* Resubscribe button for canceled/ending subscriptions */}
                        {canResubscribe && (
                            <div className="pt-4 border-t">
                                <Button
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                                    onClick={() => setIsCheckoutOpen(true)}
                                >
                                    Reactivate Subscription
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Pricing Cards */}
            <div className="grid md:grid-cols-3 gap-8 mb-12">
                {/* Base Plan */}
                <Card className="relative">
                    <CardHeader>
                        <CardTitle className="text-2xl">Base</CardTitle>
                        <CardDescription>Perfect for getting started</CardDescription>
                        <div className="text-3xl font-bold">
                            $0<span className="text-lg font-normal text-muted-foreground">/mo</span>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Button
                            className="w-full"
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
                    "relative shadow-lg",
                    isActiveSubscription
                        ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                        : "border-blue-600 dark:border-blue-400"
                )}>
                    <Badge className={cn(
                        "absolute -top-3 left-1/2 -translate-x-1/2",
                        isActiveSubscription
                            ? "bg-green-600 dark:bg-green-400"
                            : "bg-blue-600 dark:bg-blue-400"
                    )}>
                        {isActiveSubscription ? "Current Plan" : "Recommended"}
                    </Badge>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <CardTitle className="text-2xl">Researcher</CardTitle>
                            {isActiveSubscription && <Crown className="h-5 w-5 text-green-600" />}
                        </div>
                        <CardDescription>For independent researchers</CardDescription>
                        <div className="text-3xl font-bold">
                            ${isAnnual ? annualPrice : monthlyPrice}
                            <span className="text-lg font-normal text-muted-foreground">/mo</span>
                        </div>
                        {isAnnual && (
                            <p className="text-sm text-muted-foreground">Billed annually at ${annualPrice * 12}/year</p>
                        )}
                        {isActiveSubscription && (
                            <Badge variant="outline" className="w-fit">
                                Active since {userSubscription?.subscription.current_period_start &&
                                    formatDate(userSubscription.subscription.current_period_start)
                                }
                            </Badge>
                        )}
                    </CardHeader>
                    <CardContent>
                        <Button
                            className={cn(
                                "w-full",
                                isActiveSubscription
                                    ? "bg-green-600 dark:bg-green-400"
                                    : canResubscribe
                                    ? "bg-blue-600 dark:bg-blue-400"
                                    : "bg-blue-600 dark:bg-blue-400"
                            )}
                            onClick={() => setIsCheckoutOpen(true)}
                            disabled={isActiveSubscription}
                        >
                            {isActiveSubscription
                                ? "Current Plan"
                                : canResubscribe
                                ? "Reactivate Subscription"
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
                />

                {/* Teams Plan */}
                <Card className="relative opacity-75">
                    <Badge variant="secondary" className="absolute -top-3 left-1/2 -translate-x-1/2">
                        Coming Soon
                    </Badge>
                    <CardHeader>
                        <CardTitle className="text-2xl">Teams</CardTitle>
                        <CardDescription>For research teams and organizations</CardDescription>
                        <div className="text-3xl font-bold">
                            TBD<span className="text-lg font-normal text-muted-foreground">/mo</span>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full" variant="outline" disabled>
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

            {/* FAQ or Additional Info */}
            <div className="text-center space-y-4 pt-8 border-t">
                <h3 className="text-xl font-semibold">Questions?</h3>
                <p className="text-muted-foreground">
                    Need help choosing the right plan? Contact us and we will help you find the perfect fit for your research needs.
                </p>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="outline" className="w-fit mx-auto">
                            Contact Support
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Contact Support</DialogTitle>
                            <DialogDescription>
                                If you have any questions about our pricing or need help choosing a plan, please reach out to us.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="mt-4">
                            <p className="text-sm text-muted-foreground mb-2">
                                You can email us at {" "}
                                <a href="mailto:saba@openpaper.ai" className="underline">
                                    saba@openpaper.ai
                                </a>
                                .
                            </p>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
