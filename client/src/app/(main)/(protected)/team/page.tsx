"use client"

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TeamStatusBadge } from "@/components/team/TeamStatusBadge";
import { TEAM_MONTHLY_PRICE_PER_SEAT, TEAM_YEARLY_PRICE_PER_SEAT } from "@/components/team/teamPricing";
import { fetchFromApi } from "@/lib/api";
import { MyTeamInvitation, MyTeamsResponse, Team } from "@/lib/schema";
import { ChevronRight, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

export default function TeamsPage() {
    const router = useRouter();
    const [teams, setTeams] = useState<Team[] | null>(null);
    const [invitations, setInvitations] = useState<MyTeamInvitation[]>([]);
    const [respondingTo, setRespondingTo] = useState<string | null>(null);
    const [newTeamName, setNewTeamName] = useState("");
    const [creating, setCreating] = useState(false);

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

    const createTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newTeamName.trim();
        if (!name) return;
        setCreating(true);
        try {
            const team: Team = await fetchFromApi("/api/organization", {
                method: "POST",
                body: JSON.stringify({ name }),
            });
            router.push(`/team/${team.id}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not create the team.");
            setCreating(false);
        }
    };

    if (teams === null) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl p-6 space-y-8">
            <div className="space-y-1">
                <h1 className="text-2xl font-bold">Team</h1>
                <p className="text-sm text-muted-foreground">
                    Pay for your lab or group&apos;s seats in one place. Everyone on a team gets Team plan limits.
                </p>
            </div>

            {invitations.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-lg font-medium">Invitations</h2>
                    {invitations.map((invitation) => (
                        <div key={invitation.id} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                            <div className="min-w-0">
                                <p className="font-medium truncate">{invitation.organization_name}</p>
                                <p className="text-sm text-muted-foreground truncate">
                                    {invitation.invited_by ? `Invited by ${invitation.invited_by}` : "You've been invited"}
                                </p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={respondingTo === invitation.id}
                                    onClick={() => respond(invitation, "reject")}
                                >
                                    Decline
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={respondingTo === invitation.id}
                                    onClick={() => respond(invitation, "accept")}
                                >
                                    {respondingTo === invitation.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Join team
                                </Button>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {teams.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-lg font-medium">Your teams</h2>
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

            <Separator />

            <section className="space-y-4">
                <div className="space-y-1">
                    <h2 className="text-lg font-medium">Create a team</h2>
                    <p className="text-sm text-muted-foreground">
                        ${TEAM_MONTHLY_PRICE_PER_SEAT} per seat a month, or ${TEAM_YEARLY_PRICE_PER_SEAT} per seat a year
                        (two months free). You&apos;ll choose how many seats next.
                    </p>
                </div>
                <form onSubmit={createTeam} className="flex flex-col sm:flex-row gap-3 sm:items-end">
                    <div className="space-y-2 flex-1">
                        <Label htmlFor="team-name">Team name</Label>
                        <Input
                            id="team-name"
                            placeholder="e.g., Energy Controls Lab"
                            value={newTeamName}
                            maxLength={120}
                            onChange={(e) => setNewTeamName(e.target.value)}
                        />
                    </div>
                    <Button type="submit" disabled={creating || !newTeamName.trim()}>
                        {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create team
                    </Button>
                </form>
            </section>
        </div>
    );
}
