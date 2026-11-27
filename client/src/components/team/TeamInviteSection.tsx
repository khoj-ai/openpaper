"use client"

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchFromApi } from "@/lib/api";
import { TeamInvitation } from "@/lib/schema";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface TeamInviteSectionProps {
    teamId: string;
    invitations: TeamInvitation[];
    seatsLeft: number;
    onChanged: () => void;
}

const parseEmails = (text: string) =>
    Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)));

export function TeamInviteSection({ teamId, invitations, seatsLeft, onChanged }: TeamInviteSectionProps) {
    const [emailText, setEmailText] = useState("");
    const [sending, setSending] = useState(false);
    const [retracting, setRetracting] = useState<string | null>(null);

    const emails = parseEmails(emailText);

    const invite = async () => {
        setSending(true);
        try {
            const result: { invited: TeamInvitation[]; failed: { email: string; error: string }[] } =
                await fetchFromApi(`/api/organization/${teamId}/invitations`, {
                    method: "POST",
                    body: JSON.stringify({ emails }),
                });
            if (result.invited.length > 0) {
                toast.success(`Invited ${result.invited.length} ${result.invited.length === 1 ? "person" : "people"}.`);
            }
            for (const failure of result.failed) {
                toast.error(`${failure.email}: ${failure.error}`);
            }
            // Keep only the addresses that didn't go through, so they can be fixed and retried.
            setEmailText(result.failed.map((f) => f.email).join("\n"));
            onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not send invitations.");
        } finally {
            setSending(false);
        }
    };

    const retract = async (invitationId: string) => {
        setRetracting(invitationId);
        try {
            await fetchFromApi(`/api/organization/${teamId}/invitations/${invitationId}`, { method: "DELETE" });
            onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not retract the invitation.");
        } finally {
            setRetracting(null);
        }
    };

    return (
        <section className="space-y-4">
            <div className="space-y-1">
                <h2 className="text-lg font-medium">Invite people</h2>
                <p className="text-sm text-muted-foreground">
                    Use the address each person signs in to Open Paper with. Only that address can accept.{" "}
                    {seatsLeft > 0
                        ? `${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left.`
                        : "Every seat is taken. Add seats under Billing to invite more people."}
                </p>
            </div>
            <div className="space-y-2">
                <Label htmlFor="invite-emails">Email addresses</Label>
                <Textarea
                    id="invite-emails"
                    placeholder={"student@university.edu\npostdoc@university.edu"}
                    value={emailText}
                    onChange={(e) => setEmailText(e.target.value)}
                    rows={3}
                />
            </div>
            <Button onClick={invite} disabled={sending || emails.length === 0 || seatsLeft === 0}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {emails.length > 1 ? `Invite ${emails.length} people` : "Invite"}
            </Button>

            {invitations.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-medium">Pending</h3>
                    <ul className="divide-y rounded-lg border">
                        {invitations.map((invitation) => (
                            <li key={invitation.id} className="flex items-center justify-between px-4 py-2 text-sm">
                                <span className="truncate">{invitation.email}</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={retracting === invitation.id}
                                    onClick={() => retract(invitation.id)}
                                    aria-label={`Retract invitation for ${invitation.email}`}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
