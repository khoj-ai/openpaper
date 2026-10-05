"use client"

import { useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    formatFileSize,
    getChatCreditUsagePercentage,
} from "@/hooks/useSubscription";
import { fetchFromApi } from "@/lib/api";
import { TeamMember, TeamMemberUsage } from "@/lib/schema";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

interface TeamMembersSectionProps {
    teamId: string;
    teamName: string;
    members: TeamMember[];
    // Present for admins only.
    usage: TeamMemberUsage[] | null;
    currentUserId: string;
    isAdmin: boolean;
    onChanged: () => void;
    onLeft: () => void;
}

type PendingRemoval = { member: TeamMember; isSelf: boolean } | null;

export function TeamMembersSection({
    teamId,
    teamName,
    members,
    usage,
    currentUserId,
    isAdmin,
    onChanged,
    onLeft,
}: TeamMembersSectionProps) {
    const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);
    const usageByUser = new Map((usage ?? []).map((u) => [u.user_id, u]));

    const setRole = async (member: TeamMember, role: "admin" | "member") => {
        try {
            await fetchFromApi(`/api/organization/${teamId}/members/${member.user_id}/role`, {
                method: "PUT",
                body: JSON.stringify({ role }),
            });
            onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not change the role.");
        }
    };

    const remove = async () => {
        if (!pendingRemoval) return;
        const { member, isSelf } = pendingRemoval;
        try {
            await fetchFromApi(`/api/organization/${teamId}/members/${member.user_id}`, { method: "DELETE" });
            if (isSelf) {
                onLeft();
            } else {
                onChanged();
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not remove them from the team.");
        } finally {
            setPendingRemoval(null);
        }
    };

    return (
        <section className="space-y-4">
            <div className="space-y-1">
                <h2 className="text-lg font-medium">Members</h2>
                {isAdmin && (
                    <p className="text-sm text-muted-foreground">
                        Limits apply to each seat separately. Chat credits reset weekly.
                    </p>
                )}
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Member</TableHead>
                        {isAdmin && <TableHead className="text-right">Papers</TableHead>}
                        {isAdmin && <TableHead className="text-right">Storage</TableHead>}
                        {isAdmin && <TableHead className="text-right">Chat this week</TableHead>}
                        <TableHead className="w-10" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {members.map((member) => {
                        const isSelf = member.user_id === currentUserId;
                        const memberUsage = usageByUser.get(member.user_id);
                        return (
                            <TableRow key={member.user_id}>
                                <TableCell>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="min-w-0">
                                            <p className="font-medium truncate">
                                                {member.name || member.email}
                                                {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                                            </p>
                                            {member.name && (
                                                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                                            )}
                                        </div>
                                        {member.role === "admin" && <Badge variant="secondary">Admin</Badge>}
                                    </div>
                                </TableCell>
                                {isAdmin && (
                                    <TableCell className="text-right tabular-nums">
                                        {memberUsage
                                            ? `${memberUsage.usage.paper_uploads.toLocaleString()} / ${memberUsage.limits.paper_uploads.toLocaleString()}`
                                            : "—"}
                                    </TableCell>
                                )}
                                {isAdmin && (
                                    <TableCell className="text-right tabular-nums">
                                        {memberUsage ? formatFileSize(memberUsage.usage.knowledge_base_size) : "—"}
                                    </TableCell>
                                )}
                                {isAdmin && (
                                    <TableCell className="text-right tabular-nums">
                                        {memberUsage ? `${Math.round(getChatCreditUsagePercentage(memberUsage))}%` : "—"}
                                    </TableCell>
                                )}
                                <TableCell>
                                    {(isAdmin || isSelf) && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="sm" aria-label={`Actions for ${member.name || member.email}`}>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {isAdmin && member.role === "member" && (
                                                    <DropdownMenuItem onClick={() => setRole(member, "admin")}>Make admin</DropdownMenuItem>
                                                )}
                                                {isAdmin && member.role === "admin" && (
                                                    <DropdownMenuItem onClick={() => setRole(member, "member")}>Remove admin</DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => setPendingRemoval({ member, isSelf })}
                                                >
                                                    {isSelf ? "Leave team" : "Remove from team"}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>

            <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {pendingRemoval?.isSelf ? `Leave ${teamName}?` : `Remove ${pendingRemoval?.member.name || pendingRemoval?.member.email}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingRemoval?.isSelf
                                ? "You'll go back to your own plan. Your papers and projects stay with you."
                                : "They'll go back to their own plan, and their papers and projects stay with them. The seat stays paid for, so you can invite someone else."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={remove}>
                            {pendingRemoval?.isSelf ? "Leave" : "Remove"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}
