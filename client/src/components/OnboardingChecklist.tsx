"use client";

import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CheckCircle2, CircleDashed, Clipboard } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "./ui/button";

export interface OnboardingChecklistData {
    has_papers: boolean;
    has_annotations: boolean;
    has_highlights: boolean;
    has_messages: boolean;
    has_notes: boolean;
    has_completed_paper: boolean;
    onboarding_completed: boolean;
}

interface ChecklistItemProps {
    completed: boolean;
    text: string;
}

function ChecklistItem({ completed, text }: ChecklistItemProps) {
    return (
        <div className={`flex my-1 h-fit text-xs items-center gap-2 ${completed ? "line-through text-gray-500" : ""}`}>
            {completed ? (
                <CheckCircle2
                    className="h-4 w-4 text-green-500"
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
    const [loading, setLoading] = useState(true);
    const { user, loading: userLoading } = useAuth();

    useEffect(() => {
        const fetchOnboardingData = async () => {
            if (userLoading) {
                setLoading(true);
                return;
            }

            if (!user) {
                setOnboardingData(null);
                setLoading(false);
                return;
            }

            setLoading(true);

            try {
                const response: OnboardingChecklistData = await fetchFromApi("/api/auth/onboarding");
                setOnboardingData(response);
            } catch (error) {
                console.error("Error fetching onboarding data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchOnboardingData();
    }, [user, userLoading]);

    const checklistItems = useMemo(() => [
        { text: "Create an account", completed: !!user },
        { text: "Upload your first paper", completed: !!onboardingData?.has_papers },
        { text: "Highlight a snippet in any paper", completed: !!onboardingData?.has_highlights },
        { text: "Annotate a highlight with a comment", completed: !!onboardingData?.has_annotations },
        { text: "Take some notes", completed: !!onboardingData?.has_notes },
        { text: "Chat with your paper", completed: !!onboardingData?.has_messages },
        { text: "Finish reading your first paper", completed: !!onboardingData?.has_completed_paper },
    ], [user, onboardingData]);

    const numCompleted = useMemo(() => checklistItems.filter(item => item.completed).length, [checklistItems]);
    const itemCount = checklistItems.length;

    if (loading || !onboardingData || onboardingData.onboarding_completed) {
        return null;
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={"ghost"}
                    className="relative flex items-center gap-2 animate-subtle-glow hover:animate-none"
                >
                    {numCompleted < itemCount && <span className="" />}
                    <Clipboard className="h-4 w-4" />
                    Onboarding Checklist
                    <div>{numCompleted}/{itemCount}</div>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 bg-background p-4 rounded-lg border shadow-md">
                <Progress value={(numCompleted / itemCount) * 100} className="my-1" />
                {checklistItems.map((item, index) => (
                    <ChecklistItem
                        key={index}
                        completed={item.completed}
                        text={item.text}
                    />
                ))}
            </PopoverContent>
        </Popover>
    );
}
