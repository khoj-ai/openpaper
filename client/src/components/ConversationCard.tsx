"use client";

import { Conversation } from "@/lib/schema";
import { formatDate } from "@/lib/utils";
import { ArrowRight, Trash2 } from "lucide-react";
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
import { Button } from "./ui/button";

interface ConversationCardProps {
	convo: Conversation;
	href: string;
	onDelete: (conversationId: string) => void;
}

export default function ConversationCard({ convo, href, onDelete }: ConversationCardProps) {
	const [isAlertOpen, setIsAlertOpen] = useState(false);

	const handleDelete = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsAlertOpen(true);
	};

	const confirmDelete = async () => {
		onDelete(convo.id);
		setIsAlertOpen(false);
	};

	return (
		<>
			<a
				href={href}
				className="block p-4 mb-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-all hover:bg-gray-50 dark:hover:bg-gray-800 animate-fade-in group"
			>
				<div className="font-semibold text-accent-foreground flex items-center justify-between">
					<span>{convo.title}</span>
					<div className="flex items-center">
						<Button
							variant="ghost"
							size="icon"
							onClick={handleDelete}
							className="mr-2 opacity-0 group-hover:opacity-100 transition-opacity"
						>
							<Trash2 className="w-4 h-4 text-gray-400" />
						</Button>
						<ArrowRight className="w-4 h-4 text-gray-400 transform transition-transform group-hover:translate-x-1 opacity-0 group-hover:opacity-100 transition-opacity" />
					</div>
				</div>
				<p>{formatDate(convo.updated_at)}</p>
			</a>
			<AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete the conversation.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
