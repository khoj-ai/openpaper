"use client";

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fetchFromApi } from "@/lib/api";
import { PaperItem } from "@/lib/schema";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useSidebar } from "./ui/sidebar";
import {
	Sheet,
	SheetContent,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowUpDown, CheckCheck, Trash2, X, ChevronDown, Tag } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { PaperPreview } from "./PaperPreview";
import { PaperFiltering, Filter, Sort } from "@/components/PaperFiltering";
import { Badge } from "@/components/ui/badge";
import { TagSelector } from "./TagSelector";
import { toast } from "sonner";
import { usePapers } from "@/hooks/usePapers";


interface LibraryTableProps extends React.HTMLAttributes<HTMLDivElement> {
	selectable?: boolean;
	onSelectFiles?: (papers: PaperItem[], action: string) => void;
	actionOptions?: string[];
	projectPaperIds?: string[];
	handleDelete?: (paperId: string) => Promise<void>;
	setPapers?: (papers: PaperItem[]) => void;
	onUploadClick?: () => void;
	maxHeight?: string;
}

export function LibraryTable({
	selectable: selectableProp,
	onSelectFiles,
	actionOptions = [],
	projectPaperIds = [],
	handleDelete,
	onUploadClick,
	maxHeight = 'calc(100vh - 16rem)',
	...props
}: LibraryTableProps) {
	const selectable = selectableProp ?? (onSelectFiles ? true : false);
	const { papers, error: papersFetchError, isLoading, mutate } = usePapers();
	const { state: sidebarState } = useSidebar();
	const isMobile = useIsMobile();
	const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set());
	const [searchTerm, setSearchTerm] = useState('');
	const [filters, setFilters] = useState<Filter[]>([]);
	type SortKey = keyof PaperItem;
	const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'ascending' | 'descending' } | null>({ key: 'created_at', direction: 'descending' });
	const [selectedPaperForPreview, setSelectedPaperForPreview] = useState<PaperItem | null>(null);
	const [taggingPopoverOpen, setTaggingPopoverOpen] = useState(false);
	const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
	const tableContainerRef = useRef<HTMLDivElement>(null);

	const sort: Sort = { type: "publish_date", order: "desc" };

	const setPaper = (paperId: string, updatedPaper: PaperItem) => {
		mutate(
			(currentPapers: PaperItem[] | undefined) => {
				if (!currentPapers) return [];
				return currentPapers.map(p => (p.id === paperId ? updatedPaper : p));
			},
			{ revalidate: false }
		);

		if (selectedPaperForPreview && selectedPaperForPreview.id === paperId) {
			setSelectedPaperForPreview(updatedPaper);
		}
	};

	const processedPapers = useMemo(() => {
		let filteredPapers = [...(papers || [])];

		if (searchTerm) {
			filteredPapers = filteredPapers.filter(paper => {
				const term = searchTerm.toLowerCase();
				return (
					paper.title?.toLowerCase().includes(term) ||
					paper.authors?.join(', ').toLowerCase().includes(term) ||
					paper.institutions?.join(', ').toLowerCase().includes(term) ||
					paper.keywords?.join(', ').toLowerCase().includes(term)
				);
			});
		}

		if (filters.length > 0) {
			filteredPapers = filteredPapers.filter(paper => {
				return filters.every(filter => {
					if (filter.type === 'author') {
						return paper.authors?.includes(filter.value);
					}
					if (filter.type === 'keyword') {
						return paper.keywords?.includes(filter.value);
					}
					if (filter.type === 'tag') {
						return paper.tags?.some(t => t.name === filter.value);
					}
					if (filter.type === 'status') {
						return paper.status === filter.value;
					}
					return true;
				});
			});
		}

		if (sortConfig !== null) {
			filteredPapers.sort((a, b) => {
				const key = sortConfig.key;
				const aVal = a[key];
				const bVal = b[key];

				if (aVal === undefined || aVal === null) return 1;
				if (bVal === undefined || bVal === null) return -1;

				let comparison = 0;
				if (key === 'created_at' || key === 'publish_date') {
					comparison = new Date(aVal as string).getTime() - new Date(bVal as string).getTime();
				} else if (key === 'tags') {
					const aTags = (aVal as { name: string }[]).map(t => t.name).join(', ');
					const bTags = (bVal as { name: string }[]).map(t => t.name).join(', ');
					comparison = aTags.localeCompare(bTags);
				} else if (Array.isArray(aVal) && Array.isArray(bVal)) {
					comparison = aVal.join(', ').localeCompare(bVal.join(', '));
				} else if (typeof aVal === 'string' && typeof bVal === 'string') {
					comparison = aVal.localeCompare(bVal);
				} else if (typeof aVal === 'number' && typeof bVal === 'number') {
					comparison = aVal - bVal;
				}


				return sortConfig.direction === 'ascending' ? comparison : -comparison;
			});
		}

		return filteredPapers;
	}, [papers, searchTerm, filters, sortConfig]);

	const availablePapers = useMemo(() => {
		return processedPapers.filter(p => !projectPaperIds.includes(p.id));
	}, [processedPapers, projectPaperIds]);

	// Virtualization setup
	const rowVirtualizer = useVirtualizer({
		count: processedPapers.length,
		getScrollElement: () => tableContainerRef.current,
		estimateSize: () => 80, // Estimated row height in pixels
		overscan: 10, // Number of items to render outside visible area
	});

	const requestSort = (key: SortKey) => {
		let direction: 'ascending' | 'descending' = 'ascending';
		if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
			direction = 'descending';
		}
		setSortConfig({ key, direction });
	};

	const handleSelectAll = (checked: boolean) => {
		if (checked) {
			setSelectedPapers(new Set(availablePapers.map((p) => p.id)));
		} else {
			setSelectedPapers(new Set());
		}
	};

	const handleSelect = (paperId: string, checked?: boolean) => {
		const newSelectedPapers = new Set(selectedPapers);
		const isCurrentlySelected = newSelectedPapers.has(paperId);

		const shouldBeSelected = checked !== undefined ? checked : !isCurrentlySelected;

		if (shouldBeSelected) {
			newSelectedPapers.add(paperId);
		} else {
			newSelectedPapers.delete(paperId);
		}
		setSelectedPapers(newSelectedPapers);
	};

	const handleAction = (action: string) => {
		if (onSelectFiles) {
			const selectedItems = (papers || []).filter((p) => selectedPapers.has(p.id));
			onSelectFiles(selectedItems, action);
			setSelectedPapers(new Set());
		}
	};

	const handleDeletePapers = async () => {
		if (!handleDelete) return;

		const paperIdsToDelete = Array.from(selectedPapers);
		const deletePromises = paperIdsToDelete.map(id => handleDelete(id));

		try {
			await Promise.all(deletePromises);
			toast.success(`Successfully deleted ${paperIdsToDelete.length} paper(s).`);
			mutate(); // Revalidate the papers list
		} catch (error) {
			console.error("Failed to delete some papers:", error);
			toast.error("An error occurred while deleting papers.");
		}

		setSelectedPapers(new Set());
	};

	const toggleExpandedTags = (paperId: string) => {
		setExpandedTags(prev => {
			const newSet = new Set(prev);
			if (newSet.has(paperId)) {
				newSet.delete(paperId);
			} else {
				newSet.add(paperId);
			}
			return newSet;
		});
	};

	const handleTagClick = (tagName: string) => {
		const newFilter: Filter = { type: 'tag', value: tagName };
		if (!filters.some(f => f.type === 'tag' && f.value === tagName)) {
			setFilters([...filters, newFilter]);
		}
	};

	const handleRemoveTag = async (paperId: string, tagId: string) => {
		try {
			await fetchFromApi(`/api/paper/tag/papers/${paperId}/tags/${tagId}`, {
				method: "DELETE",
			});
			// Don't need to send a toast for success - can be noisy.
			// toast.success("Tag removed.");
			mutate(); // Revalidate the papers list
		} catch (error) {
			console.error("Failed to remove tag", error);
			toast.error("Failed to remove tag.");
		}
	};



	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="text-muted-foreground">Loading papers...</div>
			</div>
		);
	}

	if (papersFetchError) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="text-destructive">{papersFetchError}</div>
			</div>
		);
	}

	const numCols = 7 + (selectable ? 1 : 0);
	const allAvailableSelected = availablePapers.length > 0 && selectedPapers.size === availablePapers.length;


	return (
		<div className="space-y-4 w-full max-w-full overflow-hidden" {...props}>
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div className="flex flex-col md:flex-row items-start md:items-center gap-4 w-full">
					<Input
						placeholder="Filter papers by title, authors, organizations, or keywords..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						className="w-full md:max-w-xl"
					/>
					<PaperFiltering
						papers={papers || []}
						onFilterChange={setFilters}
						onSortChange={() => { }}
						filters={filters}
						sort={sort}
						showSort={false}
					/>
					{processedPapers.length !== (papers || []).length && (
						<div className="text-sm text-muted-foreground">
							Showing {processedPapers.length} of {(papers || []).length} papers
						</div>
					)}
				</div>
				{(!isMobile || selectedPapers.size > 0) && (
					<div className="fixed md:relative bottom-4 md:bottom-auto right-4 md:right-auto z-50 md:z-auto bg-background md:bg-transparent p-4 md:p-0 rounded-lg md:rounded-none shadow-lg md:shadow-none border md:border-none">
						<div className="flex flex-col md:flex-row md:items-center gap-4">
							{selectable && onSelectFiles && (
								<div
									className={`flex flex-col md:flex-row items-start md:items-center gap-3 transition-all duration-200 ${selectedPapers.size > 0
										? "opacity-100 translate-y-0"
										: "opacity-0 translate-y-2 pointer-events-none"
										}`}
								>
									{selectedPapers.size > 0 && (
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
												{selectedPapers.size} paper{selectedPapers.size !== 1 ? 's' : ''}
											</span>
											<Button
												variant="ghost"
												size="icon"
												className="h-6 w-6"
												onClick={() => setSelectedPapers(new Set())}
											>
												<X className="h-4 w-4" />
											</Button>
										</div>
									)}
									<div className="flex items-center gap-2">
										{actionOptions.map((action) => (
											<Button
												key={action}
												variant="default"
												size="sm"
												onClick={() => handleAction(action)}
												className="font-medium bg-blue-500 text-white hover:bg-blue-600 dark:hover:bg-blue-400 cursor-pointer"
											>
												{action}
											</Button>
										))}
									</div>
								</div>
							)}
							<div className={`flex items-center gap-2 transition-all duration-200 ${selectedPapers.size > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
								{selectable && (
									<>
										<DropdownMenu open={taggingPopoverOpen} onOpenChange={setTaggingPopoverOpen}>
											<DropdownMenuTrigger asChild>
												<Button variant="outline">
													<Tag className="h-4 w-4 mr-2" />
													Tag
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent className="w-80">
												<TagSelector
													paperIds={Array.from(selectedPapers)}
													onTagsApplied={() => {
														setTaggingPopoverOpen(false);
														mutate();
													}}
												/>
											</DropdownMenuContent>
										</DropdownMenu>

										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="outline">
													Actions <ChevronDown className="h-4 w-4 ml-2" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent>
												{handleDelete && (
													<DropdownMenuItem
														onClick={handleDeletePapers}
														disabled={selectedPapers.size === 0}
														className="text-red-500"
													>
														<Trash2 className="h-4 w-4 mr-2" />
														Delete ({selectedPapers.size})
													</DropdownMenuItem>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									</>
								)}
							</div>
						</div>
					</div>
				)}
			</div>

			<div className="flex flex-wrap gap-2 mb-4">
				{filters.map(filter => (
					<Badge key={`${filter.type}-${filter.value}`} variant="secondary" className="flex items-center gap-1">
						{filter.type}: {filter.value}
						<Button
							variant="ghost"
							size="sm"
							className="h-4 w-4 p-0"
							onClick={() => setFilters(filters.filter(f => f.value !== filter.value))}
						>
							<X className="h-3 w-3" />
						</Button>
					</Badge>
				))}
			</div>

			<div className="grid grid-cols-1 gap-4 min-h-0" style={{
				gridTemplateColumns: selectedPaperForPreview && !isMobile
					? sidebarState === 'expanded'
						? '1fr 320px'
						: '1fr 384px'
					: '1fr'
			}}>
				<div className="border bg-card transition-all duration-300 ease-in-out min-w-0 overflow-hidden">
					<div ref={tableContainerRef} className="overflow-y-auto" style={{ height: maxHeight }}>
						<Table>
							<TableHeader className="sticky top-0 bg-card z-10">
								<TableRow className="hover:bg-transparent border-b-2">
									{selectable && (
										<TableHead className="w-12 text-center">
											<Checkbox
												checked={allAvailableSelected}
												onCheckedChange={handleSelectAll}
												disabled={availablePapers.length === 0}
											/>
										</TableHead>
									)}
									<TableHead className="min-w-[24rem]">
										<Button
											variant="ghost"
											onClick={() => requestSort('title')}
											className="h-auto p-0 font-semibold hover:bg-transparent hover:text-primary"
										>
											Title
											<ArrowUpDown className="ml-2 h-4 w-4" />
										</Button>
									</TableHead>
									<TableHead className="min-w-[12rem]">
										<Button
											variant="ghost"
											className="h-auto p-0 font-semibold hover:bg-transparent"
										>
											Authors
										</Button>
									</TableHead>
									<TableHead className="min-w-[12rem]">
										<Button
											variant="ghost"
											className="h-auto p-0 font-semibold hover:bg-transparent"
										>
											Organizations
										</Button>
									</TableHead>
									<TableHead className="min-w-[10rem]">
										<Button
											variant="ghost"
											className="h-auto p-0 font-semibold hover:bg-transparent"
										>
											Keywords
										</Button>
									</TableHead>
									<TableHead className="min-w-[10rem]">
										<Button
											variant="ghost"
											className="h-auto p-0 font-semibold hover:bg-transparent hover:text-primary"
										>
											Tags
										</Button>
									</TableHead>
									<TableHead className="min-w-[8rem]">
										<Button
											variant="ghost"
											onClick={() => requestSort('created_at')}
											className="h-auto p-0 font-semibold hover:bg-transparent hover:text-primary"
										>
											Added
											<ArrowUpDown className="ml-1 h-4 w-4" />
										</Button>
									</TableHead>
									<TableHead className="min-w-[8rem]">
										<Button
											variant="ghost"
											onClick={() => requestSort('publish_date')}
											className="h-auto p-0 font-semibold hover:bg-transparent hover:text-primary"
										>
											Published
											<ArrowUpDown className="ml-1 h-4 w-4" />
										</Button>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{processedPapers.length > 0 ? (
									<>
										{/* Spacer for virtual scroll */}
										{rowVirtualizer.getVirtualItems().length > 0 && (
											<tr style={{ height: `${rowVirtualizer.getVirtualItems()[0]?.start ?? 0}px` }} />
										)}
										{rowVirtualizer.getVirtualItems().map((virtualRow) => {
											const paper = processedPapers[virtualRow.index];
											const index = virtualRow.index;
											const isAlreadyInProject = projectPaperIds.includes(paper.id);
											return (
												<TableRow
													key={paper.id}
													data-index={virtualRow.index}
													onClick={() => {
														if (selectable && !isAlreadyInProject) {
															handleSelect(paper.id)
														}
													}}
													className={`
														border-b transition-colors hover:bg-muted/50
														${index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
														${selectable && !isAlreadyInProject ? 'cursor-pointer' : ''}
														${!selectable ? 'cursor-pointer' : ''}
														${isAlreadyInProject ? 'opacity-60' : ''}
													`}
												>
													{selectable && (
														<TableCell
															className="text-center py-4"
															onClick={(e) => e.stopPropagation()}
														>
															{isAlreadyInProject ? (
																<CheckCheck className="h-5 w-5 text-green-500 mx-auto" />
															) : (
																<Checkbox
																	checked={selectedPapers.has(paper.id)}
																	onCheckedChange={(checked) =>
																		handleSelect(paper.id, !!checked)
																	}
																/>
															)}
														</TableCell>
													)}
													<TableCell className="py-4 pr-4 whitespace-normal">
														<div
															className="font-medium text-sm leading-relaxed break-words hyphens-auto line-clamp-3 underline cursor-pointer"
															onClick={(e: React.MouseEvent<HTMLDivElement>) => {
																e.stopPropagation();
																setSelectedPaperForPreview(paper);
															}}
														>
															{paper.title || 'Untitled'}
														</div>
													</TableCell>
													<TableCell className="py-4 pr-4 whitespace-normal">
														<div className="text-sm text-muted-foreground leading-relaxed break-words hyphens-auto line-clamp-2">
															{paper.authors?.length ? paper.authors.join(", ") : 'No authors'}
														</div>
													</TableCell>
													<TableCell className="py-4 pr-4 whitespace-normal">
														<div className="text-sm text-muted-foreground leading-relaxed break-words hyphens-auto line-clamp-2">
															{paper.institutions?.length ? paper.institutions.join(", ") : 'No organizations'}
														</div>
													</TableCell>
													<TableCell className="py-4 pr-4">
														<div className="text-xs leading-relaxed">
															{paper.keywords?.length ? (
																<div className="flex flex-wrap gap-1">
																	{paper.keywords.slice(0, 3).map((keyword, i) => (
																		<span
																			key={i}
																			className="inline-block px-2 py-1 bg-secondary text-secondary-foreground rounded-sm"
																		>
																			{keyword}
																		</span>
																	))}
																	{paper.keywords.length > 3 && (
																		<span className="text-muted-foreground text-xs">
																			+{paper.keywords.length - 3} more
																		</span>
																	)}
																</div>
															) : (
																<span className="text-muted-foreground">No keywords</span>
															)}
														</div>
													</TableCell>
													<TableCell className="py-4 pr-4">
														<div className="text-xs leading-relaxed">
															{paper.tags?.length ? (
																<div className="flex flex-wrap gap-1 items-center">
																	{(expandedTags.has(paper.id) ? paper.tags : paper.tags.slice(0, 3)).map((tag) => (
																		<span
																			key={tag.id}
																			onClick={(e) => { e.stopPropagation(); handleTagClick(tag.name); }}
																			className="group relative inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded-sm dark:bg-blue-900 dark:text-blue-200 cursor-pointer"
																		>
																			{tag.name}
																			<button
																				onClick={(e) => {
																					e.stopPropagation();
																					handleRemoveTag(paper.id, tag.id);
																				}}
																				className="ml-1.5 -mr-1 p-0.5 bg-blue-200/50 dark:bg-blue-800/50 text-blue-700 dark:text-blue-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
																			>
																				<X className="h-2.5 w-2.5" />
																			</button>
																		</span>
																	))}
																	{paper.tags.length > 3 && !expandedTags.has(paper.id) && (
																		<button
																			onClick={(e) => { e.stopPropagation(); toggleExpandedTags(paper.id); }}
																			className="text-muted-foreground text-xs hover:underline"
																		>
																			+ {paper.tags.length - 3} more
																		</button>
																	)}
																</div>
															) : (
																<span className="text-muted-foreground">No tags</span>
															)}
														</div>
													</TableCell>
													<TableCell className="py-4 pr-4">
														<div className="text-sm text-muted-foreground whitespace-nowrap">
															{paper.created_at ? new Date(paper.created_at).toLocaleDateString('en-US', {
																month: 'short',
																day: 'numeric',
																year: 'numeric'
															}) : 'N/A'}
														</div>
													</TableCell>
													<TableCell className="py-4">
														<div className="text-sm text-muted-foreground whitespace-nowrap">
															{paper.publish_date ? new Date(paper.publish_date).toLocaleDateString('en-US', {
																month: 'short',
																day: 'numeric',
																year: 'numeric'
															}) : 'N/A'}
														</div>
													</TableCell>
												</TableRow>
											)
										})}
										{/* Bottom spacer */}
										{rowVirtualizer.getVirtualItems().length > 0 && (
											<tr style={{
												height: `${rowVirtualizer.getTotalSize() -
													(rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.end ?? 0)
													}px`
											}} />
										)}
									</>
								) : (
									<TableRow>
										<TableCell colSpan={numCols} className="h-32 text-center">
											{searchTerm || filters.length > 0 ? (
												"No papers match your search criteria."
											) : (
												<div className="flex flex-col items-center gap-4 py-8">
													<div className="text-muted-foreground text-center">
														<p className="text-lg font-medium mb-2">No papers in your library yet</p>
														<p className="text-sm">Upload your first research paper to get started. All your papers will appear here for easy access and organization.</p>
													</div>
													<Button variant="default" className="bg-blue-500 hover:bg-blue-600 text-white" onClick={onUploadClick}>
														Upload Your First Paper
													</Button>
												</div>
											)}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</div>
				{selectedPaperForPreview && (
					isMobile ? (
						<Sheet open={!!selectedPaperForPreview} onOpenChange={(open) => { if (!open) setSelectedPaperForPreview(null); }}>
							<SheetContent side="bottom" className="h-[90vh] w-full flex flex-col p-0 overflow-hidden [&>button]:hidden">
								<div className="overflow-y-auto flex-1">
									<PaperPreview paper={selectedPaperForPreview} onClose={() => setSelectedPaperForPreview(null)} setPaper={setPaper} />
								</div>
							</SheetContent>
						</Sheet>
					) : (
						<PaperPreview paper={selectedPaperForPreview} onClose={() => setSelectedPaperForPreview(null)} setPaper={setPaper} />
					)
				)}
			</div>
		</div>
	);
}
