"use client";

import { Conversation } from "@/lib/schema";
import { formatDate, getInitials } from "@/lib/utils";
import { ArrowRight, Trash2 } from "lucide-react";
import Link from "next/link";
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
	// Slim single-line row instead of a boxed card (used in dense lists).
	compact?: boolean;
}

export default function ConversationCard({ convo, href, onDelete, showAvatar = true, compact = false }: ConversationCardProps) {
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

	if (compact) {
		return (
			<>
				<Link
					href={href}
					className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent"
				>
					<span className="min-w-0 flex-1 truncate text-sm">{convo.title}</span>
					{showAvatar && convo.owner_name && (
						<Avatar className="size-5 shrink-0">
							<AvatarImage src={convo.owner_picture} />
							<AvatarFallback
								className={`${getAlphaHashToBackgroundColor(convo.owner_name)} text-[9px]`}>
								{getInitials(convo.owner_name)}
							</AvatarFallback>
						</Avatar>
					)}
					<span className="shrink-0 text-xs text-muted-foreground">{formatDate(convo.updated_at)}</span>
					{convo.is_owner && (
						<Button
							variant="ghost"
							size="icon"
							onClick={handleDelete}
							aria-label="Delete conversation"
							className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
						>
							<Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
						</Button>
					)}
				</Link>
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

	return (
		<>
			{/* Client-side Link keeps the project workspace mounted (reader tabs, uploads). */}
			<Link
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
			</Link>
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
