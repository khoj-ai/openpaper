"use client";

import { useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import { Conversation } from "@/lib/schema";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import ConversationCard from "@/components/ConversationCard";

export default function PastConversationsPage() {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [searchTerm, setSearchTerm] = useState("");

	useEffect(() => {
		const fetchConversations = async () => {
			try {
				const response = await fetchFromApi("/api/conversation/everything");
				setConversations(response);
			} catch (error) {
				console.error("Error fetching everything conversations", error);
				setConversations([]);
			}
		};

		fetchConversations();
	}, []);

	const handleDeleteConversation = async (conversationId: string) => {
		try {
			await fetchFromApi(`/api/conversation/${conversationId}`, {
				method: "DELETE",
			});
			setConversations(conversations.filter((c) => c.id !== conversationId));
		} catch (error) {
			console.error("Error deleting conversation", error);
		}
	};

	const filteredConversations = conversations.filter((conversation) =>
		conversation.title?.toLowerCase().includes(searchTerm.toLowerCase())
	);

	return (
		<div className="p-4 md:p-6 lg:w-2/3 mx-auto">
			<div className="flex justify-between items-start mb-6">
				<div>
					<h1 className="text-3xl font-bold">Past Conversations</h1>
					<p className="text-muted-foreground mt-1">
						Browse and manage your previous conversations.
					</p>
				</div>
				<Link href="/understand">
					<Button variant="outline">
						<Plus className="mr-2 h-4 w-4" /> New Chat
					</Button>
				</Link>
			</div>
			<div className="mb-4">
				<Input
					placeholder="Search conversations..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
					className="max-w-sm"
				/>
			</div>
			<div className="flex flex-col gap-3">
				{filteredConversations.length > 0 ? (
					filteredConversations.map((conversation) => (
						<ConversationCard
							key={conversation.id}
							convo={conversation}
							href={`/understand?id=${conversation.id}`}
							onDelete={handleDeleteConversation}
						/>
					))
				) : (
					<div className="text-center py-12">
						<p className="text-muted-foreground">
							No conversations found. Start a new one!
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
