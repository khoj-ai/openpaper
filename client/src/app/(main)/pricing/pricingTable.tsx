import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Clock, Crown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PricingFeature {
    name: string;
    basic: string | boolean;
    researcher: string | boolean;
    teams: string | boolean;
}

const features: PricingFeature[] = [
    {
        name: "Annotations",
        basic: true,
        researcher: true,
        teams: true
    },
    {
        name: "Notes",
        basic: true,
        researcher: true,
        teams: true
    },
    {
        name: "Paper finder",
        basic: true,
        researcher: true,
        teams: true
    },
    {
        name: "Paper uploads",
        basic: "50",
        researcher: "500",
        teams: "unlimited"
    },
    {
        name: "Knowledge base size",
        basic: "500 MB",
        researcher: "3 GB",
        teams: "50 GB"
    },
    {
        name: "Chat credits (weekly)",
        basic: "5000",
        researcher: "100,000",
        teams: "unlimited"
    },
    {
        name: "Audio overviews (weekly)",
        basic: "5",
        researcher: "100",
        teams: "unlimited"
    },
    {
        name: "Projects",
        basic: "2",
        researcher: "100",
        teams: "500"
    },
];


interface PricingTableProps {
    selectedPlan: string;
    setSelectedPlan: (plan: string) => void;
    isActiveSubscription: boolean;
    canResubscribe: boolean;
    isCurrentlySubscribed: boolean;
}

export default function PricingTable({
    selectedPlan,
    setSelectedPlan,
    isActiveSubscription,
    canResubscribe,
    isCurrentlySubscribed
}: PricingTableProps) {

    const planOptions = [
        { value: "basic", label: "Basic" },
        { value: "researcher", label: "Researcher" },
        { value: "teams", label: "Teams" }
    ];

    const getFeatureValueForPlan = (feature: PricingFeature, plan: string) => {
        switch (plan) {
            case "base":
                return feature.basic;
            case "researcher":
                return feature.researcher;
            case "teams":
                return feature.teams;
            default:
                return feature.basic;
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
        <>
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
                                    {option.value === "researcher" && isActiveSubscription && (
                                        <Badge variant="secondary" className="ml-2 text-xs">
                                            Current
                                        </Badge>
                                    )}
                                    {option.value === "researcher" && canResubscribe && !isActiveSubscription && (
                                        <Badge variant="outline" className="ml-2 text-xs">
                                            Reactivate
                                        </Badge>
                                    )}
                                    {option.value === "researcher" && !isCurrentlySubscribed && (
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
                                <th className="text-center p-2 sm:p-4 font-semibold min-w-[80px]">Basic</th>
                                <th className={cn(
                                    "text-center p-2 sm:p-4 font-semibold min-w-[100px]",
                                    isActiveSubscription && "bg-green-50 dark:bg-green-950"
                                )}>
                                    <div className="flex items-center justify-center gap-2">
                                        Researcher
                                        {isActiveSubscription && <Crown className="h-4 w-4 text-green-600" />}
                                        {canResubscribe && !isActiveSubscription && <Clock className="h-4 w-4 text-amber-600" />}
                                    </div>
                                </th>
                                <th className="text-center p-2 sm:p-4 font-semibold min-w-[80px] text-muted-foreground">
                                    <div className="flex flex-col items-center gap-1">
                                        Teams
                                        <Badge variant="outline" className="text-xs">
                                            Coming Soon
                                        </Badge>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {features.map((feature, index) => {
                                const isComingSoon = false; //feature.name === "Projects";

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
                                            {renderFeatureValue(feature.basic, isComingSoon)}
                                        </td>
                                        <td className={cn(
                                            "p-2 sm:p-4 text-center text-sm sm:text-base",
                                            isActiveSubscription && "bg-green-50 dark:bg-green-950"
                                        )}>
                                            {renderFeatureValue(feature.researcher, isComingSoon)}
                                        </td>
                                        <td className="p-2 sm:p-4 text-center text-sm sm:text-base text-muted-foreground">
                                            {renderFeatureValue(feature.teams, isComingSoon)}
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
                                const isComingSoon = feature.name === "Projects";
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
                                            {renderFeatureValue(featureValue, isComingSoon)}
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
