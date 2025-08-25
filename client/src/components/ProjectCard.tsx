import Link from "next/link";
import { Project } from "@/lib/schema";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
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

export function ProjectCard({ project }: { project: Project }) {
	const [showDeleteAlert, setShowDeleteAlert] = useState(false);

	const deleteProject = async () => {
		try {
			const response = await fetch(`/api/projects/${project.id}`, {
				method: 'DELETE',
			});
			if (response.ok) {
				window.location.reload();
			} else {
				console.error('Failed to delete project');
			}
		} catch (error) {
			console.error('An error occurred while deleting the project:', error);
		}
	};

	const handleEditClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// TODO: Implement edit functionality
		console.log('Edit clicked for project:', project.id);
	};

	const handleDeleteClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setShowDeleteAlert(true);
	};

	return (
		<div className="relative">
			<Link href={`/projects/${project.id}`} className="block">
				<Card className="hover:shadow-lg transition-shadow duration-200">
					<CardHeader>
						<CardTitle>{project.title}</CardTitle>
						<CardDescription>{project.description}</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-gray-500">
							Created: {new Date(project.created_at).toLocaleDateString()}
						</p>
					</CardContent>
					<CardFooter>
						<p className="text-sm text-gray-500">
							Updated: {new Date(project.updated_at).toLocaleDateString()}
						</p>
					</CardFooter>
				</Card>
			</Link>
			<div className="absolute top-2 right-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
							}}
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem onClick={handleEditClick}>Edit</DropdownMenuItem>
						<DropdownMenuItem onClick={handleDeleteClick}>
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

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
		</div>
	);
}
