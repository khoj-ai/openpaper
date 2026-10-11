"use client"

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchFromApi } from "@/lib/api";
import { Team, TeamInvitation } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { Check, Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { TeamCheckoutSheet } from "./TeamCheckoutSheet";
import { formatPrice, perSeatMonthly, TeamInterval, TeamPricing, teamPriceTotal } from "./teamPricing";

const STEPS = ["Name", "People", "Review"] as const;
type Step = 0 | 1 | 2;

// Loose on purpose: the server validates, this only catches obvious typos.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmails = (text: string) =>
    Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)));

interface TeamSetupWizardProps {
    pricing: TeamPricing | null;
    // Resuming a team that was created but never paid for.
    existingTeam?: Team;
    existingInvitations?: TeamInvitation[];
    onCancel?: () => void;
}

export function TeamSetupWizard({ pricing, existingTeam, existingInvitations = [], onCancel }: TeamSetupWizardProps) {
    const [step, setStep] = useState<Step>(existingTeam ? 1 : 0);
    const [team, setTeam] = useState<Team | null>(existingTeam ?? null);
    const [name, setName] = useState(existingTeam?.name ?? "");
    const [people, setPeople] = useState<string[]>(existingInvitations.map((i) => i.email));
    const [draft, setDraft] = useState("");
    const [spareSeats, setSpareSeats] = useState(0);
    const [interval, setBillingInterval] = useState<TeamInterval>("year");
    const [submitting, setSubmitting] = useState(false);
    const [checkoutOpen, setCheckoutOpen] = useState(false);

    const alreadyInvited = new Set(existingInvitations.map((i) => i.email));
    const invalid = people.filter((email) => !EMAIL_PATTERN.test(email));
    const seats = 1 + people.length + spareSeats;

    const addDraft = () => {
        const added = parseEmails(draft);
        if (added.length === 0) return;
        setPeople((current) => Array.from(new Set([...current, ...added])));
        setDraft("");
    };

    const removePerson = async (email: string) => {
        const invitation = existingInvitations.find((i) => i.email === email);
        if (invitation && team) {
            try {
                await fetchFromApi(`/api/organization/${team.id}/invitations/${invitation.id}`, { method: "DELETE" });
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not remove them.");
                return;
            }
        }
        setPeople((current) => current.filter((e) => e !== email));
    };

    // Create the team (first time through) and save the invitations. Nobody is
    // emailed until checkout goes through.
    const continueToPayment = async () => {
        setSubmitting(true);
        try {
            let current = team;
            if (!current) {
                current = (await fetchFromApi("/api/organization", {
                    method: "POST",
                    body: JSON.stringify({ name: name.trim() }),
                })) as Team;
                setTeam(current);
            }
            const toInvite = people.filter((email) => !alreadyInvited.has(email));
            if (toInvite.length > 0) {
                const result: { failed: { email: string; error: string }[] } = await fetchFromApi(
                    `/api/organization/${current.id}/invitations`,
                    { method: "POST", body: JSON.stringify({ emails: toInvite }) },
                );
                if (result.failed.length > 0) {
                    for (const failure of result.failed) toast.error(`${failure.email}: ${failure.error}`);
                    setStep(1);
                    return;
                }
            }
            setCheckoutOpen(true);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-8">
            <ol className="flex items-center gap-2 text-sm">
                {STEPS.map((label, index) => (
                    <li key={label} className="flex items-center gap-2">
                        <span
                            className={cn(
                                "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                index < step && "bg-primary border-primary text-primary-foreground",
                                index === step && "border-primary text-primary font-medium",
                                index > step && "text-muted-foreground",
                            )}
                        >
                            {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
                        </span>
                        <span className={cn(index === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
                        {index < STEPS.length - 1 && <span className="w-6 h-px bg-border" />}
                    </li>
                ))}
            </ol>

            {step === 0 && (
                <form
                    className="space-y-6"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim()) setStep(1);
                    }}
                >
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">What&apos;s your team called?</h2>
                        <p className="text-sm text-muted-foreground">Usually your lab or group. Members see this name on their invite.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="team-name">Team name</Label>
                        <Input
                            id="team-name"
                            placeholder="e.g., Energy Controls Lab"
                            value={name}
                            maxLength={120}
                            autoFocus
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button type="submit" disabled={!name.trim()}>Continue</Button>
                        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
                    </div>
                </form>
            )}

            {step === 1 && (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">Who&apos;s on {name.trim() || "your team"}?</h2>
                        <p className="text-sm text-muted-foreground">
                            Add the address each person signs in to Open Paper with; only that address can accept.
                            Nobody gets an email until you&apos;ve paid.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="team-people">Email addresses</Label>
                        <Textarea
                            id="team-people"
                            placeholder={"Paste a list, one per line or comma-separated\nstudent@university.edu"}
                            value={draft}
                            rows={3}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={addDraft}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    addDraft();
                                }
                            }}
                        />
                    </div>

                    <ul className="flex flex-wrap gap-2">
                        <li className="rounded-full bg-muted px-3 py-1 text-sm">You</li>
                        {people.map((email) => (
                            <li
                                key={email}
                                className={cn(
                                    "flex items-center gap-1 rounded-full border px-3 py-1 text-sm",
                                    !EMAIL_PATTERN.test(email) && "border-destructive text-destructive",
                                )}
                            >
                                {email}
                                <button
                                    type="button"
                                    onClick={() => removePerson(email)}
                                    aria-label={`Remove ${email}`}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                    {invalid.length > 0 && (
                        <p className="text-sm text-destructive">Fix or remove the highlighted {invalid.length === 1 ? "address" : "addresses"}.</p>
                    )}

                    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                        <div>
                            <p className="text-sm font-medium">Spare seats</p>
                            <p className="text-sm text-muted-foreground">For people joining later in the year. You can also add seats any time.</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Fewer spare seats" disabled={spareSeats === 0} onClick={() => setSpareSeats((n) => n - 1)}>
                                <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-6 text-center tabular-nums">{spareSeats}</span>
                            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="More spare seats" onClick={() => setSpareSeats((n) => n + 1)}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {!existingTeam && <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>}
                        <Button
                            disabled={invalid.length > 0}
                            onClick={() => {
                                const pending = parseEmails(draft);
                                if (pending.length > 0) {
                                    // Add what's still in the box; stay so they can check it.
                                    addDraft();
                                    if (pending.some((email) => !EMAIL_PATTERN.test(email))) return;
                                }
                                setStep(2);
                            }}
                        >
                            {people.length + parseEmails(draft).length === 0
                                ? "Continue with just me"
                                : `Continue with ${seats + parseEmails(draft).filter((e) => !people.includes(e)).length} seats`}
                        </Button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">Review and pay</h2>
                        <p className="text-sm text-muted-foreground">Invitations go out as soon as payment goes through.</p>
                    </div>

                    {pricing ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {(["year", "month"] as const).map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => setBillingInterval(option)}
                                    className={cn(
                                        "flex flex-col items-start rounded-lg border p-4 text-left transition-colors",
                                        interval === option ? "border-primary ring-1 ring-primary" : "hover:bg-accent",
                                    )}
                                >
                                    <p className="font-medium">{option === "year" ? "Yearly" : "Monthly"}</p>
                                    <p className="text-2xl font-semibold tabular-nums mt-1">
                                        {formatPrice(teamPriceTotal(pricing, seats, option))}
                                        <span className="text-sm font-normal text-muted-foreground"> / {option}</span>
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {formatPrice(Math.round(perSeatMonthly(pricing, option) * 100) / 100)} per person a month
                                        {option === "year" && " · two months free"}
                                    </p>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}

                    <dl className="rounded-lg border divide-y text-sm">
                        <div className="flex justify-between p-3">
                            <dt className="text-muted-foreground">Team</dt>
                            <dd className="font-medium">{name.trim()}</dd>
                        </div>
                        <div className="flex justify-between p-3">
                            <dt className="text-muted-foreground">Seats</dt>
                            <dd className="font-medium">
                                {seats} (you{people.length > 0 && ` + ${people.length} invited`}{spareSeats > 0 && ` + ${spareSeats} spare`})
                            </dd>
                        </div>
                    </dl>

                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                        <Button disabled={!pricing || submitting} onClick={continueToPayment}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Continue to payment
                        </Button>
                    </div>

                    {team && pricing && (
                        <TeamCheckoutSheet
                            open={checkoutOpen}
                            onOpenChange={setCheckoutOpen}
                            teamId={team.id}
                            teamName={team.name}
                            seats={seats}
                            interval={interval}
                            pricing={pricing}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
