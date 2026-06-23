"use client"

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import { useSubscription } from "@/hooks/useSubscription";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActivePapers } from "@/hooks/useActivePapers";
import { useReferralBalance } from "@/hooks/useReferralBalance";
import { Conversation, Project } from "@/lib/schema";
import { ReferralDialog } from "@/components/ReferralDialog";
import { MilestoneReferralToast } from "@/components/MilestoneReferralToast";
import { SidebarNav } from "./SidebarNav";
import { AppSidebarFooter } from "./SidebarFooter";
import { buildReferralEntry } from "./referralEntry";
import { getSubscriptionWarning } from "./subscriptionWarning";

export function AppSidebar() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const { papers: allPapers } = useActivePapers(!!user);
    const [projects, setProjects] = useState<Project[]>([]);
    const [everythingConversations, setEverythingConversations] = useState<Conversation[]>([]);
    const { darkMode, toggleDarkMode } = useIsDarkMode();
    const { subscription, loading: subscriptionLoading } = useSubscription();
    const [dismissedWarning, setDismissedWarning] = useState<string | null>(null);
    const [referralOpen, setReferralOpen] = useState(false);
    const isMobile = useIsMobile();
    const isPaid = subscription?.plan === "researcher";
    const { balance: referralBalance } = useReferralBalance(!!user);

    const referralEntry = buildReferralEntry({
        referralBalance,
        isPaid,
        onNavigateToPricing: () => router.push("/pricing"),
        onOpenReferral: () => setReferralOpen(true),
    });

    useEffect(() => {
        if (!user) {
            setEverythingConversations([]);
            setProjects([]);
            return;
        }

        const fetchData = async () => {
            try {
                const [conversationsResponse, projectsResponse] = await Promise.all([
                    fetchFromApi("/api/conversation/everything"),
                    fetchFromApi("/api/projects"),
                ]);

                setEverythingConversations(conversationsResponse || []);
                setProjects(projectsResponse || []);
            } catch (error) {
                console.error("Error fetching sidebar data:", error);
                setEverythingConversations([]);
                setProjects([]);
            }
        };

        fetchData();
    }, [user]);

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    }

    const currentWarning = getSubscriptionWarning(subscription, user, subscriptionLoading);
    const shouldShowWarning = currentWarning && dismissedWarning !== currentWarning.key;

    // Reset dismissed warning when warning changes
    useEffect(() => {
        if (currentWarning && dismissedWarning && dismissedWarning !== currentWarning.key) {
            setDismissedWarning(null);
        }
    }, [currentWarning?.key, dismissedWarning]);

    return (
        <Sidebar variant="floating">
            <SidebarContent>
                <SidebarNav
                    user={user}
                    papers={allPapers}
                    conversations={everythingConversations}
                    projects={projects}
                />
            </SidebarContent>
            <AppSidebarFooter
                user={user}
                warning={shouldShowWarning ? currentWarning : null}
                onDismissWarning={(key) => setDismissedWarning(key)}
                subscription={subscription}
                subscriptionLoading={subscriptionLoading}
                isMobile={isMobile}
                darkMode={darkMode}
                onToggleDarkMode={toggleDarkMode}
                onLogout={handleLogout}
                referralEntry={referralEntry}
            />
            <ReferralDialog open={referralOpen} onOpenChange={setReferralOpen} />
            {user && (
                <MilestoneReferralToast
                    subscription={subscription}
                    onOpenReferral={() => setReferralOpen(true)}
                />
            )}
        </Sidebar>
    )
}
