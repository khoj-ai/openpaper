"use client";

import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CheckCircle2, CircleDashed, Clipboard } from "lucide-react";
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverTrigger } from "./ui/popover";
import { PopoverContent } from "@radix-ui/react-popover";
import { Button } from "./ui/button";

export interface OnboardingChecklistData {
    has_documents: boolean;
    has_annotations: boolean;
    has_highlights: boolean;
    has_messages: boolean;
    has_notes: boolean;
    onboarding_completed: boolean;
}

function ChecklistItem({ completed, text }: { completed: boolean; text: string }) {
    return (
        <div className={`flex my-1 h-fit text-xs items-center gap-2 ${completed ? "line-through text-gray-500" : ""}`}>
            {completed ? (
                <CheckCircle2
                    className="h-4 w-4 text-green-500!"
                    aria-hidden="true"
                />
            ) : (
                <CircleDashed
                    className="h-4 w-4 text-gray-500"
                    aria-hidden="true"
                />
            )}
            {text}
        </div>
    );
}

export default function OnboardingChecklist() {
    const [onboardingData, setOnboardingData] = useState<OnboardingChecklistData | null>(null);
    const [loadingOnboardingData, setLoadingOnboardingData] = useState(true);
    const [numCompleted, setNumCompleted] = useState(0);
    const { user, loading: userLoading } = useAuth();

    const fetchOnboardingData = async () => {
        if (userLoading) {
            setLoadingOnboardingData(true);
            return;
        }

        if (!user) {
            setOnboardingData(null);
            setLoadingOnboardingData(false);
            return;
        }

        setLoadingOnboardingData(true);

        try {
            const response: OnboardingChecklistData = await fetchFromApi("/api/auth/onboarding");
            setOnboardingData(response);

            const completedCount = [
                response.has_documents,
                response.has_annotations,
                response.has_highlights,
                response.has_messages,
                response.has_notes
            ].filter(Boolean).length;

            setNumCompleted(completedCount + 1); // +1 for account creation
        } catch (error) {
            console.error("Error fetching onboarding data:", error);
        } finally {
            setLoadingOnboardingData(false);
        }
    };

    useEffect(() => {
        fetchOnboardingData();
    }, [user, userLoading]);

    if (loadingOnboardingData) {
        return null;
    }

    if (onboardingData === null) {
        return null;
    }

    if (onboardingData.onboarding_completed) {
        return null;
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant={"ghost"} className="flex items-center gap-2">
                    <Clipboard className="h-4 w-4" />
                    Onboarding Checklist
                    <div>{numCompleted}/6</div>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 z-100 bg-background p-4 rounded-lg border shadow-md">
                <Progress value={numCompleted * 100 / 6} className="bg-blue-500 my-1" />
                <ChecklistItem
                    completed={!!user}
                    text="Create an account"
                />
                <ChecklistItem
                    completed={user && onboardingData?.has_documents || false}
                    text="Import your first paper"
                />
                <ChecklistItem
                    completed={user && onboardingData?.has_highlights || false}
                    text="Highlight a snippet"
                />
                <ChecklistItem
                    completed={user && onboardingData?.has_annotations || false}
                    text="Annotate a highlight"
                />
                <ChecklistItem
                    completed={user && onboardingData?.has_notes || false}
                    text="Take some notes"
                />
                <ChecklistItem
                    completed={user && onboardingData?.has_messages || false}
                    text="Chat with your document"
                />
            </PopoverContent>
        </Popover>
    );
}
