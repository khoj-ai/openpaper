"use client"

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { refreshActivePapers, useActivePapers } from "@/hooks/useActivePapers";
import { isPaperUploadAtLimit, useSubscription } from "@/hooks/useSubscription";
import { fetchFromApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ArrowUpDown, ListFilter, Loader2, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type ZoteroStatus = {
	connected: boolean;
	connected_at?: string;
	last_synced_at?: string;
};

function formatZoteroLastSynced(dateString: string): string {
	const d = new Date(dateString);
	const time = d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" });
	const date = d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	return `${time}, ${date}`;
}

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

type ZoteroLibraryItem = {
	zotero_item_key: string;
	title: string;
	authors: string[];
	date?: string;
	item_type: "journalArticle" | "conferencePaper" | "preprint";
	venue?: string;
	already_imported: boolean;
};

type ZoteroLibraryResponse = {
	items: ZoteroLibraryItem[];
	remaining_slots: number;
};

const ITEM_TYPE_LABELS: Record<ZoteroLibraryItem["item_type"], string> = {
	journalArticle: "Journal",
	conferencePaper: "Conference",
	preprint: "Preprint",
};

function defaultZoteroSelection(
	items: ZoteroLibraryItem[],
	remainingSlots: number,
	selectAllByDefault: boolean,
): Set<string> {
	if (!selectAllByDefault || remainingSlots <= 0) return new Set();
	const keys = items
		.filter((i) => !i.already_imported)
		.slice(0, remainingSlots)
		.map((i) => i.zotero_item_key);
	return new Set(keys);
}

type SortBy = "dateModified" | "datePublished";

function ZoteroLibraryModal({
	open,
	onOpenChange,
	loading,
	items,
	remainingSlots,
	selectedKeys,
	onSelectionChange,
	onImport,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	loading: boolean;
	items: ZoteroLibraryItem[];
	remainingSlots: number;
	selectedKeys: Set<string>;
	onSelectionChange: (keys: Set<string>) => void;
	onImport: (keys: string[]) => void;
}) {
	const [sortBy, setSortBy] = useState<SortBy>("dateModified");
	const [filterTypes, setFilterTypes] = useState<Set<string>>(
		new Set(["journalArticle", "conferencePaper", "preprint"])
	);
	const [searchQuery, setSearchQuery] = useState("");

	const displayItems = useMemo(() => {
		let filtered = items.filter((i) => filterTypes.has(i.item_type));
		if (searchQuery.trim()) {
			const term = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(i) =>
					i.title?.toLowerCase().includes(term) ||
					i.authors?.join(" ").toLowerCase().includes(term)
			);
		}
		if (sortBy === "datePublished") {
			return [...filtered].sort((a, b) => {
				if (!a.date && !b.date) return 0;
				if (!a.date) return 1;
				if (!b.date) return -1;
				return b.date.localeCompare(a.date);
			});
		}
		return filtered;
	}, [items, sortBy, filterTypes, searchQuery]);

	const importable = displayItems.filter((i) => !i.already_imported);
	const selectedCount = selectedKeys.size;
	const slotsRemaining = Math.max(0, remainingSlots - selectedCount);
	const overLimit = selectedCount > remainingSlots;

	const toggleKey = (key: string) => {
		const next = new Set(selectedKeys);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		onSelectionChange(next);
	};

	const selectAll = () => {
		const selectable = importable.slice(0, remainingSlots).map((i) => i.zotero_item_key);
		onSelectionChange(new Set(selectable));
	};

	const deselectAll = () => onSelectionChange(new Set());

	const toggleFilterType = (type: string, checked: boolean) => {
		const next = new Set(filterTypes);
		checked ? next.add(type) : next.delete(type);
		setFilterTypes(next);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Select papers to import</DialogTitle>
				</DialogHeader>

				{loading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						<span className="ml-2 text-sm text-muted-foreground">Loading library…</span>
					</div>
				) : items.length === 0 ? (
					<div className="text-sm text-muted-foreground py-6 text-center space-y-2">
						<p>No importable papers found in your Zotero library.</p>
						<p>
							If your papers are in the Zotero desktop app, remember to sync your local library with your web library.
						</p>
					</div>
				) : (
					<>
					<div className="space-y-2">
						<p className="text-xs text-muted-foreground">
							{importable.length} paper{importable.length === 1 ? "" : "s"} available
							{" · "}
							{slotsRemaining} slot{slotsRemaining === 1 ? "" : "s"} remaining
						</p>
						<div className="relative">
							<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
							<Input
								placeholder="Search by title or author…"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-7 h-8 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
							/>
						</div>
						<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
												<ArrowUpDown className="h-3 w-3" />
												{sortBy === "dateModified" ? "Date modified" : "Date published"}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start">
											<DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
												<DropdownMenuRadioItem value="dateModified">Date modified</DropdownMenuRadioItem>
												<DropdownMenuRadioItem value="datePublished">Date published</DropdownMenuRadioItem>
											</DropdownMenuRadioGroup>
										</DropdownMenuContent>
									</DropdownMenu>

									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
												<ListFilter className="h-3 w-3" />
												{filterTypes.size === 3
													? "All types"
													: `${filterTypes.size} type${filterTypes.size !== 1 ? "s" : ""}`}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start">
											{(["journalArticle", "conferencePaper", "preprint"] as const).map((type) => (
												<DropdownMenuCheckboxItem
													key={type}
													checked={filterTypes.has(type)}
													onCheckedChange={(checked) => toggleFilterType(type, !!checked)}
												>
													{ITEM_TYPE_LABELS[type]}
												</DropdownMenuCheckboxItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								</div>

								<div className="flex gap-3 text-xs text-muted-foreground">
									<button
										type="button"
										className="underline underline-offset-2 hover:text-foreground transition-colors whitespace-nowrap"
										onClick={selectAll}
										disabled={importable.length === 0}
									>
										Select all
									</button>
									<button
										type="button"
										className="underline underline-offset-2 hover:text-foreground transition-colors whitespace-nowrap"
										onClick={deselectAll}
									>
										Deselect all
									</button>
								</div>
							</div>
						</div>

						<ScrollArea className="max-h-[50vh] border rounded-md">
							<ul className="divide-y">
								{displayItems.length === 0 && (
									<li className="px-4 py-8 text-center text-sm text-muted-foreground">
										No papers match your search.
									</li>
								)}
								{displayItems.map((item) => {
									const checked = selectedKeys.has(item.zotero_item_key);
									const disabled = item.already_imported || (!checked && overLimit);
									return (
										<li
											key={item.zotero_item_key}
											className={`flex items-start gap-3 px-4 py-3 ${item.already_imported ? "opacity-50" : ""}`}
										>
											<Checkbox
												id={item.zotero_item_key}
												checked={item.already_imported ? true : checked}
												disabled={disabled || item.already_imported}
												onCheckedChange={() => toggleKey(item.zotero_item_key)}
												className="mt-0.5 shrink-0"
											/>
											<div className="flex-1 min-w-0 space-y-1">
												<label
													htmlFor={item.zotero_item_key}
													className={`text-sm font-medium leading-snug block ${item.already_imported ? "cursor-default" : "cursor-pointer"}`}
												>
													{item.title || "(Untitled)"}
												</label>
												<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
													<Badge variant={item.item_type === "journalArticle" ? "default" : item.item_type === "conferencePaper" ? "secondary" : "outline"} className="text-xs px-1.5 py-0">
														{ITEM_TYPE_LABELS[item.item_type]}
													</Badge>
													{item.date && <span>{item.date.slice(0, 4)}</span>}
													{item.venue && (
														<span className="truncate max-w-[260px]">{item.venue}</span>
													)}
													{item.authors.length > 0 && (
														<span className="truncate max-w-[260px]">
															{item.authors.slice(0, 3).join(", ")}
															{item.authors.length > 3 ? " et al." : ""}
														</span>
													)}
													{item.already_imported && (
														<Badge variant="outline" className="text-xs px-1.5 py-0 text-green-600 border-green-300">
															Imported
														</Badge>
													)}
												</div>
											</div>
										</li>
									);
								})}
							</ul>
						</ScrollArea>
					</>
				)}

				<DialogFooter className="flex-col sm:flex-row items-center gap-2">
					{!loading && overLimit && (
						<p className="text-xs text-destructive flex-1">
							Selection exceeds your remaining {remainingSlots} slot{remainingSlots === 1 ? "" : "s"}.
						</p>
					)}
					{!loading && !overLimit && selectedCount > 0 && (
						<p className="text-xs text-muted-foreground flex-1">
							{selectedCount} paper{selectedCount === 1 ? "" : "s"} selected
						</p>
					)}
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={selectedCount === 0 || overLimit || loading}
						onClick={() => onImport(Array.from(selectedKeys))}
					>
						Import selected ({selectedCount})
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ZoteroGuideModal({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
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
							<p className="font-medium">Click &quot;Connect Zotero&quot; here</p>
							<p className="text-muted-foreground mt-0.5">
								You&apos;ll be redirected to Zotero to authorize Open Paper, then brought back to this page.
							</p>
						</div>
					</li>
				</ol>
				<DialogFooter>
					<Button onClick={() => onOpenChange(false)}>Got it</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SettingsContent() {
	const { user, loading } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [name, setName] = useState("");
	const [isSaving, setIsSaving] = useState(false);

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
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const importDoneRef = useRef(false);

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
			setTimeout(() => setImportProgress(null), 1500);
			await fetchRecentImports();
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

	if (loading || !user) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<>
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
								Link your Zotero library to Open Paper.{" "}
								<button
									type="button"
									onClick={() => setShowZoteroGuide(true)}
									className="underline underline-offset-2 hover:text-foreground transition-colors"
								>
									Show Detailed Guide
								</button>
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
				{showSyncAnnotations && (
					<Button
						type="button"
						variant="outline"
						onClick={handleZoteroSync}
						disabled={zoteroSyncLoading || zoteroImportLoading || zoteroActionLoading}
					>
						{zoteroSyncLoading ? (
							<Loader2 className="h-4 w-4 animate-spin mr-2" />
						) : null}
						Sync Annotations
					</Button>
				)}
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
		<ZoteroGuideModal open={showZoteroGuide} onOpenChange={setShowZoteroGuide} />
		</>
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
