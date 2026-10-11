"use client"

import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/hooks/useSubscription";
import { MyTeamInvitation } from "@/lib/schema";
import { Loader2, Users } from "lucide-react";
import { TeamPricing } from "./teamPricing";

interface TeamInvitationCardProps {
    invitation: MyTeamInvitation;
    pricing: TeamPricing | null;
    responding: boolean;
    onRespond: (action: "accept" | "reject") => void;
}

export function TeamInvitationCard({ invitation, pricing, responding, onRespond }: TeamInvitationCardProps) {
    const limits = pricing?.limits.team;
    return (
        <div className="rounded-lg border p-5 space-y-4">
            <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                    <p className="font-medium">
                        {invitation.invited_by ? `${invitation.invited_by} added you to ${invitation.organization_name}` : `You're invited to ${invitation.organization_name}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        Your Open Paper plan is paid for by the team. Nothing to set up and no card needed.
                    </p>
                </div>
            </div>
            {limits && (
                <ul className="grid grid-cols-3 gap-2 text-center">
                    <li className="rounded-md bg-muted/50 p-2">
                        <p className="font-semibold tabular-nums">{limits.paper_uploads.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">papers</p>
                    </li>
                    <li className="rounded-md bg-muted/50 p-2">
                        <p className="font-semibold tabular-nums">{formatFileSize(limits.knowledge_base_size)}</p>
                        <p className="text-xs text-muted-foreground">storage</p>
                    </li>
                    <li className="rounded-md bg-muted/50 p-2">
                        <p className="font-semibold tabular-nums">{Math.round(limits.chat_credits_weekly / 1000)}k</p>
                        <p className="text-xs text-muted-foreground">chat credits a week</p>
                    </li>
                </ul>
            )}
            <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" disabled={responding} onClick={() => onRespond("reject")}>
                    Decline
                </Button>
                <Button size="sm" disabled={responding} onClick={() => onRespond("accept")}>
                    {responding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Join {invitation.organization_name}
                </Button>
            </div>
        </div>
    );
}
