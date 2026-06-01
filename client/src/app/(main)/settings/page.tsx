"use client"

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { refreshActivePapers } from "@/hooks/useActivePapers";
import { isPaperUploadAtLimit, useSubscription } from "@/hooks/useSubscription";
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
};

function SettingsContent() {
	const { user, loading } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [name, setName] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	const { subscription, refetch: refetchSubscription } = useSubscription();
	const atPaperLimit = isPaperUploadAtLimit(subscription);
	const paperUploadsRemaining = subscription?.usage?.paper_uploads_remaining ?? null;
	const paperUploadsTotal = subscription?.limits?.paper_uploads ?? null;
	const paperUploadsUsed = subscription?.usage?.paper_uploads ?? null;
	const zoteroImportLimit = Math.min(50, paperUploadsRemaining ?? 50);

	const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
	const [zoteroLoading, setZoteroLoading] = useState(true);
	const [zoteroActionLoading, setZoteroActionLoading] = useState(false);
	const [zoteroImportLoading, setZoteroImportLoading] = useState(false);
	const [recentImports, setRecentImports] = useState<ZoteroImportStatusItem[]>([]);
	const [recentImportsLoaded, setRecentImportsLoaded] = useState(false);
	const [importProgress, setImportProgress] = useState<number | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const importDoneRef = useRef(false);

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
		} finally {
			setRecentImportsLoaded(true);
		}
	}, []);

	useEffect(() => {
		if (user) {
			fetchZoteroStatus();
		}
	}, [user, fetchZoteroStatus]);

	useEffect(() => {
		if (user && zoteroStatus?.connected) {
			setRecentImportsLoaded(false);
			fetchRecentImports();
		} else if (user && zoteroStatus && !zoteroStatus.connected) {
			setRecentImports([]);
			setRecentImportsLoaded(false);
		}
	}, [user, zoteroStatus?.connected, zoteroStatus, fetchRecentImports]);

	useEffect(() => {
		const zoteroParam = searchParams.get("zotero");
		if (!zoteroParam) return;

		if (zoteroParam === "connected") {
			toast.success("Zotero connected.");
			setRecentImports([]);
			setRecentImportsLoaded(false);
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

		importDoneRef.current = false;

		const finishImport = () => {
			if (importDoneRef.current) return;
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			importDoneRef.current = true;
			setZoteroImportLoading(false);
			setImportProgress(100);
			setTimeout(() => setImportProgress(null), 1500);
		};

		const pollImportStatus = async () => {
			if (importDoneRef.current) return;
			try {
				const data = await fetchFromApi("/api/zotero/import/status");
				if (importDoneRef.current) return;
				const items: ZoteroImportStatusItem[] = data.items ?? [];
				setRecentImports(items);
				setRecentImportsLoaded(true);
			} catch {
				// ignore poll errors
			}
		};

		pollRef.current = setInterval(pollImportStatus, 1500);

		try {
			const data: ZoteroImportResponse = await fetchFromApi("/api/zotero/import", {
				method: "POST",
				body: JSON.stringify({ limit: zoteroImportLimit }),
			});
			const parts: string[] = [];
			if (data.imported_count > 0) {
				parts.push(`Imported ${data.imported_count} paper${data.imported_count === 1 ? "" : "s"}`);
			}
			if (data.skipped_already_imported > 0) {
				parts.push(`${data.skipped_already_imported} already imported`);
			}
			const errorCount = data.errors?.length ?? 0;
			if (errorCount > 0) {
				parts.push(`${errorCount} failed`);
			}
			if (data.imported_count > 0) {
				toast.success(parts.join("; ") + ". Processing may take a minute per paper.");
			} else if (errorCount > 0) {
				toast.error(parts.join("; ") || "Import failed.");
			} else if (parts.length > 0) {
				toast.success(parts.join("; ") + ".");
			} else {
				toast.info("No new papers to import.");
			}
			finishImport();
			await refreshActivePapers();
			await refetchSubscription();
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Failed to import from Zotero.";
			if (msg.includes("Upload limit") || msg.includes("paper upload limit")) {
				toast.warning(msg);
			} else {
				toast.error(msg);
			}
			finishImport();
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
				setRecentImports([]);
				setRecentImportsLoaded(false);
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
						Import journal articles, conference papers, and preprints from Zotero (books and web pages are skipped).
						New PDF annotations are synced automatically every 24 hours.
					</p>
						{paperUploadsRemaining !== null && paperUploadsTotal !== null && paperUploadsUsed !== null && (
							<p className="text-xs text-muted-foreground">
								{atPaperLimit
									? `Paper limit reached (${paperUploadsUsed}/${paperUploadsTotal}). Delete papers or upgrade to import more.`
									: `You can import up to ${paperUploadsRemaining} more paper${paperUploadsRemaining === 1 ? "" : "s"} (${paperUploadsUsed}/${paperUploadsTotal} used).`}
							</p>
						)}
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={handleZoteroImport}
						disabled={zoteroImportLoading || zoteroActionLoading || atPaperLimit}
					>
						{zoteroImportLoading ? (
							<Loader2 className="h-4 w-4 animate-spin mr-2" />
						) : null}
						Import
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
