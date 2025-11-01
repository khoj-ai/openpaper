import Link from "next/link";
import { Project } from "@/lib/schema";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, ArrowRight, FileText, MessageCircle, X } from "lucide-react";
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


export function ProjectCard({ project, onProjectUpdate, onUnlink }: {
	project: Project;
	onProjectUpdate?: () => void;
	onUnlink?: () => void;
}) {
	const [showDeleteAlert, setShowDeleteAlert] = useState(false);
	const [showEditAlert, setShowEditAlert] = useState(false);
	const [showUnlinkAlert, setShowUnlinkAlert] = useState(false);
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
			if (response.ok) {
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

	const handleCardClick = (e: React.MouseEvent) => {
		// Prevent navigation if dropdown is open or if clicking on dropdown area
		if (isDropdownOpen) {
			e.preventDefault();
		}
	};

	return (
		<div className="relative group">
			<Link href={`/projects/${project.id}`} className="block" onClick={handleCardClick}>
				<Card className="h-64 transition-all duration-300 border-border/50 hover:border-border bg-card/50 backdrop-blur-sm hover:shadow-xl hover:ring-1 hover:ring-border">
					<CardHeader className="pb-3">
						<CardTitle className="text-lg font-semibold text-foreground line-clamp-2 flex items-center">
							{currentTitle}
						</CardTitle>
						{currentDescription && (
							<CardDescription className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">
								{currentDescription}
							</CardDescription>
						)}
					</CardHeader>
					<CardFooter className="pt-0 mt-auto">
						<div className="flex items-center justify-between w-full">
							<div className="flex items-center gap-4 text-xs text-muted-foreground/70">
								<span>Updated {formatDate(project.updated_at)}</span>
								<div className="flex items-center gap-3">
									<div className="flex items-center gap-1">
										<FileText className="h-3 w-3" />
										<span>{project.num_papers ?? 0}</span>
									</div>
									<div className="flex items-center gap-1">
										<MessageCircle className="h-3 w-3" />
										<span>{project.num_conversations ?? 0}</span>
									</div>
								</div>
							</div>
							<ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
						</div>
					</CardFooter>
				</Card>
			</Link>
			{/* Hover-only dropdown menu */}
			{onUnlink ? (
				<div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-200 ease-in-out transform translate-y-1 group-hover:translate-y-0 z-20">
					<Button
						variant="ghost"
						size="icon"
						onClick={(e) => {
							e.preventDefault();
							setShowUnlinkAlert(true);
						}}
						className="h-8 w-8 bg-background/80 backdrop-blur-sm border-none hover:border-none shadow-none"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
			) : (
				<div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-200 ease-in-out transform translate-y-1 group-hover:translate-y-0 z-20">
					<DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 bg-background/80 backdrop-blur-sm border-none hover:border-none shadow-none"
							>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-32">
							<DropdownMenuItem
								onClick={handleEditClick}
								className="cursor-pointer"
							>
								Edit
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={handleDeleteClick}
								className="cursor-pointer text-destructive focus:text-destructive"
							>
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}

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
		</div>
	);
}
