"use client";

import { X, FileText, FolderKanban } from "lucide-react";
import { ScopeItem } from "@/lib/schema";

interface ScopeChipsProps {
    items: ScopeItem[];
    onRemove: (id: string) => void;
}

const SCOPE_ICONS: Record<string, React.ReactNode> = {
    paper: <FileText className="h-3 w-3" />,
    project: <FolderKanban className="h-3 w-3" />,
};

const SCOPE_COLORS: Record<string, string> = {
    paper: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    project: "bg-primary/10 text-primary dark:bg-primary/20 border-primary/20",
};

export function ScopeChips({ items, onRemove }: ScopeChipsProps) {
    if (items.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1.5 mb-2">
            {items.map((item) => (
                <span
                    key={`${item.type}-${item.id}`}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                        SCOPE_COLORS[item.type] || "bg-gray-100 text-gray-800 border-gray-200"
                    }`}
                >
                    {SCOPE_ICONS[item.type] || null}
                    <span className="max-w-[150px] truncate">{item.label}</span>
                    <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        className="ml-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5"
                        aria-label={`Remove ${item.label} from scope`}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
        </div>
    );
}
