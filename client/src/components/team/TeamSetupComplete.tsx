"use client"

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Team, TeamInvitation } from "@/lib/schema";
import { Check, CircleCheck, Copy } from "lucide-react";

interface TeamSetupCompleteProps {
    team: Team;
    invitations: TeamInvitation[];
    onDone: () => void;
}

export function TeamSetupComplete({ team, invitations, onDone }: TeamSetupCompleteProps) {
    const [copied, setCopied] = useState(false);
    const joinUrl = `${window.location.origin}/team`;
    const message =
        `I've set up Open Paper for ${team.name}, and your seat is paid for. ` +
        `Look for an invite email from Open Paper, then sign in with that same address to join: ${joinUrl}`;

    const copy = async () => {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <section className="rounded-lg border p-6 space-y-6">
            <div className="flex items-start gap-3">
                <CircleCheck className="h-6 w-6 text-green-600 shrink-0" />
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold">{team.name} is ready</h2>
                    <p className="text-sm text-muted-foreground">
                        {invitations.length > 0
                            ? `We've emailed ${invitations.length} ${invitations.length === 1 ? "invitation" : "invitations"}. You're already on the Team plan.`
                            : "You're on the Team plan. Invite people below whenever you're ready."}
                    </p>
                </div>
            </div>

            {invitations.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-medium">Let your team know</h3>
                    <p className="text-sm text-muted-foreground">
                        Invites can land in spam, and people need to sign in with the exact address you used. A heads-up helps:
                    </p>
                    <div className="rounded-md bg-muted p-3 text-sm">{message}</div>
                    <Button variant="outline" size="sm" onClick={copy}>
                        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                        {copied ? "Copied" : "Copy message"}
                    </Button>
                </div>
            )}

            <Button onClick={onDone}>Go to your team</Button>
        </section>
    );
}
