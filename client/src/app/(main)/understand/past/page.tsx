"use client"

"use client";

import { useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import { Conversation } from "@/lib/schema";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

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
						<Link href={`/understand?id=${conversation.id}`} key={conversation.id}>
							<Card className="p-4 transition-all hover:bg-muted/80 cursor-pointer border-border hover:border-primary/50">
								<div className="flex justify-between items-center">
									<h2 className="text-lg font-semibold truncate pr-4">{conversation.title}</h2>
									<p className="text-sm text-muted-foreground flex-shrink-0">
										{formatDate(conversation.updated_at)}
									</p>
								</div>
							</Card>
						</Link>
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
