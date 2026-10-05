"use client"

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { PersonalPlanNotice } from "@/components/team/PersonalPlanNotice";
import { TeamBillingSection } from "@/components/team/TeamBillingSection";
import { TeamInviteSection } from "@/components/team/TeamInviteSection";
import { TeamMembersSection } from "@/components/team/TeamMembersSection";
import { TeamStatusBadge } from "@/components/team/TeamStatusBadge";
import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MyTeamsResponse, TeamDetail, TeamMemberUsage } from "@/lib/schema";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

// After checkout, Stripe's webhook usually lands within a few seconds.
const CHECKOUT_POLL_INTERVAL_MS = 2000;
const CHECKOUT_POLL_ATTEMPTS = 15;

function TeamContent() {
    const { teamId } = useParams<{ teamId: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { user } = useAuth();

    const [detail, setDetail] = useState<TeamDetail | null>(null);
    const [usage, setUsage] = useState<TeamMemberUsage[] | null>(null);
    const [paysPersonally, setPaysPersonally] = useState(false);
    const [notFound, setNotFound] = useState(false);
    const [finishingCheckout, setFinishingCheckout] = useState(searchParams.has("session_id"));
    const [editingName, setEditingName] = useState(false);
    const [name, setName] = useState("");

    const load = useCallback(async (): Promise<TeamDetail | null> => {
        try {
            const [team, mine]: [TeamDetail, MyTeamsResponse] = await Promise.all([
                fetchFromApi(`/api/organization/${teamId}`),
                fetchFromApi("/api/organization"),
            ]);
            setDetail(team);
            setName(team.organization.name);
            setPaysPersonally(mine.has_active_personal_subscription);
            if (team.organization.role === "admin") {
                const memberUsage: { members: TeamMemberUsage[] } = await fetchFromApi(`/api/organization/${teamId}/usage`);
                setUsage(memberUsage.members);
            }
            return team;
        } catch {
            setNotFound(true);
            return null;
        }
    }, [teamId]);

    useEffect(() => {
        load();
    }, [load]);

    // Returning from checkout: wait for the webhook to mark the team paid.
    useEffect(() => {
        if (!searchParams.has("session_id")) return;
        let cancelled = false;
        (async () => {
            for (let attempt = 0; attempt < CHECKOUT_POLL_ATTEMPTS && !cancelled; attempt++) {
                const team = await load();
                if (team?.organization.is_paid) break;
                await new Promise((resolve) => setTimeout(resolve, CHECKOUT_POLL_INTERVAL_MS));
            }
            if (!cancelled) {
                setFinishingCheckout(false);
                router.replace(`/team/${teamId}`);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [searchParams, load, router, teamId]);

    const rename = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        try {
            await fetchFromApi(`/api/organization/${teamId}`, {
                method: "PATCH",
                body: JSON.stringify({ name: name.trim() }),
            });
            setEditingName(false);
            load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not rename the team.");
        }
    };

    if (notFound) {
        return (
            <div className="max-w-2xl p-6 space-y-4">
                <p>This team doesn&apos;t exist, or you&apos;re not on it.</p>
                <Link href="/team" className="underline">Back to your teams</Link>
            </div>
        );
    }

    if (!detail || !user) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const team = detail.organization;
    const isAdmin = team.role === "admin";
    const seatsTaken = detail.seats_taken ?? detail.members.length;

    return (
        <div className="max-w-3xl p-6 space-y-8">
            <div className="space-y-3">
                <Link href="/team" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Teams
                </Link>
                <div className="flex items-center gap-3">
                    {editingName ? (
                        <form onSubmit={rename} className="flex gap-2 flex-1">
                            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
                            <Button type="submit" size="sm">Save</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
                        </form>
                    ) : (
                        <>
                            <h1 className="text-2xl font-bold truncate">{team.name}</h1>
                            {isAdmin && (
                                <Button variant="ghost" size="sm" onClick={() => setEditingName(true)} aria-label="Rename team">
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            )}
                            <TeamStatusBadge team={team} />
                        </>
                    )}
                </div>
            </div>

            {finishingCheckout && !team.is_paid && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Finishing setup. This usually takes a few seconds.
                </div>
            )}

            {team.is_paid && paysPersonally && <PersonalPlanNotice teamName={team.name} />}

            {!team.is_paid && !isAdmin && (
                <p className="text-sm text-muted-foreground">
                    This team&apos;s plan isn&apos;t active right now, so you&apos;re on your own plan. Ask a team admin to check billing.
                </p>
            )}

            {isAdmin && !finishingCheckout && (
                <>
                    <TeamBillingSection team={team} seatsTaken={seatsTaken} onChanged={load} />
                    <Separator />
                </>
            )}

            {isAdmin && team.is_paid && (
                <>
                    <TeamInviteSection
                        teamId={team.id}
                        invitations={detail.invitations ?? []}
                        seatsLeft={Math.max(0, team.seats - seatsTaken)}
                        onChanged={load}
                    />
                    <Separator />
                </>
            )}

            <TeamMembersSection
                teamId={team.id}
                teamName={team.name}
                members={detail.members}
                usage={usage}
                currentUserId={user.id}
                isAdmin={isAdmin}
                onChanged={load}
                onLeft={() => window.location.assign("/team")}
            />
        </div>
    );
}

export default function TeamPage() {
    return (
        <Suspense>
            <TeamContent />
        </Suspense>
    );
}
