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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpDown, Calendar, Folder, ListFilter, Search, Tag } from "lucide-react";
import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { SortBy, ZoteroLibraryItem } from "./types";

const ITEM_TYPE_LABELS: Record<ZoteroLibraryItem["item_type"], string> = {
	journalArticle: "Journal",
	conferencePaper: "Conference",
	preprint: "Preprint",
};

const SORT_LABELS: Record<SortBy, string> = {
	dateModified: "Date modified",
	datePublished: "Date published",
	dateAdded: "Date added",
	title: "Title",
	author: "Author",
};

// Descending date compare with empty values sorted last.
function cmpDateDesc(a?: string, b?: string): number {
	if (!a && !b) return 0;
	if (!a) return 1;
	if (!b) return -1;
	return b.localeCompare(a);
}

export function ZoteroLibraryModal({
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
	const [filterCollections, setFilterCollections] = useState<Set<string>>(new Set());
	const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
	const [filterYears, setFilterYears] = useState<Set<string>>(new Set());
	const [onlyImportable, setOnlyImportable] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");

	const isImportable = (i: ZoteroLibraryItem) =>
		!i.already_imported && i.has_pdf_attachment && i.has_metadata;

	// Distinct collection/tag/year values present in the library, for the filter menus.
	const { allCollections, allTags, allYears } = useMemo(() => {
		const collections = new Set<string>();
		const tags = new Set<string>();
		const years = new Set<string>();
		for (const i of items) {
			i.collections?.forEach((c) => collections.add(c));
			i.tags?.forEach((t) => tags.add(t));
			if (i.date) years.add(i.date.slice(0, 4));
		}
		return {
			allCollections: Array.from(collections).sort((a, b) => a.localeCompare(b)),
			allTags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
			allYears: Array.from(years).sort((a, b) => b.localeCompare(a)),
		};
	}, [items]);

	const displayItems = useMemo(() => {
		let filtered = items.filter((i) => filterTypes.has(i.item_type));
		if (onlyImportable) {
			filtered = filtered.filter(isImportable);
		}
		if (filterCollections.size > 0) {
			filtered = filtered.filter((i) =>
				i.collections?.some((c) => filterCollections.has(c)),
			);
		}
		if (filterTags.size > 0) {
			filtered = filtered.filter((i) => i.tags?.some((t) => filterTags.has(t)));
		}
		if (filterYears.size > 0) {
			filtered = filtered.filter((i) => !!i.date && filterYears.has(i.date.slice(0, 4)));
		}
		if (searchQuery.trim()) {
			const term = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(i) =>
					i.title?.toLowerCase().includes(term) ||
					i.authors?.join(" ").toLowerCase().includes(term)
			);
		}
		if (sortBy === "dateModified") return filtered;
		const sorted = [...filtered];
		if (sortBy === "datePublished") {
			sorted.sort((a, b) => cmpDateDesc(a.date, b.date));
		} else if (sortBy === "dateAdded") {
			sorted.sort((a, b) => cmpDateDesc(a.date_added, b.date_added));
		} else if (sortBy === "title") {
			sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
		} else if (sortBy === "author") {
			sorted.sort((a, b) => (a.authors[0] || "").localeCompare(b.authors[0] || ""));
		}
		return sorted;
	}, [
		items,
		sortBy,
		filterTypes,
		filterCollections,
		filterTags,
		filterYears,
		onlyImportable,
		searchQuery,
	]);

	const importable = displayItems.filter(isImportable);
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

	const toggleInSet = (
		setter: Dispatch<SetStateAction<Set<string>>>,
		value: string,
		checked: boolean,
	) => {
		setter((prev) => {
			const next = new Set(prev);
			checked ? next.add(value) : next.delete(value);
			return next;
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Select papers to import</DialogTitle>
				</DialogHeader>

				{loading ? (
					<div className="space-y-2" aria-busy="true" aria-label="Loading library">
						{/* Mirror the loaded layout: count line, search, toolbar, list. */}
						<Skeleton className="h-4 w-48" />
						<Skeleton className="h-8 w-full" />
						<div className="flex flex-wrap items-center gap-2">
							<Skeleton className="h-7 w-28" />
							<Skeleton className="h-7 w-24" />
							<Skeleton className="h-7 w-28" />
							<Skeleton className="h-7 w-20 ml-auto" />
						</div>
						<div className="border rounded-md divide-y">
							{Array.from({ length: 6 }).map((_, i) => (
								<div key={i} className="flex items-start gap-3 px-4 py-3">
									<Skeleton className="h-4 w-4 mt-0.5 shrink-0 rounded-sm" />
									<div className="flex-1 space-y-2">
										<Skeleton className="h-4 w-3/4" />
										<div className="flex flex-wrap gap-2">
											<Skeleton className="h-3 w-14" />
											<Skeleton className="h-3 w-10" />
											<Skeleton className="h-3 w-32" />
										</div>
									</div>
								</div>
							))}
						</div>
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
						<div className="flex flex-wrap items-center gap-2">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
											<ArrowUpDown className="h-3 w-3" />
											{SORT_LABELS[sortBy]}
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										<DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
											{(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
												<DropdownMenuRadioItem key={key} value={key}>
													{SORT_LABELS[key]}
												</DropdownMenuRadioItem>
											))}
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

								{allCollections.length > 0 && (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
												<Folder className="h-3 w-3" />
												{filterCollections.size === 0
													? "All collections"
													: `${filterCollections.size} collection${filterCollections.size !== 1 ? "s" : ""}`}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
											{allCollections.map((c) => (
												<DropdownMenuCheckboxItem
													key={c}
													checked={filterCollections.has(c)}
													onCheckedChange={(checked) => toggleInSet(setFilterCollections, c, !!checked)}
												>
													{c}
												</DropdownMenuCheckboxItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								)}

								{allTags.length > 0 && (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
												<Tag className="h-3 w-3" />
												{filterTags.size === 0
													? "All tags"
													: `${filterTags.size} tag${filterTags.size !== 1 ? "s" : ""}`}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
											{allTags.map((t) => (
												<DropdownMenuCheckboxItem
													key={t}
													checked={filterTags.has(t)}
													onCheckedChange={(checked) => toggleInSet(setFilterTags, t, !!checked)}
												>
													{t}
												</DropdownMenuCheckboxItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								)}

								{allYears.length > 0 && (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
												<Calendar className="h-3 w-3" />
												{filterYears.size === 0
													? "Any year"
													: `${filterYears.size} year${filterYears.size !== 1 ? "s" : ""}`}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
											{allYears.map((y) => (
												<DropdownMenuCheckboxItem
													key={y}
													checked={filterYears.has(y)}
													onCheckedChange={(checked) => toggleInSet(setFilterYears, y, !!checked)}
												>
													{y}
												</DropdownMenuCheckboxItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								)}

								<label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
									<Checkbox
										checked={onlyImportable}
										onCheckedChange={(c) => setOnlyImportable(!!c)}
										className="h-3.5 w-3.5"
									/>
									Only importable
								</label>

								<div className="flex gap-3 text-xs text-muted-foreground ml-auto">
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
										No papers match your search or filters.
									</li>
								)}
								{displayItems.map((item) => {
									const checked = selectedKeys.has(item.zotero_item_key);
									const noMetadata = !item.already_imported && !item.has_metadata;
									const noPdf =
										!item.already_imported && item.has_metadata && !item.has_pdf_attachment;
									const unselectable = item.already_imported || noMetadata || noPdf;
									const disabled = unselectable || (!checked && overLimit);
									return (
										<li
											key={item.zotero_item_key}
											className={`flex items-start gap-3 px-4 py-3 ${unselectable ? "opacity-50" : ""}`}
										>
											<Checkbox
												id={item.zotero_item_key}
												checked={item.already_imported ? true : checked}
												disabled={disabled}
												onCheckedChange={() => toggleKey(item.zotero_item_key)}
												className="mt-0.5 shrink-0"
											/>
											<div className="flex-1 min-w-0 space-y-1">
												<label
													htmlFor={item.zotero_item_key}
													className={`text-sm font-medium leading-snug block ${unselectable ? "cursor-default" : "cursor-pointer"}`}
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
													{noPdf && (
														<Badge variant="outline" className="text-xs px-1.5 py-0 text-amber-600 border-amber-300">
															No PDF attachment
														</Badge>
													)}
													{noMetadata && (
														<Badge variant="outline" className="text-xs px-1.5 py-0 text-amber-600 border-amber-300">
															Missing metadata
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
