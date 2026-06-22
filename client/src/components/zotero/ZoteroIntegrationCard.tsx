"use client"

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { refreshActivePapers, useActivePapers } from "@/hooks/useActivePapers";
import { isPaperUploadAtLimit, useSubscription } from "@/hooks/useSubscription";
import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ZoteroGuideModal } from "./ZoteroGuideModal";
import { ZoteroLibraryModal } from "./ZoteroLibraryModal";
import {
	ZoteroImportResponse,
	ZoteroImportStatusItem,
	ZoteroLibraryItem,
	ZoteroLibraryResponse,
	ZoteroStatus,
} from "./types";
import {
	computeImportProgress,
	defaultZoteroSelection,
	formatZoteroLastSynced,
} from "./utils";

export function ZoteroIntegrationCard() {
	const { user } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();

	const { subscription, refetch: refetchSubscription } = useSubscription();
	const { papers } = useActivePapers();
	const atPaperLimit = isPaperUploadAtLimit(subscription);
	const paperUploadsRemaining = subscription?.usage?.paper_uploads_remaining ?? null;
	const paperUploadsTotal = subscription?.limits?.paper_uploads ?? null;
	const paperUploadsUsed = subscription?.usage?.paper_uploads ?? null;
	const hasAutoSync = subscription?.plan === "researcher";
	const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
	const [zoteroLoading, setZoteroLoading] = useState(true);
	const [zoteroActionLoading, setZoteroActionLoading] = useState(false);
	const [zoteroImportLoading, setZoteroImportLoading] = useState(false);
	const [zoteroSyncLoading, setZoteroSyncLoading] = useState(false);
	const [recentImports, setRecentImports] = useState<ZoteroImportStatusItem[]>([]);
	const [recentImportsLoaded, setRecentImportsLoaded] = useState(false);
	const [importProgress, setImportProgress] = useState<number | null>(null);
	const [importTotal, setImportTotal] = useState<number | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const importDoneRef = useRef(false);
	const importingKeysRef = useRef<Set<string>>(new Set());

	const [showZoteroGuide, setShowZoteroGuide] = useState(false);
	const [showLibraryModal, setShowLibraryModal] = useState(false);
	const [libraryLoading, setLibraryLoading] = useState(false);
	const [libraryItems, setLibraryItems] = useState<ZoteroLibraryItem[]>([]);
	const [libraryRemainingSlots, setLibraryRemainingSlots] = useState(0);
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

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
		refetchSubscription();
	}, [papers.length, refetchSubscription]);

	useEffect(() => {
		if (user) refetchSubscription();
	}, [user?.id, refetchSubscription]);

	useEffect(() => {
		if (user && zoteroStatus?.connected) {
			setRecentImportsLoaded(false);
			fetchRecentImports();
		} else if (user && zoteroStatus && !zoteroStatus.connected) {
			setRecentImports([]);
			setRecentImportsLoaded(false);
		}
	}, [user, zoteroStatus?.connected, zoteroStatus, fetchRecentImports]);

	const hasSyncableImports = useMemo(
		() =>
			recentImports.some(
				(i) =>
					i.status === "completed" &&
					i.paper_id &&
					i.import_source === "pdf_attachment"
			),
		[recentImports]
	);

	const showSyncAnnotations = recentImportsLoaded && hasSyncableImports;

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

	const handleOpenLibraryModal = async () => {
		setLibraryLoading(true);
		setShowLibraryModal(true);
		try {
			const data: ZoteroLibraryResponse = await fetchFromApi("/api/zotero/library");
			const items = data.items ?? [];
			const remainingSlots = data.remaining_slots ?? 0;
			setLibraryItems(items);
			setLibraryRemainingSlots(remainingSlots);
			setSelectedKeys(
				defaultZoteroSelection(items, remainingSlots, hasAutoSync)
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to load Zotero library.");
			setShowLibraryModal(false);
		} finally {
			setLibraryLoading(false);
		}
	};

	const handleZoteroImport = async (keysToImport: string[]) => {
		setShowLibraryModal(false);
		setZoteroImportLoading(true);
		importingKeysRef.current = new Set(keysToImport);
		setImportTotal(keysToImport.length);
		setImportProgress(0);

		importDoneRef.current = false;

		const finishImport = async () => {
			if (importDoneRef.current) return;
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			importDoneRef.current = true;
			setZoteroImportLoading(false);
			setImportProgress(100);
			setTimeout(() => {
				setImportProgress(null);
				setImportTotal(null);
				importingKeysRef.current = new Set();
			}, 1500);
			await fetchRecentImports();
		};

		const statusQuery = keysToImport
			.map((k) => `item_keys=${encodeURIComponent(k)}`)
			.join("&");

		const pollImportStatus = async () => {
			if (importDoneRef.current) return;
			try {
				const data = await fetchFromApi(
					`/api/zotero/import/status?${statusQuery}`,
				);
				if (importDoneRef.current) return;
				const items: ZoteroImportStatusItem[] = data.items ?? [];
				setRecentImports(items);
				setRecentImportsLoaded(true);
				const { progress } = computeImportProgress(
					items,
					importingKeysRef.current,
					keysToImport.length,
				);
				setImportProgress(progress);
			} catch {
				// ignore poll errors
			}
		};

		pollRef.current = setInterval(pollImportStatus, 1500);
		void pollImportStatus();

		try {
			const data: ZoteroImportResponse = await fetchFromApi("/api/zotero/import", {
				method: "POST",
				body: JSON.stringify({ item_keys: keysToImport }),
			});
			const parts: string[] = [];
			if (data.imported_count > 0) {
				parts.push(`Imported ${data.imported_count} paper${data.imported_count === 1 ? "" : "s"}`);
			}
			if (data.skipped_already_imported > 0) {
				parts.push(`${data.skipped_already_imported} already imported`);
			}
		const errorCount = data.errors?.length ?? 0;
		const hasDetailToast = errorCount > 0 && !!data.errors?.length;
		if (errorCount > 0 && !hasDetailToast) {
			parts.push(`${errorCount} failed`);
		}
		if (data.imported_count > 0) {
			toast.success(parts.join("; ") + ". Processing may take a minute per paper.");
		} else if (errorCount > 0 && !hasDetailToast) {
			toast.error(parts.join("; ") || "Import failed.");
		} else if (parts.length > 0) {
			toast.success(parts.join("; ") + ".");
		} else if (!hasDetailToast) {
			toast.info("No new papers to import.");
		}
		if (hasDetailToast) {
			const keyToTitle = new Map(libraryItems.map((i) => [i.zotero_item_key, i.title]));
			toast.error("", {
				description: (
					<ul className="mt-1 space-y-2 list-none">
						{data.errors.map((e) => (
							<li key={e.zotero_item_key}>
								<span className="font-medium block">
									{keyToTitle.get(e.zotero_item_key) ?? e.zotero_item_key}
								</span>
								<span className="block text-xs mt-0.5 opacity-75">{e.error}</span>
							</li>
						))}
					</ul>
				),
				duration: 15000,
			});
		}
			await finishImport();
			await refreshActivePapers();
			await refetchSubscription();
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Failed to import from Zotero.";
			if (msg.includes("Upload limit") || msg.includes("paper upload limit")) {
				toast.warning(msg);
			} else {
				toast.error(msg);
			}
			await finishImport();
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

	const handleZoteroSync = async () => {
		setZoteroSyncLoading(true);
		try {
			const data = await fetchFromApi("/api/zotero/sync", { method: "POST" });
			if (data.new_annotations_count > 0) {
				toast.success(
					`Synced ${data.new_annotations_count} new annotation${data.new_annotations_count === 1 ? "" : "s"} across ${data.synced_papers_count} paper${data.synced_papers_count === 1 ? "" : "s"}.`
				);
			} else {
				toast.success("Annotations are already up to date.");
			}
			await fetchZoteroStatus();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to sync Zotero annotations."
			);
		} finally {
			setZoteroSyncLoading(false);
		}
	};

	return (
		<>
				<div id="zotero" className="rounded-lg border p-4 space-y-3 scroll-mt-6">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-1">
							<img
								src="/logos/zotero_logo.svg"
								alt="Zotero"
								className="h-5 w-auto dark:brightness-0 dark:invert"
							/>
							{!zoteroLoading && zoteroStatus?.connected && (
								<p className="text-sm text-muted-foreground">
									Last synced:{" "}
									{zoteroStatus.last_synced_at
										? formatZoteroLastSynced(zoteroStatus.last_synced_at)
										: "Not yet"}
								</p>
							)}
						{!zoteroLoading && !zoteroStatus?.connected && (
							<p className="text-sm text-muted-foreground">
								Link your Zotero library to Open Paper.
							</p>
						)}
						{!zoteroLoading && (
							<p className="text-sm text-muted-foreground">
								<button
									type="button"
									onClick={() => setShowZoteroGuide(true)}
									className="underline underline-offset-2 hover:text-foreground transition-colors"
								>
									Instructions and troubleshooting
								</button>
							</p>
						)}
						</div>
						{zoteroLoading ? (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
						) : zoteroStatus?.connected ? (
							<div className="flex items-center gap-2 shrink-0">
								{showSyncAnnotations && (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={handleZoteroSync}
										disabled={zoteroSyncLoading || zoteroImportLoading || zoteroActionLoading}
										title="Sync annotations"
										aria-label="Sync annotations"
									>
										<RefreshCw className={`h-4 w-4 ${zoteroSyncLoading ? "animate-spin" : ""}`} />
									</Button>
								)}
								<Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400">
									Connected
								</Badge>
							</div>
						) : null}
					</div>

				{zoteroLoading ? (
					<p className="text-sm text-muted-foreground">Checking connection…</p>
				) : zoteroStatus?.connected ? (
				<div className="space-y-3">
				<p className="text-sm text-muted-foreground">
					Import journal articles, conference papers, and preprints from Zotero.{" "}
					{hasAutoSync
						? "New PDF annotations and new papers are synced automatically every 24 hours."
						: <>Annotation sync is manual on the Basic plan. <a href="/pricing" className="underline underline-offset-2 hover:text-foreground transition-colors">Upgrade to Researcher</a> for automatic 24-hour sync.</>
					}
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
					onClick={handleOpenLibraryModal}
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
					{importProgress !== null && importTotal !== null && (
						<Progress value={importProgress} />
					)}
					</div>
					) : (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								Open Paper pulls journal articles, conference papers, and preprints
								(with PDF attachments) from your Zotero library so you can read and
								annotate them here.
							</p>
							<p className="text-sm text-muted-foreground">
								It&apos;s a{" "}
								<span className="font-medium text-foreground">one-way sync</span>:
								Open Paper only reads from Zotero to bring papers in — it never edits
								or deletes anything in your Zotero library.
							</p>
							<Button
								type="button"
								onClick={() => setShowZoteroGuide(true)}
								disabled={zoteroActionLoading}
							>
								{zoteroActionLoading ? (
									<Loader2 className="h-4 w-4 animate-spin mr-2" />
								) : null}
								Connect Zotero
							</Button>
						</div>
					)}
				</div>
		<ZoteroLibraryModal
			open={showLibraryModal}
			onOpenChange={setShowLibraryModal}
			loading={libraryLoading}
			items={libraryItems}
			remainingSlots={libraryRemainingSlots}
			selectedKeys={selectedKeys}
			onSelectionChange={setSelectedKeys}
			onImport={handleZoteroImport}
		/>
		<ZoteroGuideModal
			open={showZoteroGuide}
			onOpenChange={setShowZoteroGuide}
			onConnect={zoteroStatus?.connected ? undefined : handleZoteroConnect}
			connecting={zoteroActionLoading}
		/>
		</>
	);
}
