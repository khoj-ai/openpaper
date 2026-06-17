"use client"

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

export function ZoteroGuideModal({
	open,
	onOpenChange,
	onConnect,
	connecting,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConnect?: () => void;
	connecting?: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>How to connect your Zotero account</DialogTitle>
				</DialogHeader>
				<ol className="space-y-4 text-sm">
					<li className="flex gap-3">
						<span className="font-semibold shrink-0">1.</span>
						<div>
							<p className="font-medium">Log in to your Zotero account on the web</p>
							<p className="text-muted-foreground mt-0.5">
								Go to{" "}
								<a
									href="https://www.zotero.org/user/login"
									target="_blank"
									rel="noopener noreferrer"
									className="underline underline-offset-2 hover:text-foreground"
								>
									zotero.org
								</a>{" "}
								and sign in (or create a free account).
							</p>
						</div>
					</li>
				<li className="flex gap-3">
					<span className="font-semibold shrink-0">2.</span>
					<div className="space-y-2">
						<p className="font-medium">Sync with your Zotero desktop app</p>
						<p className="text-muted-foreground mt-0.5">
							Open the Zotero desktop app and click the sync button (the circular arrow) in the toolbar to make sure your library is up to date.
						</p>
						<img
							src="/zotero-desktop-sync-button.png"
							alt="Zotero sync button location in the toolbar"
							className="border w-full object-cover"
						/>
					</div>
				</li>
					<li className="flex gap-3">
						<span className="font-semibold shrink-0">3.</span>
						<div>
							<p className="font-medium">Click &quot;Connect Zotero&quot; below</p>
							<p className="text-muted-foreground mt-0.5">
								You&apos;ll be redirected to Zotero to authorize Open Paper, then brought back to this page. Open Paper only reads your library — it never changes anything in Zotero.
							</p>
						</div>
					</li>
				</ol>
				<DialogFooter>
					{onConnect ? (
						<>
							<Button variant="outline" onClick={() => onOpenChange(false)} disabled={connecting}>
								Cancel
							</Button>
							<Button onClick={onConnect} disabled={connecting}>
								{connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
								Connect Zotero
							</Button>
						</>
					) : (
						<Button onClick={() => onOpenChange(false)}>Got it</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
