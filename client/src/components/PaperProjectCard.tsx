import Link from "next/link";
import { useState } from "react";
import { X } from "lucide-react";
import { Project } from "@/lib/schema";
import { Button } from "@/components/ui/button";
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
import { formatDate } from "@/lib/utils";

export function PaperProjectCard({
	project,
	onUnlink,
}: {
	project: Project;
	onUnlink?: () => void;
}) {
	const [showUnlinkAlert, setShowUnlinkAlert] = useState(false);
	const updatedAt = project.updated_at ? formatDate(project.updated_at) : null;

	return (
		<>
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
			<Link
				href={`/projects/${project.id}`}
				className="group flex items-center gap-2 p-2 rounded-sm border border-border/50 bg-card hover:border-border hover:shadow-sm transition-all"
			>
				<div className="flex-1 min-w-0">
					<h3 className="font-medium truncate group-hover:text-primary transition-colors">
						{project.title}
					</h3>
					{updatedAt && (
						<span className="block text-xs text-muted-foreground mt-0.5">
							{updatedAt}
						</span>
					)}
				</div>

				{onUnlink && (
					<Button
						variant="ghost"
						size="icon"
						onClick={(e) => {
							e.preventDefault();
							setShowUnlinkAlert(true);
						}}
						className="h-8 w-8 text-muted-foreground hover:text-foreground flex-shrink-0"
					>
						<X className="h-4 w-4" />
					</Button>
				)}
			</Link>
		</>
	);
}
