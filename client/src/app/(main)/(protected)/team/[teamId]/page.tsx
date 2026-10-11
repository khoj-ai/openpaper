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
import { TeamSetupComplete } from "@/components/team/TeamSetupComplete";
import { TeamSetupWizard } from "@/components/team/TeamSetupWizard";
import { TeamStatusBadge } from "@/components/team/TeamStatusBadge";
import { useTeamPricing } from "@/components/team/teamPricing";
import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MyTeamsResponse, TeamDetail, TeamUsageResponse, TeamUsageSummary } from "@/lib/schema";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

// After checkout, Stripe's webhook usually lands within a few seconds.
const CHECKOUT_POLL_INTERVAL_MS = 2000;
const CHECKOUT_POLL_ATTEMPTS = 15;

// Statuses where the team has a subscription to manage rather than one to buy.
const SUBSCRIBED_STATUSES = ["active", "trialing", "past_due"];

function UsageSummary({ summary, seats, seatsTaken }: { summary: TeamUsageSummary; seats: number; seatsTaken: number }) {
    const stats = [
        { label: "Active this week", value: `${summary.active_this_week} of ${summary.members}` },
        { label: "Questions this week", value: summary.questions_this_week.toLocaleString() },
        { label: "Papers opened, 30 days", value: summary.papers_opened_this_month.toLocaleString() },
        { label: "Seats in use", value: `${seatsTaken} of ${seats}` },
    ];
    return (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.map(({ label, value }) => (
                <div key={label} className="rounded-lg border p-4">
                    <p className="text-2xl font-semibold tabular-nums">{value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{label}</p>
                </div>
            ))}
        </section>
    );
}

function TeamContent() {
    const { teamId } = useParams<{ teamId: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { user } = useAuth();
    const pricing = useTeamPricing();

    const [detail, setDetail] = useState<TeamDetail | null>(null);
    const [usage, setUsage] = useState<TeamUsageResponse | null>(null);
    const [paysPersonally, setPaysPersonally] = useState(false);
    const [notFound, setNotFound] = useState(false);
    const returningFromCheckout = searchParams.has("session_id");
    const [waitingForPayment, setWaitingForPayment] = useState(returningFromCheckout);
    const [showSetupComplete, setShowSetupComplete] = useState(returningFromCheckout);
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
            if (team.organization.role === "admin" && team.organization.is_paid) {
                setUsage(await fetchFromApi(`/api/organization/${teamId}/usage`));
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
        if (!returningFromCheckout) return;
        let cancelled = false;
        (async () => {
            for (let attempt = 0; attempt < CHECKOUT_POLL_ATTEMPTS && !cancelled; attempt++) {
                const team = await load();
                if (team?.organization.is_paid) break;
                await new Promise((resolve) => setTimeout(resolve, CHECKOUT_POLL_INTERVAL_MS));
            }
            if (!cancelled) setWaitingForPayment(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [returningFromCheckout, load]);

    const finishSetup = () => {
        setShowSetupComplete(false);
        // Full load, so the sidebar and usage limits pick up the team plan.
        window.location.assign(`/team/${teamId}`);
    };

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
    const hasSubscription = SUBSCRIBED_STATUSES.includes(team.status);
    const invitations = detail.invitations ?? [];

    const header = (
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
    );

    if (waitingForPayment && !team.is_paid) {
        return (
            <div className="max-w-3xl p-6 space-y-8">
                {header}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirming your payment. This usually takes a few seconds.
                </div>
            </div>
        );
    }

    if (isAdmin && team.is_paid && showSetupComplete) {
        return (
            <div className="max-w-3xl p-6 space-y-8">
                {header}
                <TeamSetupComplete team={team} invitations={invitations} onDone={finishSetup} />
            </div>
        );
    }

    // Created but never paid for (or the plan ended): pick up setup where it stopped.
    if (isAdmin && !hasSubscription) {
        return (
            <div className="max-w-2xl p-6 space-y-8">
                {header}
                {team.status === "canceled" && (
                    <p className="text-sm text-muted-foreground">This team&apos;s plan has ended. Members are back on their own plans until you renew.</p>
                )}
                <TeamSetupWizard
                    key={invitations.map((i) => i.id).join()}
                    pricing={pricing}
                    existingTeam={team}
                    existingInvitations={invitations}
                />
            </div>
        );
    }

    return (
        <div className="max-w-3xl p-6 space-y-8">
            {header}

            {team.is_paid && paysPersonally && <PersonalPlanNotice teamName={team.name} />}

            {!team.is_paid && !isAdmin && (
                <p className="text-sm text-muted-foreground">
                    This team&apos;s plan isn&apos;t active right now, so you&apos;re on your own plan. Ask a team admin to check billing.
                </p>
            )}

            {isAdmin && usage && <UsageSummary summary={usage.summary} seats={team.seats} seatsTaken={seatsTaken} />}

            <TeamMembersSection
                teamId={team.id}
                teamName={team.name}
                members={detail.members}
                usage={usage?.members ?? null}
                currentUserId={user.id}
                isAdmin={isAdmin}
                onChanged={load}
                onLeft={() => window.location.assign("/team")}
            />

            {isAdmin && team.is_paid && (
                <>
                    <Separator />
                    <TeamInviteSection
                        teamId={team.id}
                        invitations={invitations}
                        seatsLeft={Math.max(0, team.seats - seatsTaken)}
                        onChanged={load}
                    />
                </>
            )}

            {isAdmin && (
                <>
                    <Separator />
                    <TeamBillingSection team={team} seatsTaken={seatsTaken} onChanged={load} />
                </>
            )}
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
