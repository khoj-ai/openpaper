"use client"

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { refreshActivePapers } from "@/hooks/useActivePapers";
import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ZoteroStatus = {
	connected: boolean;
	zotero_user_id?: string;
	connected_at?: string;
};

type ZoteroImportStatusItem = {
	zotero_item_key: string;
	paper_id?: string;
	status: string;
	import_source: string;
	title?: string;
	created_at?: string;
};

type ZoteroImportResponse = {
	imported_count: number;
	imported_via_url: number;
	skipped_already_imported: number;
	errors: { zotero_item_key: string; error: string }[];
	synced_papers_count: number;
	new_annotations_count: number;
	sync_errors: { zotero_item_key: string; error: string }[];
};

function SettingsContent() {
	const { user, loading } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [name, setName] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
	const [zoteroLoading, setZoteroLoading] = useState(true);
	const [zoteroActionLoading, setZoteroActionLoading] = useState(false);
	const [zoteroImportLoading, setZoteroImportLoading] = useState(false);
	const [recentImports, setRecentImports] = useState<ZoteroImportStatusItem[]>([]);
	const [importProgress, setImportProgress] = useState<number | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const importDoneRef = useRef(false);
	const lastRefreshedDoneRef = useRef(0);
	const IMPORT_LIMIT = 50;
	const importTotalRef = useRef(0);

	const fetchZoteroStatus = useCallback(async () => {
		setZoteroLoading(true);
		try {
			const data = await fetchFromApi("/api/auth/zotero/status");
			setZoteroStatus(data);
		} catch (error) {
			console.error("Failed to fetch Zotero status:", error);
			setZoteroStatus({ connected: false });
		} finally {
			setZoteroLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!loading && !user) {
			router.push("/login?returnTo=/settings");
		}
	}, [user, loading, router]);

	useEffect(() => {
		if (user?.name) {
			setName(user.name);
		}
	}, [user?.name]);

	const fetchRecentImports = useCallback(async () => {
		try {
			const data = await fetchFromApi("/api/zotero/import/status");
			setRecentImports(data.items ?? []);
		} catch {
			setRecentImports([]);
		}
	}, []);

	useEffect(() => {
		if (user) {
			fetchZoteroStatus();
		}
	}, [user, fetchZoteroStatus]);

	useEffect(() => {
		if (user && zoteroStatus?.connected) {
			fetchRecentImports();
		}
	}, [user, zoteroStatus?.connected, fetchRecentImports]);

	useEffect(() => {
		const zoteroParam = searchParams.get("zotero");
		if (!zoteroParam) return;

		if (zoteroParam === "connected") {
			toast.success("Zotero connected.");
			fetchZoteroStatus();
		} else if (zoteroParam === "error") {
			toast.error("Failed to connect Zotero.");
		}

		router.replace("/settings");
	}, [searchParams, router, fetchZoteroStatus]);

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			toast.error("Name cannot be empty.");
			return;
		}

		setIsSaving(true);
		try {
			const data = await fetchFromApi("/api/auth/profile", {
				method: "PATCH",
				body: JSON.stringify({ name: trimmed }),
			});
			if (data.success) {
				toast.success("Profile updated.");
				window.location.reload();
			} else {
				toast.error(data.message || "Failed to update profile.");
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to update profile.");
		} finally {
			setIsSaving(false);
		}
	};

	const handleZoteroConnect = async () => {
		setZoteroActionLoading(true);
		try {
			const data = await fetchFromApi("/api/auth/zotero/connect");
			if (data.auth_url) {
				window.location.href = data.auth_url;
			} else {
				toast.error("Failed to start Zotero connection.");
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to start Zotero connection."
			);
		} finally {
			setZoteroActionLoading(false);
		}
	};

	const handleZoteroImport = async () => {
		setZoteroImportLoading(true);
		setImportProgress(0);

		const knownPaperIds = new Set(recentImports.map((r) => r.paper_id).filter(Boolean));
		importDoneRef.current = false;
		lastRefreshedDoneRef.current = 0;
		importTotalRef.current = 0;

		pollRef.current = setInterval(async () => {
			try {
				const data = await fetchFromApi("/api/zotero/import/status");
				// guard: discard stale poll responses that arrive after POST completed
				if (importDoneRef.current) return;
				const items: ZoteroImportStatusItem[] = data.items ?? [];
				const newItems = items.filter((i) => !knownPaperIds.has(i.paper_id ?? ""));
				// Grow the total as more items appear; never shrink it
				if (newItems.length > importTotalRef.current) {
					importTotalRef.current = newItems.length;
				}
				const done = newItems.filter(
					(i) => i.status === "completed" || i.status === "failed",
				).length;
				const total = importTotalRef.current || IMPORT_LIMIT;
				setImportProgress(Math.min((done / total) * 100, 99));
				if (done > lastRefreshedDoneRef.current) {
					lastRefreshedDoneRef.current = done;
					refreshActivePapers();
				}
			} catch {
				// ignore poll errors
			}
		}, 1500);

		try {
			const data: ZoteroImportResponse = await fetchFromApi("/api/zotero/import-and-sync", {
				method: "POST",
				body: JSON.stringify({ limit: IMPORT_LIMIT }),
			});
			// mark done BEFORE setImportProgress(100) so in-flight poll callbacks are discarded
			importDoneRef.current = true;
			if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
			const parts: string[] = [];
			if (data.imported_count > 0) {
				parts.push(`Imported ${data.imported_count} paper${data.imported_count === 1 ? "" : "s"}`);
			}
			if (data.synced_papers_count > 0) {
				const syncPart = `synced ${data.synced_papers_count} paper${data.synced_papers_count === 1 ? "" : "s"}`;
				if (data.new_annotations_count > 0) {
					parts.push(
						`${syncPart} with ${data.new_annotations_count} new highlight${data.new_annotations_count === 1 ? "" : "s"}`,
					);
				} else {
					parts.push(syncPart);
				}
			}
			if (data.skipped_already_imported > 0) {
				parts.push(`${data.skipped_already_imported} already imported`);
			}
			const errorCount = (data.errors?.length ?? 0) + (data.sync_errors?.length ?? 0);
			if (errorCount > 0) {
				parts.push(`${errorCount} failed`);
			}
			if (data.imported_count > 0) {
				toast.success(parts.join("; ") + ". Processing may take a minute per paper.");
			} else if (errorCount > 0 && data.synced_papers_count === 0) {
				toast.error(parts.join("; ") || "Import and sync failed.");
			} else if (parts.length > 0) {
				toast.success(parts.join("; ") + ".");
			} else {
				toast.info("No new papers or highlights to sync.");
			}
			setImportProgress(100);
			await fetchRecentImports();
			await refreshActivePapers();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import from Zotero."
			);
		} finally {
			// interval already cleared in try; guard against error-path where it wasn't
			if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
			importDoneRef.current = true;
			setZoteroImportLoading(false);
			setTimeout(() => setImportProgress(null), 1500);
		}
	};

	const handleZoteroDisconnect = async () => {
		setZoteroActionLoading(true);
		try {
			const data = await fetchFromApi("/api/auth/zotero/disconnect", {
				method: "DELETE",
			});
			if (data.success) {
				toast.success("Zotero disconnected.");
				await fetchZoteroStatus();
			} else {
				toast.error(data.message || "Failed to disconnect Zotero.");
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to disconnect Zotero."
			);
		} finally {
			setZoteroActionLoading(false);
		}
	};

	if (loading || !user) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const recentImportedPapers = recentImports.filter((item) => {
		if (!item.title && !item.paper_id) return false;
		if (!item.paper_id) return true;
		const firstIndex = recentImports.findIndex((i) => i.paper_id === item.paper_id);
		return recentImports.indexOf(item) === firstIndex;
	});

	return (
		<div className="max-w-2xl p-6 space-y-6">
			<h1 className="text-2xl font-bold">Settings</h1>

			<div className="space-y-1">
				<h2 className="text-lg font-medium">Profile</h2>
				<p className="text-sm text-muted-foreground">Manage your account details.</p>
			</div>
			<form onSubmit={handleSave} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Your name"
						disabled={isSaving}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						value={user.email}
						disabled
						className="bg-muted"
					/>
				</div>
				<Button type="submit" disabled={isSaving || !name.trim()}>
					{isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
					Save
				</Button>
			</form>

			<Separator />

			<div className="space-y-4">
				<div className="space-y-1">
					<h2 className="text-lg font-medium">Integrations</h2>
					<p className="text-sm text-muted-foreground">
						Connect external services to your account.
					</p>
				</div>

				<div id="zotero" className="rounded-lg border p-4 space-y-3 scroll-mt-6">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-1">
							<p className="font-medium">Zotero</p>
							{!zoteroLoading && zoteroStatus?.connected && zoteroStatus.zotero_user_id && (
								<p className="text-sm text-muted-foreground">
									Zotero user ID: {zoteroStatus.zotero_user_id}
								</p>
							)}
							{!zoteroLoading && !zoteroStatus?.connected && (
								<p className="text-sm text-muted-foreground">
									Link your Zotero library to Open Paper.
								</p>
							)}
						</div>
						{zoteroLoading ? (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
						) : zoteroStatus?.connected ? (
							<Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400">
							Connected
						</Badge>
						) : null}
					</div>

					{zoteroLoading ? (
						<p className="text-sm text-muted-foreground">Checking connection…</p>
					) : zoteroStatus?.connected ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								Imports up to 50 journal articles, conference papers, and preprints from Zotero,
								then syncs new PDF highlights from Zotero into papers you have already imported. 
								Books and web pages are skipped.
							</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								onClick={handleZoteroImport}
								disabled={zoteroImportLoading || zoteroActionLoading}
							>
								{zoteroImportLoading ? (
									<Loader2 className="h-4 w-4 animate-spin mr-2" />
								) : null}
								Import & sync
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={handleZoteroDisconnect}
								disabled={zoteroActionLoading || zoteroImportLoading}
							>
								{zoteroActionLoading ? (
									<Loader2 className="h-4 w-4 animate-spin mr-2" />
								) : null}
								Disconnect
							</Button>
						</div>
						{importProgress !== null && (
							<div className="space-y-1">
								<p className="text-xs text-muted-foreground">
									{importProgress < 100 ? "Importing…" : "Import complete"}
								</p>
								<Progress value={importProgress} />
							</div>
						)}
							{recentImportedPapers.length > 0 && (
								<div className="space-y-1 pt-2 border-t">
									<p className="text-xs font-medium text-muted-foreground">Recent imports</p>
									<ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
									{recentImportedPapers.slice(0, 5).map((item) => (
										<li key={item.zotero_item_key}>
											{item.title
												?? `paper ${item.paper_id!.slice(0, 8)}…`}
										</li>
									))}
									</ul>
								</div>
							)}
						</div>
					) : (
						<Button
							type="button"
							onClick={handleZoteroConnect}
							disabled={zoteroActionLoading}
						>
							{zoteroActionLoading ? (
								<Loader2 className="h-4 w-4 animate-spin mr-2" />
							) : null}
							Connect Zotero
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

export default function SettingsPage() {
	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center h-full">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</div>
			}
		>
			<SettingsContent />
		</Suspense>
	);
}
