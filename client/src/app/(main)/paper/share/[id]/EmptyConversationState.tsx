import { BasicUser } from "@/lib/auth";
import { MessageSquareDashed } from "lucide-react";

export interface EmptyConversationStateProps {
    owner?: BasicUser;
}

export default function EmptyConversationState({ owner }: EmptyConversationStateProps) {
    return (
        <div className="flex flex-col justify-center items-center h-full p-6 text-center">
            {/* Enhanced visual hierarchy */}
            <div className="relative mb-6">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full blur-xl"></div>
                <div className="relative bg-white dark:bg-gray-800 rounded-full p-4 shadow-lg">
                    <MessageSquareDashed className="w-12 h-12 text-blue-500" />
                </div>
            </div>

            {/* More engaging headline */}
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                No conversation yet
            </h3>

            {/* Improved description with owner context */}
            <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-sm leading-relaxed">
                {owner?.name ? (
                    <>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{owner.name}</span> hasn't started chatting with this paper yet.
                    </>
                ) : (
                    'The owner hasn\'t started chatting with this paper yet.'
                )}
            </p>

            {/* What to expect section */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 font-medium">
                    When they do, you'll see:
                </p>
                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                        Questions and insights about the paper
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                        AI responses with relevant citations
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                        References linked to the PDF content
                    </div>
                </div>
            </div>

            {/* Optional: Subtle call-to-action for the viewer */}
            <div className="mt-6 text-xs text-gray-500 dark:text-gray-500">
                <p>Shared conversations help others understand the paper better</p>
            </div>
        </div>
    );
}
