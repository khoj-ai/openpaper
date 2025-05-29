"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface PricingFeature {
    name: string;
    base: string | boolean;
    researcher: string | boolean;
    teams: string | boolean;
}

const features: PricingFeature[] = [
    {
        name: "Annotations",
        base: true,
        researcher: true,
        teams: true
    },
    {
        name: "Notes",
        base: true,
        researcher: true,
        teams: true
    },
    {
        name: "Paper finder",
        base: true,
        researcher: true,
        teams: true
    },
    {
        name: "Paper uploads",
        base: "10",
        researcher: "500",
        teams: "unlimited"
    },
    {
        name: "Knowledge base size",
        base: "500 MB",
        researcher: "3 GB",
        teams: "50 GB"
    },
    {
        name: "Models",
        base: "Basic",
        researcher: "Advanced",
        teams: "Advanced"
    },
    {
        name: "Chat credits (daily)",
        base: "500",
        researcher: "10,000",
        teams: "unlimited"
    },
    {
        name: "Audio overviews (monthly)",
        base: "5",
        researcher: "100",
        teams: "unlimited"
    },
    {
        name: "Literature review (monthly)",
        base: "2",
        researcher: "100",
        teams: "500"
    },
    {
        name: "Team annotations",
        base: false,
        researcher: false,
        teams: true
    },
    {
        name: "Team chat",
        base: false,
        researcher: false,
        teams: true
    }
];

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState("base");

    const planOptions = [
        { value: "base", label: "Base" },
        { value: "researcher", label: "Researcher" },
        { value: "teams", label: "Teams" }
    ];

    const getFeatureValueForPlan = (feature: PricingFeature, plan: string) => {
        switch (plan) {
            case "base":
                return feature.base;
            case "researcher":
                return feature.researcher;
            case "teams":
                return feature.teams;
            default:
                return feature.base;
        }
    };

    const renderFeatureValue = (value: string | boolean, isComingSoon?: boolean) => {
        if (typeof value === "boolean") {
            return value ? (
                <Check className="h-5 w-5 text-green-500 mx-auto" />
            ) : (
                <X className="h-5 w-5 text-gray-400 mx-auto" />
            );
        }

        if (isComingSoon) {
            return (
                <div className="flex items-center gap-2 justify-center">
                    <Clock className="h-4 w-4 text-amber-500" />
                    <span className="text-sm text-muted-foreground">{value}</span>
                </div>
            );
        }

        return <span>{value}</span>;
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
                <div className="flex items-center justify-center gap-4 mt-8">
                    <span className={cn("text-sm", !isAnnual && "font-semibold")}>Monthly</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAnnual(!isAnnual)}
                        className="relative"
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
                </div>
            </div>

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
                        <Button className="w-full" variant="outline" onClick={() => { window.location.href = '/login' }}>
                            Get Started
                        </Button>
                    </CardContent>
                </Card>

                {/* Researcher Plan */}
                <Card className="relative border-blue-600 dark:border-blue-400 shadow-lg">
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 dark:bg-blue-400">Recommended</Badge>
                    <CardHeader>
                        <CardTitle className="text-2xl">Researcher</CardTitle>
                        <CardDescription>For independent researchers</CardDescription>
                        <div className="text-3xl font-bold">
                            ${isAnnual ? "8" : "12"}
                            <span className="text-lg font-normal text-muted-foreground">/mo</span>
                        </div>
                        {isAnnual && (
                            <p className="text-sm text-muted-foreground">Billed annually at $96/year</p>
                        )}
                    </CardHeader>
                    <CardContent>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="w-full bg-blue-600 dark:bg-blue-400">
                                    Upgrade to Researcher
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Free for 1 Month</DialogTitle>
                                    <DialogDescription>
                                        While we are in open beta, you can upgrade to the Researcher plan for 1 month free.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="mt-4">
                                    <p className="text-sm text-muted-foreground mb-2">
                                        Enjoy 500 paper uploads, 3 GB knowledge base, and more! Get access to advanced features and increased limits.
                                    </p>
                                </div>
                                <div className="text-sm text-muted-foreground mb-4 flex justify-between">
                                    <DialogClose asChild>
                                        <Button variant="outline" className="w-fit">
                                            Cancel
                                        </Button>
                                    </DialogClose>
                                    <Button className="w-auto bg-blue-600 dark:bg-blue-400" onClick={() => { window.location.href = '/upgrade' }}>
                                        Upgrade Now
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </CardContent>
                </Card>

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
            {/* Feature Comparison Table */}
            <div className="space-y-4">
                <h2 className="text-2xl font-bold text-center">Feature Comparison</h2>

                {/* Mobile Plan Selector */}
                <div className="sm:hidden mb-4">
                    <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a plan" />
                        </SelectTrigger>
                        <SelectContent>
                            {planOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                    {option.value === "researcher" && (
                                        <Badge variant="secondary" className="ml-2 text-xs">
                                            Recommended
                                        </Badge>
                                    )}
                                    {option.value === "teams" && (
                                        <Badge variant="outline" className="ml-2 text-xs">
                                            Coming Soon
                                        </Badge>
                                    )}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Desktop Table */}
                <div className="hidden sm:block border border-border rounded-lg min-w-[600px]">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                <th className="text-left p-2 sm:p-4 font-semibold">Features</th>
                                <th className="text-center p-2 sm:p-4 font-semibold min-w-[80px]">Base</th>
                                <th className="text-center p-2 sm:p-4 font-semibold min-w-[100px]">Researcher</th>
                                <th className="text-center p-2 sm:p-4 font-semibold min-w-[80px]">Teams</th>
                            </tr>
                        </thead>
                        <tbody>
                            {features.map((feature, index) => {
                                const isComingSoon = feature.name === "Literature review (monthly)";
                                const isTeamsOnly = feature.name === "Team annotations" || feature.name === "Team chat";

                                return (
                                    <tr key={feature.name} className={cn(
                                        "border-b",
                                        index % 2 === 0 && "bg-muted/20"
                                    )}>
                                        <td className="p-2 sm:p-4 font-medium">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-sm sm:text-base">{feature.name}</span>
                                                {isComingSoon && (
                                                    <Badge variant="outline" className="text-xs w-fit">
                                                        Coming Soon
                                                    </Badge>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-2 sm:p-4 text-center text-sm sm:text-base">
                                            {renderFeatureValue(feature.base, isComingSoon)}
                                        </td>
                                        <td className="p-2 sm:p-4 text-center text-sm sm:text-base">
                                            {renderFeatureValue(feature.researcher, isComingSoon)}
                                        </td>
                                        <td className="p-2 sm:p-4 text-center text-sm sm:text-base">
                                            {isTeamsOnly ? (
                                                <div className="flex flex-col items-center justify-center gap-1">
                                                    <Check className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
                                                    <Badge variant="secondary" className="text-xs">
                                                        Coming Soon
                                                    </Badge>
                                                </div>
                                            ) : (
                                                renderFeatureValue(feature.teams, isComingSoon)
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Table */}
                <div className="sm:hidden">
                    <Card>
                        <CardHeader className="pb-4">
                            <CardTitle className="text-lg capitalize">{selectedPlan} Plan</CardTitle>
                            {selectedPlan === "researcher" && (
                                <Badge className="w-fit bg-blue-600 dark:bg-blue-400">Recommended</Badge>
                            )}
                            {selectedPlan === "teams" && (
                                <Badge variant="secondary" className="w-fit">Coming Soon</Badge>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {features.map((feature, index) => {
                                const isComingSoon = feature.name === "Literature review (monthly)";
                                const isTeamsOnly = feature.name === "Team annotations" || feature.name === "Team chat";
                                const featureValue = getFeatureValueForPlan(feature, selectedPlan);

                                return (
                                    <div key={feature.name} className={cn(
                                        "flex justify-between items-center py-3 px-4 rounded-lg",
                                        index % 2 === 0 && "bg-muted/20"
                                    )}>
                                        <div className="flex flex-col gap-1">
                                            <span className="font-medium text-sm">{feature.name}</span>
                                            {isComingSoon && (
                                                <Badge variant="outline" className="text-xs w-fit">
                                                    Coming Soon
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            {isTeamsOnly && selectedPlan === "teams" ? (
                                                <div className="flex flex-col items-end gap-1">
                                                    <Check className="h-4 w-4 text-green-500" />
                                                    <Badge variant="secondary" className="text-xs">
                                                        Coming Soon
                                                    </Badge>
                                                </div>
                                            ) : (
                                                renderFeatureValue(featureValue, isComingSoon)
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                </div>
            </div>

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
