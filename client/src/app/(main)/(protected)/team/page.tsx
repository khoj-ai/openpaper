"use client"

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TeamInvitationCard } from "@/components/team/TeamInvitationCard";
import { TeamLanding } from "@/components/team/TeamLanding";
import { TeamSetupWizard } from "@/components/team/TeamSetupWizard";
import { TeamStatusBadge } from "@/components/team/TeamStatusBadge";
import { useTeamPricing } from "@/components/team/teamPricing";
import { fetchFromApi } from "@/lib/api";
import { MyTeamInvitation, MyTeamsResponse, Team } from "@/lib/schema";
import { ChevronRight, Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";

export default function TeamsPage() {
    const pricing = useTeamPricing();
    const [teams, setTeams] = useState<Team[] | null>(null);
    const [invitations, setInvitations] = useState<MyTeamInvitation[]>([]);
    const [respondingTo, setRespondingTo] = useState<string | null>(null);
    const [settingUp, setSettingUp] = useState(false);

    const load = useCallback(async () => {
        try {
            const [mine, pending] = await Promise.all([
                fetchFromApi("/api/organization") as Promise<MyTeamsResponse>,
                fetchFromApi("/api/organization/invitations") as Promise<{ invitations: MyTeamInvitation[] }>,
            ]);
            setTeams(mine.organizations);
            setInvitations(pending.invitations);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not load your teams.");
            setTeams([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const respond = async (invitation: MyTeamInvitation, action: "accept" | "reject") => {
        setRespondingTo(invitation.id);
        try {
            await fetchFromApi(`/api/organization/invitations/${invitation.id}/${action}`, { method: "POST" });
            if (action === "accept") {
                // Full load, so the plan shown across the app (sidebar badge,
                // usage limits) picks up the team plan.
                window.location.assign(`/team/${invitation.organization_id}`);
                return;
            }
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Something went wrong.");
        } finally {
            setRespondingTo(null);
        }
    };

    if (teams === null) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const startSetup = () => {
        setSettingUp(true);
        window.scrollTo({ top: 0 });
    };

    return (
        <div className="max-w-2xl p-6 space-y-10">
            {invitations.length > 0 && (
                <section className="space-y-3">
                    {invitations.map((invitation) => (
                        <TeamInvitationCard
                            key={invitation.id}
                            invitation={invitation}
                            pricing={pricing}
                            responding={respondingTo === invitation.id}
                            onRespond={(action) => respond(invitation, action)}
                        />
                    ))}
                </section>
            )}

            {settingUp ? (
                <TeamSetupWizard pricing={pricing} onCancel={() => setSettingUp(false)} />
            ) : teams.length === 0 && invitations.length > 0 ? (
                // Someone who was invited is here to join, not to buy.
                <p className="text-sm text-muted-foreground">
                    Running your own lab or group?{" "}
                    <button className="underline hover:text-foreground" onClick={startSetup}>Set up a team</button>
                </p>
            ) : teams.length === 0 ? (
                <TeamLanding pricing={pricing} onStart={startSetup} />
            ) : (
                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl font-bold">Your teams</h1>
                        <Button variant="outline" size="sm" onClick={startSetup}>
                            <Plus className="mr-1 h-4 w-4" />
                            New team
                        </Button>
                    </div>
                    {teams.map((team) => (
                        <Link
                            key={team.id}
                            href={`/team/${team.id}`}
                            className="flex items-center justify-between gap-4 rounded-lg border p-4 hover:bg-accent transition-colors"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                                <span className="font-medium truncate">{team.name}</span>
                                {team.role === "admin" && <Badge variant="secondary">Admin</Badge>}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <TeamStatusBadge team={team} />
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                        </Link>
                    ))}
                </section>
            )}
        </div>
    );
}
