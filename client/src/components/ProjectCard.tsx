import Link from "next/link";
import { Project, ProjectRole } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, FileText, MessageCircle, X, Users, Headphones, Table } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFromApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

// A slim single-line project row: title · description · stats · updated · actions.
// Used by the projects list and the home dashboard preview.
export function ProjectCard({ project, onProjectUpdate, onUnlink }: {
	project: Project;
	onProjectUpdate?: () => void;
	onUnlink?: () => void;
}) {
	const [showDeleteAlert, setShowDeleteAlert] = useState(false);
	const [showEditAlert, setShowEditAlert] = useState(false);
	const [showUnlinkAlert, setShowUnlinkAlert] = useState(false);
	const [showExitAlert, setShowExitAlert] = useState(false);
	const [currentTitle, setCurrentTitle] = useState(project.title);
	const [currentDescription, setCurrentDescription] = useState(project.description || '');
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);

	const deleteProject = async () => {
		try {
			const response = await fetchFromApi(`/api/projects/${project.id}`, {
				method: 'DELETE',
			});
			if (response) {
				setShowDeleteAlert(false);
				onProjectUpdate?.();
			} else {
				toast.error('Failed to delete project. Please try again.');
			}
		} catch (error) {
			console.error('An error occurred while deleting the project:', error);
			toast.error('An unexpected error occurred. Please try again.');
		}
	};

	const handleUpdateProject = async () => {
		try {
			const response = await fetchFromApi(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					title: currentTitle,
					description: currentDescription,
				}),
			});
			if (response) {
				setShowEditAlert(false);
				onProjectUpdate?.();
			} else {
				toast.error('Failed to update project. Please try again.');
			}
		} catch (error) {
			console.error('An error occurred while updating the project:', error);
			toast.error('An unexpected error occurred. Please try again.');
		}
	};

	const handleEditClick = () => {
		setCurrentTitle(project.title);
		setCurrentDescription(project.description || '');
		setShowEditAlert(true);
		setIsDropdownOpen(false);
	};

	const handleDeleteClick = () => {
		setShowDeleteAlert(true);
		setIsDropdownOpen(false);
	};

	const handleExitClick = () => {
		setShowExitAlert(true);
		setIsDropdownOpen(false);
	};

	const exitProject = async () => {
		try {
			const response = await fetchFromApi(`/api/projects/${project.id}/collaborators/self`, {
				method: 'DELETE',
			});
			if (response) {
				setShowExitAlert(false);
				onProjectUpdate?.();
				toast.success('You have left the project.');
			} else {
				toast.error('Failed to exit project. Please try again.');
			}
		} catch (error) {
			console.error('An error occurred while exiting the project:', error);
			toast.error('An unexpected error occurred. Please try again.');
		}
	};

	const updatedAt = project.updated_at ? formatDate(project.updated_at) : null;

	return (
		<>
			<Link
				href={`/projects/${project.id}`}
				className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent"
				onClick={(e) => {
					if (isDropdownOpen) e.preventDefault();
				}}
			>
				<div className="flex min-w-0 flex-1 items-baseline gap-3">
					<h3 className="truncate text-sm font-medium">{project.title}</h3>
					{project.description && (
						<span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
							{project.description}
						</span>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						<FileText className="h-3.5 w-3.5" aria-hidden />
						{project.num_papers ?? 0}
					</span>
					{(project.num_conversations ?? 0) > 0 && (
						<span className="flex items-center gap-1">
							<MessageCircle className="h-3.5 w-3.5" aria-hidden />
							{project.num_conversations}
						</span>
					)}
					{(project.num_audio_overviews ?? 0) > 0 && (
						<span className="flex items-center gap-1">
							<Headphones className="h-3.5 w-3.5" aria-hidden />
							{project.num_audio_overviews}
						</span>
					)}
					{(project.num_data_tables ?? 0) > 0 && (
						<span className="flex items-center gap-1">
							<Table className="h-3.5 w-3.5" aria-hidden />
							{project.num_data_tables}
						</span>
					)}
					{(project.num_roles ?? 1) > 1 && (
						<span className="flex items-center gap-1">
							<Users className="h-3.5 w-3.5" aria-hidden />
							{project.num_roles}
						</span>
					)}
				</div>

				{updatedAt && (
					<span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block">
						{updatedAt}
					</span>
				)}

				{onUnlink ? (
					<Button
						variant="ghost"
						size="icon"
						onClick={(e) => {
							e.preventDefault();
							setShowUnlinkAlert(true);
						}}
						aria-label="Unlink paper from project"
						className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				) : onProjectUpdate ? (
					<DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={(e) => e.preventDefault()}
								aria-label="Project actions"
								className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
							>
								<MoreHorizontal className="h-3.5 w-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-32" onClick={(e) => e.stopPropagation()}>
							{project.role === ProjectRole.Admin && (
								<DropdownMenuItem onClick={handleEditClick} className="cursor-pointer">
									Edit
								</DropdownMenuItem>
							)}
							{project.role === ProjectRole.Admin && (
								<DropdownMenuItem
									onClick={handleDeleteClick}
									className="cursor-pointer text-destructive focus:text-destructive"
								>
									Delete
								</DropdownMenuItem>
							)}
							{project.role !== ProjectRole.Admin && (
								<DropdownMenuItem
									onClick={handleExitClick}
									className="cursor-pointer text-destructive focus:text-destructive"
								>
									Exit
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</Link>

			<AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete your project and remove your data from our servers.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={deleteProject}>Continue</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={showEditAlert} onOpenChange={(isOpen) => {
				setShowEditAlert(isOpen);
				if (!isOpen) {
					setCurrentTitle(project.title);
					setCurrentDescription(project.description || '');
				}
			}}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Edit Project</AlertDialogTitle>
						<AlertDialogDescription>
							Update the title and description for your project.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="title" className="text-right">
								Title
							</Label>
							<Input
								id="title"
								value={currentTitle}
								onChange={(e) => setCurrentTitle(e.target.value)}
								className="col-span-3"
							/>
						</div>
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="description" className="text-right">
								Description
							</Label>
							<Input
								id="description"
								value={currentDescription}
								onChange={(e) => setCurrentDescription(e.target.value)}
								className="col-span-3"
							/>
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleUpdateProject}>Save</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={showUnlinkAlert} onOpenChange={setShowUnlinkAlert}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure you want to unlink this paper?</AlertDialogTitle>
						<AlertDialogDescription>
							This action will remove this paper from the project. You can add it back later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={onUnlink}>Unlink</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={showExitAlert} onOpenChange={setShowExitAlert}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Exit Project</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to leave this project? You will lose access to all project resources and conversations.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={exitProject} className="text-destructive-foreground bg-destructive hover:bg-destructive/90">
							Exit Project
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
