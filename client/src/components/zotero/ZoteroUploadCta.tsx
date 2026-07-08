"use client"

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked, X } from "lucide-react";
import { fetchFromApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ZoteroStatus } from "./types";

const DISMISSED_KEY = "zoteroUploadHintDismissed";

interface ZoteroUploadCtaProps {
	className?: string;
}

// Discoverability affordance for the Zotero integration, shown beneath the
// dropzone in the upload surfaces. Unconnected users get a dismissible hint;
// connected users get a pointer to where import/sync is managed.
export function ZoteroUploadCta({ className }: ZoteroUploadCtaProps) {
	const [status, setStatus] = useState<ZoteroStatus | null>(null);
	const [dismissed, setDismissed] = useState(() => {
		try {
			return typeof window !== "undefined" && localStorage.getItem(DISMISSED_KEY) === "true";
		} catch {
			return false;
		}
	});

	useEffect(() => {
		let cancelled = false;
		fetchFromApi("/api/auth/zotero/status")
			.then((data: ZoteroStatus) => {
				if (!cancelled) setStatus(data);
			})
			.catch(() => {
				// Purely promotional surface — stay hidden if status is unavailable.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleDismiss = () => {
		setDismissed(true);
		try {
			localStorage.setItem(DISMISSED_KEY, "true");
		} catch {
			// Session-only dismissal is fine if storage is unavailable.
		}
	};

	if (!status) return null;

	if (status.connected) {
		return (
			<p className={cn("flex items-center justify-center gap-2 text-xs text-muted-foreground", className)}>
				<BookMarked className="h-3.5 w-3.5" aria-hidden />
				<span>
					Zotero connected.{" "}
					<Link href="/settings#zotero" className="underline underline-offset-2 hover:text-foreground transition-colors">
						Import and manage syncing in Settings
					</Link>
				</span>
			</p>
		);
	}

	if (dismissed) return null;

	return (
		<div
			className={cn(
				"flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-700 dark:text-blue-300",
				className,
			)}
		>
			<BookMarked className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
			<p className="flex-1">
				Use Zotero? You can{" "}
				<Link href="/settings#zotero" className="font-medium underline underline-offset-2">
					connect your library
				</Link>{" "}
				to import papers and keep them in sync.
			</p>
			<button
				type="button"
				onClick={handleDismiss}
				aria-label="Dismiss Zotero hint"
				className="rounded-sm p-0.5 text-blue-700/70 dark:text-blue-300/70 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}
