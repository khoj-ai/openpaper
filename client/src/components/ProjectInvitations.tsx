"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Mail, Check, X, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProjectInvitation } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";

interface ProjectInvitationsProps {
	onInvitationAccepted?: () => void;
	defaultOpen?: boolean;
}

export function ProjectInvitations({ onInvitationAccepted, defaultOpen = false }: ProjectInvitationsProps) {
	const [open, setOpen] = useState(defaultOpen);
	const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
	const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());

	const pendingCount = invitations.filter(inv => !inv.accepted_at).length;

	const fetchInvitations = async () => {
		setIsLoading(true);
		try {
			const data = await fetchFromApi('/api/projects/invitations/user');
			setInvitations(data.invitations || []);
		} catch (error) {
			console.error('Failed to fetch invitations:', error);
			toast.error('Failed to load invitations');
			setInvitations([]);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchInvitations();
	}, []);

	const handleAccept = async (invitationId: string) => {
		setProcessingIds(prev => new Set(prev).add(invitationId));

		try {
			await fetchFromApi(`/api/projects/invitations/modify/${invitationId}/accept`, {
				method: 'POST',
			});

			setAcceptedIds(prev => new Set(prev).add(invitationId));
			toast.success("Invitation accepted!");

			// Update the invitation status locally
			setInvitations(prev =>
				prev.map(inv =>
					inv.id === invitationId ? { ...inv, accepted_at: new Date().toISOString() } : inv
				)
			);

			if (onInvitationAccepted) {
				onInvitationAccepted();
			}
		} catch (error) {
			console.error('Failed to accept invitation:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to accept invitation');
		} finally {
			setProcessingIds(prev => {
				const next = new Set(prev);
				next.delete(invitationId);
				return next;
			});
		}
	};

	const handleReject = async (invitationId: string) => {
		setProcessingIds(prev => new Set(prev).add(invitationId));

		try {
			await fetchFromApi(`/api/projects/invitations/modify/${invitationId}/reject`, {
				method: 'POST',
			});

			toast.success("Invitation rejected");

			// Remove the rejected invitation from the list
			setInvitations(prev => prev.filter(inv => inv.id !== invitationId));
		} catch (error) {
			console.error('Failed to reject invitation:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to reject invitation');
		} finally {
			setProcessingIds(prev => {
				const next = new Set(prev);
				next.delete(invitationId);
				return next;
			});
		}
	};

	if (pendingCount === 0) {
		return null;
	}

	return (
		<>
			<Button
				variant="outline"
				className="relative"
				onClick={() => setOpen(true)}
			>
				<Mail className="mr-2 h-4 w-4" />
				{pendingCount > 0 && (
					<Badge
						className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 bg-green-500 text-white border-2 border-background rounded-full text-xs"
					>
						{pendingCount}
					</Badge>
				)}
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Project Invitations</DialogTitle>
						<DialogDescription>
							{pendingCount > 0
								? `You have ${pendingCount} pending invitation${pendingCount === 1 ? '' : 's'}`
								: "You have no pending invitations"}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3 mt-4">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : invitations.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
								<p>No invitations at this time</p>
							</div>
						) : (
							invitations.map((invitation) => {
								const isProcessing = processingIds.has(invitation.id);
								const isAccepted = acceptedIds.has(invitation.id) || invitation.accepted_at !== null;
								const isPending = invitation.accepted_at === null;

								return (
									<div
										key={invitation.id}
										className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
									>
										<div className="flex-1 min-w-0 mr-4">
											<div className="flex items-center gap-2 mb-1">
												{isAccepted ? (
													<Link
														href={`/projects/${invitation.project_id}`}
														className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
													>
														{invitation.project_name}
													</Link>
												) : (
													<h3 className="font-semibold truncate">
														{invitation.project_name}
													</h3>
												)}
												{isAccepted && (
													<Badge variant="secondary" className="bg-green-100 text-green-700">
														Accepted
													</Badge>
												)}
											</div>
											<p className="text-sm text-muted-foreground">
												Invited by <span className="font-medium">{invitation.invited_by}</span>
											</p>
											<p className="text-xs text-muted-foreground">
												{new Date(invitation.invited_at).toLocaleDateString()}
											</p>
											<Badge variant={'secondary'} className="text-xs mt-1">
												{invitation.role}
											</Badge>
										</div>

										<div className="flex items-center gap-2 flex-shrink-0">
											{isAccepted ? (
												<Link href={`/projects/${invitation.project_id}`}>
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8"
													>
														<ArrowRight className="h-4 w-4" />
													</Button>
												</Link>
											) : isPending ? (
												<>
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
														onClick={() => handleAccept(invitation.id)}
														disabled={isProcessing}
													>
														{isProcessing ? (
															<Loader2 className="h-4 w-4 animate-spin" />
														) : (
															<Check className="h-4 w-4" />
														)}
													</Button>
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
														onClick={() => handleReject(invitation.id)}
														disabled={isProcessing}
													>
														{isProcessing ? (
															<Loader2 className="h-4 w-4 animate-spin" />
														) : (
															<X className="h-4 w-4" />
														)}
													</Button>
												</>
											) : null}
										</div>
									</div>
								);
							})
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
