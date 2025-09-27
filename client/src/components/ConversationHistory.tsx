"use client";

import { useState } from "react";
import { Conversation } from "@/lib/schema";
import { Input } from "@/components/ui/input";
import ConversationCard from "@/components/ConversationCard";

interface ConversationHistoryProps {
  conversations: Conversation[];
  onDelete: (conversationId: string) => void;
  baseHref?: string;
  hrefGenerator?: (conversation: Conversation) => string;
}

export default function ConversationHistory({
  conversations,
  onDelete,
  baseHref,
  hrefGenerator,
}: ConversationHistoryProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredConversations = conversations.filter((conversation) =>
    conversation.title?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getHref = (conversation: Conversation) => {
    if (hrefGenerator) {
      return hrefGenerator(conversation);
    }
    return `${baseHref}?id=${conversation.id}`;
  };

  return (
    <div>
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
              href={getHref(conversation)}
              onDelete={onDelete}
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
