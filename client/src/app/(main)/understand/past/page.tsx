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
		<div className="p-4 md:w-1/2 mx-auto">
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-2xl font-bold">Past Conversations</h1>
				<Link href="/understand">
					<Button className="bg-blue-500 text-white hover:bg-blue-600 dark:*:bg-blue-600 dark:hover:bg-blue-700">
						<Plus className="mr-1 h-4 w-4" /> New
					</Button>
				</Link>
			</div>
			<div className="mb-4">
				<Input
					placeholder="Search conversations..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
				/>
			</div>
			<div className="flex flex-col gap-2">
				{filteredConversations.map((conversation) => (
					<Link href={`/understand?id=${conversation.id}`} key={conversation.id}>
						<Card className="p-4 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer border-0">
							<div className="flex justify-between">
								<h2 className="text-lg font-semibold">{conversation.title}</h2>
								<p className="text-sm text-gray-500">
									{formatDate(conversation.updated_at)}
								</p>
							</div>
						</Card>
					</Link>
				))}
			</div>
		</div>
	);
}
