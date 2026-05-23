"use client"

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Suspense, useCallback, useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

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

	const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
	const [zoteroLoading, setZoteroLoading] = useState(true);
	const [zoteroActionLoading, setZoteroActionLoading] = useState(false);
	const [zoteroImportLoading, setZoteroImportLoading] = useState(false);
	const [recentImports, setRecentImports] = useState<ZoteroImportStatusItem[]>([]);

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
		try {
			const data: ZoteroImportResponse = await fetchFromApi("/api/zotero/import", {
				method: "POST",
				body: JSON.stringify({ limit: 5 }),
			});
			const parts: string[] = [];
			if (data.imported_count > 0) {
				parts.push(`Imported ${data.imported_count} paper${data.imported_count === 1 ? "" : "s"}`);
			}
			if (data.skipped_already_imported > 0) {
				parts.push(`${data.skipped_already_imported} already imported`);
			}
			if (data.errors?.length > 0) {
				parts.push(`${data.errors.length} failed`);
			}
			if (data.imported_count > 0) {
				toast.success(parts.join("; ") + ". Processing may take a minute per paper.");
			} else if (data.errors?.length > 0) {
				toast.error(parts.join("; ") || "Import failed.");
			} else {
				toast.info("No new journal articles to import.");
			}
			await fetchRecentImports();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import from Zotero."
			);
		} finally {
			setZoteroImportLoading(false);
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

				<div className="rounded-lg border p-4 space-y-3">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-1">
							<p className="font-medium">Zotero</p>
							<p className="text-sm text-muted-foreground">
								Link your Zotero library to Open Paper.
							</p>
						</div>
						{zoteroLoading ? (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
						) : zoteroStatus?.connected ? (
							<Badge variant="secondary">Connected</Badge>
						) : null}
					</div>

					{zoteroLoading ? (
						<p className="text-sm text-muted-foreground">Checking connection…</p>
					) : zoteroStatus?.connected ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								Imports up to 5 journal articles from Zotero (PDF from library, or from item URL if no PDF).
								Highlights import when stored on a Zotero PDF. Books and web pages are skipped.
							</p>
							{zoteroStatus.zotero_user_id && (
								<p className="text-sm text-muted-foreground">
									Zotero user ID: {zoteroStatus.zotero_user_id}
								</p>
							)}
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									onClick={handleZoteroImport}
									disabled={zoteroImportLoading || zoteroActionLoading}
								>
									{zoteroImportLoading ? (
										<Loader2 className="h-4 w-4 animate-spin mr-2" />
									) : null}
									Import from Zotero
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
							{recentImports.length > 0 && (
								<div className="space-y-1 pt-2 border-t">
									<p className="text-xs font-medium text-muted-foreground">Recent imports</p>
									<ul className="text-xs text-muted-foreground space-y-1">
										{recentImports.slice(0, 5).map((item) => (
											<li key={item.zotero_item_key}>
												{item.status} · {item.import_source}
												{item.paper_id ? ` · paper ${item.paper_id.slice(0, 8)}…` : ""}
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
