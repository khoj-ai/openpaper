'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Plus, X } from 'lucide-react';
import { Collaborator, PendingInvite, ProjectRole } from '@/lib/schema';
import { fetchFromApi } from '@/lib/api';
import { Badge } from './ui/badge';
import { getAlphaHashToBackgroundColor, getInitials } from '@/lib/utils';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface ProjectCollaboratorsProps {
	projectId: string;
	currentUserIsAdmin: boolean;
	setHasCollaborators?: (hasCollaborators: boolean) => void;
}

export function ProjectCollaborators({ projectId, currentUserIsAdmin, setHasCollaborators }: ProjectCollaboratorsProps) {
	const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
	const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
	const [isManageModalOpen, setIsManageModalOpen] = useState(false);
	const [draftInvites, setDraftInvites] = useState<PendingInvite[]>([{ email: '', role: ProjectRole.Viewer, invited_at: '' }]);
	const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
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
					if (setHasCollaborators) {
						setHasCollaborators(response.length > 1);
					}
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
					const invites: PendingInvite[] = response.invitations.map((inv: PendingInvite) => ({
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
			const newPendingInvites: PendingInvite[] = response.invitations.map((inv: PendingInvite) => ({
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

	const handleRoleChange = async (collaboratorId: string, newRole: ProjectRole) => {
		try {
			await fetchFromApi(`/api/projects/${projectId}/collaborators/change`, {
				method: 'POST',
				body: JSON.stringify({
					role_id: collaboratorId,
					new_role: newRole,
				}),
			});

			// Update local state
			setCollaborators(collaborators.map((c: Collaborator) =>
				c.id === collaboratorId ? { ...c, role: newRole } : c
			));

			toast.success(`Role updated to ${newRole}.`);
		} catch (error) {
			console.error('Error changing role:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to change role. Please try again.');
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
			const updatedInvites = draftInvites.filter((_: unknown, i: number) => i !== index);
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

	// Maximum number of avatars to show before "+X more"
	const MAX_VISIBLE_AVATARS = 4;
	const visibleCollaborators = collaborators.slice(0, MAX_VISIBLE_AVATARS);
	const remainingCount = collaborators.length - MAX_VISIBLE_AVATARS;

	// Role Badge Component - clickable dropdown for admins, static for others
	const RoleBadgeDropdown = ({ collaborator }: { collaborator: Collaborator }) => {
		const canChangeRole = currentUserIsAdmin && collaborator.role !== ProjectRole.Admin;

		if (!canChangeRole) {
			return (
				<Badge variant={'outline'}>
					{collaborator.role}
				</Badge>
			);
		}

		// Determine the alternate role (the one not currently assigned)
		const alternateRole = collaborator.role === ProjectRole.Viewer ? ProjectRole.Editor : ProjectRole.Viewer;

		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Badge variant={'outline'} className="cursor-pointer hover:bg-accent">
						{collaborator.role}
					</Badge>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						disabled
						className="text-xs text-muted-foreground"
					>
						Change role to:
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => handleRoleChange(collaborator.id, alternateRole)}
					>
						{alternateRole}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	};

	return (
		<div className="flex items-center gap-3 ml-auto">
			{/* Stacked Avatars */}
			<TooltipProvider>
				<div
					className="flex items-center -space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
					onClick={() => setIsManageModalOpen(true)}
				>
					{isLoading ? (
						<>
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="h-8 w-8 rounded-full bg-muted border-2 border-background animate-pulse"
								/>
							))}
						</>
					) : (
						<>
							{visibleCollaborators.map((collaborator: Collaborator) => (
								<Tooltip key={collaborator.id}>
									<TooltipTrigger asChild>
										<Avatar className="h-8 w-8 border-2 border-background ring-0">
											<AvatarImage src={collaborator.picture} alt={collaborator.name} />
											<AvatarFallback className={`text-xs ${getAlphaHashToBackgroundColor(collaborator.name)}`}>
												{getInitials(collaborator.name)}
											</AvatarFallback>
										</Avatar>
									</TooltipTrigger>
									<TooltipContent>
										<p>{collaborator.name}</p>
									</TooltipContent>
								</Tooltip>
							))}
							{remainingCount > 0 && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Avatar className="h-8 w-8 border-2 border-background ring-0">
											<AvatarFallback className="text-xs bg-muted">
												+{remainingCount}
											</AvatarFallback>
										</Avatar>
									</TooltipTrigger>
									<TooltipContent>
										<p>{remainingCount} more collaborator{remainingCount > 1 ? 's' : ''}</p>
									</TooltipContent>
								</Tooltip>
							)}
							{pendingInvites.length > 0 && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Avatar className="h-8 w-8 border-2 border-background ring-0 opacity-60">
											<AvatarFallback className="text-xs bg-muted text-muted-foreground">
												+{pendingInvites.length}
											</AvatarFallback>
										</Avatar>
									</TooltipTrigger>
									<TooltipContent>
										<p>{pendingInvites.length} pending invite{pendingInvites.length > 1 ? 's' : ''}</p>
									</TooltipContent>
								</Tooltip>
							)}
						</>
					)}
				</div>
			</TooltipProvider>

			{/* Invite Button */}
			{currentUserIsAdmin && (
				<Button
					variant="outline"
					size="sm"
					onClick={() => setIsInviteModalOpen(true)}
					className="h-8"
				>
					<Plus className="h-4 w-4 mr-1" />
					Invite
				</Button>
			)}

			{/* Manage Collaborators Modal */}
			<Dialog open={isManageModalOpen} onOpenChange={setIsManageModalOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Collaborators</DialogTitle>
						<DialogDescription>
							{currentUserIsAdmin
								? "Manage team members and their roles in this project."
								: "View team members in this project."}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
						{/* Active Collaborators */}
						{collaborators.map((collaborator: Collaborator) => (
							<div key={collaborator.id} className="flex items-center justify-between">
								<div className="flex items-center space-x-3">
									<Avatar className="h-9 w-9">
										<AvatarImage src={collaborator.picture} alt={collaborator.name} />
										<AvatarFallback className={getAlphaHashToBackgroundColor(collaborator.name)}>
											{getInitials(collaborator.name)}
										</AvatarFallback>
									</Avatar>
									<div className="min-w-0">
										<p className="font-medium text-sm truncate">{collaborator.name}</p>
										<p className="text-xs text-muted-foreground truncate">{collaborator.email}</p>
									</div>
								</div>
								<div className="flex items-center space-x-2 flex-shrink-0">
									<RoleBadgeDropdown collaborator={collaborator} />
									{currentUserIsAdmin && collaborator.role !== ProjectRole.Admin && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button variant="ghost" size="sm" className='h-auto p-1 w-auto'>
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
							<div className="border-t pt-4 mt-4">
								<p className="text-sm font-medium text-muted-foreground mb-3">Pending Invites</p>
								<div className="space-y-3">
									{pendingInvites.map((invite: PendingInvite, index: number) => (
										<div key={`pending-${index}`} className="flex items-center justify-between opacity-60">
											<div className="flex items-center space-x-3">
												<Avatar className="h-9 w-9 opacity-50">
													<AvatarFallback className="bg-muted text-xs">
														{invite.email.charAt(0).toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className="min-w-0">
													<p className="font-medium text-sm text-muted-foreground truncate">{invite.email}</p>
													<p className="text-xs text-muted-foreground">Invite sent • Not yet accepted</p>
												</div>
											</div>
											<div className="flex items-center space-x-2 flex-shrink-0">
												<span className="text-xs text-muted-foreground">{invite.role}</span>
												{currentUserIsAdmin && (
													<AlertDialog>
														<AlertDialogTrigger asChild>
															<Button variant="ghost" size="sm" className='h-auto p-1 w-auto'>
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
						)}
					</div>
					<DialogFooter>
						{currentUserIsAdmin && (
							<Button
								variant="outline"
								onClick={() => {
									setIsManageModalOpen(false);
									setIsInviteModalOpen(true);
								}}
							>
								<Plus className="h-4 w-4 mr-1" />
								Invite More
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Invite Modal */}
			<Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
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
					<p className="text-sm text-muted-foreground pt-2">
						<strong>Viewers</strong> can see all papers, chats, and artifacts, but cannot create new ones. <strong>Editors</strong> can do all that, plus add papers and create new chats and artifacts.
					</p>
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
		</div>
	);
}
