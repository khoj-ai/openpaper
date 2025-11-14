'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { X } from 'lucide-react';
import { Collaborator, PendingInvite, ProjectRole } from '@/lib/schema';
import { fetchFromApi } from '@/lib/api';
import { Badge } from './ui/badge';
import { getAlphaHashToBackgroundColor, getInitials } from '@/lib/utils';

interface ProjectCollaboratorsProps {
	projectId: string;
	currentUserIsAdmin: boolean;
}

export function ProjectCollaborators({ projectId, currentUserIsAdmin }: ProjectCollaboratorsProps) {
	const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
	const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
	const [draftInvites, setDraftInvites] = useState<PendingInvite[]>([{ email: '', role: ProjectRole.Viewer, invited_at: '' }]);
	const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
	const [isExpanded, setIsExpanded] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	// Load collaborators on mount
	useEffect(() => {
		const loadCollaborators = async () => {
			try {
				setIsLoading(true);
				const response: Collaborator[] = await fetchFromApi(`/api/projects/${projectId}/collaborators`);

				if (response) {
					setCollaborators(response);
				}
			} catch (error) {
				console.error('Error loading collaborators:', error);
				toast.error('Failed to load collaborators.');
			} finally {
				setIsLoading(false);
			}
		};

		loadCollaborators();
	}, [projectId]);

	// Load pending invites on mount
	useEffect(() => {
		const loadPendingInvites = async () => {
			try {
				const response = await fetchFromApi(`/api/projects/invitations/${projectId}/`);

				if (response.invitations) {
					const invites: PendingInvite[] = response.invitations.map((inv: any) => ({
						id: inv.id,
						email: inv.email,
						role: inv.role,
						invited_at: inv.invited_at,
					}));
					setPendingInvites(invites);
				}
			} catch (error) {
				console.error('Error loading pending invites:', error);
				// Silently fail - pending invites are not critical for initial render
			}
		};

		loadPendingInvites();
	}, [projectId]);

	const handleSendInvites = async () => {
		const validInvites = draftInvites.filter((invite: PendingInvite) => invite.email.trim() && invite.email.includes('@'));

		if (validInvites.length === 0) {
			toast.error('Please enter at least one valid email address.');
			return;
		}

		setIsSending(true);

		try {
			const response = await fetchFromApi(`/api/projects/invitations/${projectId}/invite`, {
				method: 'POST',
				body: JSON.stringify({
					invites: validInvites.map((invite: PendingInvite) => ({
						email: invite.email,
						role: invite.role,
					})),
				}),
			});

			// Construct pending invites from response
			const newPendingInvites: PendingInvite[] = response.invitations.map((inv: any) => ({
				id: inv.id,
				email: inv.email,
				role: inv.role,
				invited_at: inv.invited_at,
			}));

			// Add to pending invites
			setPendingInvites([...pendingInvites, ...newPendingInvites]);

			// Reset draft invites
			setDraftInvites([{ email: '', role: ProjectRole.Viewer, invited_at: '' }]);
			setIsInviteModalOpen(false);

			toast.success(response.message || `${response.invited_count} invitation(s) sent.`);
		} catch (error) {
			console.error('Error sending invites:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to send invitations. Please try again.');
		} finally {
			setIsSending(false);
		}
	};

	const handleRemove = async (collaboratorId: string) => {
		try {
			await fetchFromApi(`/api/projects/${projectId}/collaborators/${collaboratorId}`, {
				method: 'DELETE',
			});

			setCollaborators(collaborators.filter((c: Collaborator) => c.id !== collaboratorId));
			toast.success('Collaborator removed.');
		} catch (error) {
			console.error('Error removing collaborator:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to remove collaborator. Please try again.');
		}
	};

	const handleDraftInviteChange = (index: number, field: keyof PendingInvite, value: string) => {
		const updatedInvites = [...draftInvites];
		updatedInvites[index] = { ...updatedInvites[index], [field]: value };
		setDraftInvites(updatedInvites);
	};

	const addDraftInvite = () => {
		setDraftInvites([...draftInvites, { email: '', role: ProjectRole.Viewer, invited_at: '' }]);
	};

	const removeDraftInvite = (index: number) => {
		if (draftInvites.length > 1) {
			const updatedInvites = draftInvites.filter((_: any, i: number) => i !== index);
			setDraftInvites(updatedInvites);
		}
	};

	const removePendingInvite = async (invitationId: string) => {
		try {
			await fetchFromApi(`/api/projects/invitations/modify/${invitationId}/retract`, {
				method: 'DELETE',
			});

			setPendingInvites(pendingInvites.filter((invite: PendingInvite) => invite.id !== invitationId));
			toast.success('Pending invitation cancelled.');
		} catch (error) {
			console.error('Error retracting invitation:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to cancel invitation. Please try again.');
		}
	};

	const isValidEmail = (email: string) => {
		// Simple email validation regex
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}

	const displayedCollaborators = isExpanded ? collaborators : collaborators.slice(0, 3);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>Collaborators</CardTitle>
				{currentUserIsAdmin && (
					<Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
						<DialogTrigger asChild>
							<Button variant="outline">Invite</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Invite Collaborators</DialogTitle>
								<DialogDescription>
									Add collaborators to your project. They will be notified by email.<br />If they do not have an Open Paper account, they will first receive an invitation to create one.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-2">
								{draftInvites.map((invite: PendingInvite, index: number) => (
									<div key={index} className="flex items-end space-x-2">
										<div className="grid flex-1 gap-2">
											<Label htmlFor={`email-${index}`} className="sr-only">Email</Label>
											<Input
												id={`email-${index}`}
												type="email"
												placeholder="name@example.com"
												value={invite.email}
												onChange={(e) => handleDraftInviteChange(index, 'email', e.target.value)}
											/>
										</div>
										<div className="grid gap-2">
											<Label htmlFor={`role-${index}`} className="sr-only">Role</Label>
											<Select
												value={invite.role}
												onValueChange={(value) => handleDraftInviteChange(index, 'role', value)}
											>
												<SelectTrigger id={`role-${index}`}>
													<SelectValue placeholder="Role" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="viewer">Viewer</SelectItem>
													<SelectItem value="editor">Editor</SelectItem>
													{/* Don't allow Admin selection for now for simplicity */}
													{/* <SelectItem value="admin">Admin</SelectItem> */}
												</SelectContent>
											</Select>
										</div>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => removeDraftInvite(index)}
											disabled={draftInvites.length === 1}
										>
											<X className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
							<Button variant="outline" onClick={addDraftInvite} className="mt-2">
								Add another
							</Button>
							<DialogFooter>
								<Button variant="secondary" onClick={() => setIsInviteModalOpen(false)} disabled={isSending}>Cancel</Button>
								<Button
									disabled={draftInvites.every((invite) => !isValidEmail(invite.email)) || isSending}
									onClick={handleSendInvites}
								>
									{isSending ? 'Sending...' : 'Send Invites'}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				)}
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="space-y-4">
						{[1, 2, 3].map((i) => (
							<div key={i} className="flex items-center space-x-4 animate-pulse">
								<div className="h-10 w-10 rounded-full bg-muted" />
								<div className="flex-1 space-y-2">
									<div className="h-4 bg-muted rounded w-1/3" />
									<div className="h-3 bg-muted rounded w-1/2" />
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="space-y-4">
						{displayedCollaborators.map((collaborator: Collaborator) => (
						<div key={collaborator.id} className="flex items-center justify-between">
							<div className="flex items-center space-x-4">
								<Avatar>
									<AvatarImage src={collaborator.picture} alt={collaborator.name} />
									<AvatarFallback className={getAlphaHashToBackgroundColor(collaborator.name)}>
										{getInitials(collaborator.name)}
									</AvatarFallback>
								</Avatar>
								<div>
									<p className="font-medium">{collaborator.name}</p>
									<p className="text-sm text-muted-foreground">{collaborator.email}</p>
								</div>
							</div>
							<div className="flex items-center space-x-2">
								<Badge variant={'outline'}>
									{collaborator.role}
								</Badge>
								{currentUserIsAdmin && collaborator.role !== ProjectRole.Admin && (
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<Button variant="outline" size="sm">
												<X className="h-4 w-4" />
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Remove Collaborator</AlertDialogTitle>
												<AlertDialogDescription>
													Are you sure you want to remove <b>{collaborator.name}</b> from the project? You will have to invite them again to add them back.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogAction onClick={() => handleRemove(collaborator.id)}>
													Remove
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								)}
							</div>
						</div>
					))}

					{/* Pending Invites Section */}
					{pendingInvites.length > 0 && (
						<>
							<div className="border-t pt-4 mt-4">
								<p className="text-sm font-medium text-muted-foreground mb-3">Pending Invites</p>
								<div className="space-y-3">
									{pendingInvites.map((invite: PendingInvite, index: number) => (
										<div key={`pending-${index}`} className="flex items-center justify-between opacity-60">
											<div className="flex items-center space-x-4">
												<Avatar className="opacity-50">
													<AvatarFallback className="bg-muted">
														{invite.email.charAt(0).toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div>
													<p className="font-medium text-muted-foreground">{invite.email}</p>
													<p className="text-xs text-muted-foreground">Invite sent • Not yet accepted</p>
												</div>
											</div>
											<div className="flex items-center space-x-2">
												<span className="text-sm text-muted-foreground">{invite.role}</span>
												{currentUserIsAdmin && (
													<AlertDialog>
														<AlertDialogTrigger asChild>
															<Button variant="outline" size="sm">
																<X className="h-4 w-4" />
															</Button>
														</AlertDialogTrigger>
														<AlertDialogContent>
															<AlertDialogHeader>
																<AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
																<AlertDialogDescription>
																	Are you sure you want to cancel the invitation to {invite.email}?
																</AlertDialogDescription>
															</AlertDialogHeader>
															<AlertDialogFooter>
																<AlertDialogCancel>Cancel</AlertDialogCancel>
																<AlertDialogAction onClick={() => invite.id && removePendingInvite(invite.id)}>
																	Cancel Invitation
																</AlertDialogAction>
															</AlertDialogFooter>
														</AlertDialogContent>
													</AlertDialog>
												)}
											</div>
										</div>
									))}
								</div>
							</div>
						</>
					)}
					</div>
				)}
				{!isLoading && collaborators.length > 3 && (
					<div className="mt-4">
						<Button variant="link" onClick={() => setIsExpanded(!isExpanded)} className="p-0 h-auto">
							{isExpanded ? 'Show less' : `See all (${collaborators.length})`}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
