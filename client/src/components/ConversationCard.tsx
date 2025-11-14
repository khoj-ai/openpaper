"use client";

import { Conversation } from "@/lib/schema";
import { formatDate, getInitials } from "@/lib/utils";
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
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { getAlphaHashToBackgroundColor } from "@/lib/utils";

interface ConversationCardProps {
	convo: Conversation;
	showAvatar?: boolean;
	href: string;
	onDelete: (conversationId: string) => void;
}

export default function ConversationCard({ convo, href, onDelete, showAvatar = true }: ConversationCardProps) {
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
				<div className="flex items-start justify-between">
					<div className="flex flex-col">
						<span className="font-semibold text-accent-foreground">{convo.title}</span>
						<p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
							{formatDate(convo.updated_at)}
						</p>
					</div>
					<div className="flex flex-col items-end">
						{showAvatar && convo.owner_name && (
							<Avatar className="size-6 mb-2">
								<AvatarImage src={convo.owner_picture} />
								<AvatarFallback
									className={`${getAlphaHashToBackgroundColor(
										convo.owner_name,
									)} text-xs`}>
									{getInitials(convo.owner_name)}
								</AvatarFallback>
							</Avatar>
						)}
						<div className="flex items-center">
							{convo.is_owner && (
								<Button
									variant="ghost"
									size="icon"
									onClick={handleDelete}
									className="mr-2 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<Trash2 className="w-4 h-4 text-gray-400" />
								</Button>
							)}
							<ArrowRight className="w-4 h-4 text-gray-400 transform transition-all group-hover:translate-x-1 opacity-0 group-hover:opacity-100" />
						</div>
					</div>
				</div>
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
