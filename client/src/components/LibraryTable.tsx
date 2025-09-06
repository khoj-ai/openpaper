"use client";

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useEffect, useState, useMemo } from "react";
import { fetchFromApi } from "@/lib/api";
import { PaperItem } from "@/lib/schema";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useSidebar } from "./ui/sidebar";
import { ArrowUpDown, CheckCheck, Trash2, X, ExternalLink, Copy, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getStatusIcon, PaperStatusEnum } from "@/components/utils/PdfStatus";
import { handleStatusChange } from "@/components/utils/paperUtils";
import { citationStyles } from "@/components/utils/paperUtils";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { PaperFiltering, Filter, Sort } from "@/components/PaperFiltering";
import { Badge } from "@/components/ui/badge";


interface LibraryTableProps {
	selectable?: boolean;
	onSelectFiles?: (papers: PaperItem[], action: string) => void;
	actionOptions?: string[];
	projectPaperIds?: string[];
	handleDelete?: (paperId: string) => Promise<void>;
	setPapers?: (papers: PaperItem[]) => void;
}

export function LibraryTable({
	selectable: selectableProp,
	onSelectFiles,
	actionOptions = [],
	projectPaperIds = [],
	handleDelete,
	setPapers,
}: LibraryTableProps) {
	const selectable = selectableProp ?? (onSelectFiles ? true : false);
	const { state: sidebarState } = useSidebar();
	const [internalPapers, setInternalPapers] = useState<PaperItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set());
	const [searchTerm, setSearchTerm] = useState('');
	const [filters, setFilters] = useState<Filter[]>([]);
	const [sort] = useState<Sort>({ type: "publish_date", order: "desc" });
	type SortKey = keyof PaperItem;
	const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'ascending' | 'descending' } | null>({ key: 'created_at', direction: 'descending' });
	const [selectedPaperForPreview, setSelectedPaperForPreview] = useState<PaperItem | null>(null);

	useEffect(() => {
		const getPapers = async () => {
			try {
				const data = await fetchFromApi("/api/paper/all");
				setInternalPapers(data.papers);
				if (setPapers) {
					setPapers(data.papers);
				}
			} catch (error) {
				setError("Failed to fetch papers.");
				console.error(error);
			} finally {
				setLoading(false);
			}
		};

		getPapers();
	}, []);

	const setPaper = (paperId: string, updatedPaper: PaperItem) => {
		setInternalPapers(prevPapers =>
			prevPapers.map(p => (p.id === paperId ? updatedPaper : p))
		);
		if (selectedPaperForPreview && selectedPaperForPreview.id === paperId) {
			setSelectedPaperForPreview(updatedPaper);
		}
	};

	const processedPapers = useMemo(() => {
		let filteredPapers = [...internalPapers];

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
	}, [internalPapers, searchTerm, filters, sortConfig]);

	const availablePapers = useMemo(() => {
		return processedPapers.filter(p => !projectPaperIds.includes(p.id));
	}, [processedPapers, projectPaperIds]);

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
			const selectedItems = internalPapers.filter((p) => selectedPapers.has(p.id));
			onSelectFiles(selectedItems, action);
			setSelectedPapers(new Set());
		}
	};

	const handleDeletePapers = async () => {
		if (!handleDelete) return;

		const paperIdsToDelete = Array.from(selectedPapers);
		for (const paperId of paperIdsToDelete) {
			await handleDelete(paperId);
		}
		setSelectedPapers(new Set());
	};

	const copyToClipboard = (text: string, styleName: string) => {
		navigator.clipboard.writeText(text).then(() => {
			// Success feedback using toast
			toast("Copied!", {
				description: `${styleName} citation copied to clipboard.`,
				richColors: true,
			});
		}).catch(err => {
			console.error('Failed to copy text: ', err);
			// Error feedback using toast
			toast("Copy failed", {
				description: "Could not copy citation to clipboard.",
				richColors: true,
			});
		});
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="text-muted-foreground">Loading papers...</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="text-destructive">{error}</div>
			</div>
		);
	}

	const numCols = 6 + (selectable ? 1 : 0);
	const allAvailableSelected = availablePapers.length > 0 && selectedPapers.size === availablePapers.length;


	return (
		<div className="space-y-4 w-full max-w-full overflow-hidden">
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-4 w-full">
					<Input
						placeholder="Filter papers by title, authors, organizations, or keywords..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						className="max-w-xl"
					/>
					<PaperFiltering
						papers={internalPapers}
						onFilterChange={setFilters}
						onSortChange={() => { }}
						filters={filters}
						sort={sort}
						showSort={false}
					/>
					{processedPapers.length !== internalPapers.length && (
						<div className="text-sm text-muted-foreground">
							Showing {processedPapers.length} of {internalPapers.length} papers
						</div>
					)}
				</div>
				{selectable && onSelectFiles && (
					<div
						className={`flex items-center gap-3 transition-all duration-200 ${selectedPapers.size > 0
							? "opacity-100 translate-y-0"
							: "opacity-0 translate-y-2 pointer-events-none"
							}`}
					>
						{selectedPapers.size > 0 && (
							<span className="text-sm font-medium text-muted-foreground">
								{selectedPapers.size} paper{selectedPapers.size !== 1 ? 's' : ''} selected
							</span>
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
					{selectable && handleDelete && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline">
									Actions <ChevronDown className="h-4 w-4 ml-2" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem
									onClick={handleDeletePapers}
									disabled={selectedPapers.size === 0}
									className="text-red-500"
								>
									<Trash2 className="h-4 w-4 mr-2" />
									Delete ({selectedPapers.size})
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>

			<div className="flex flex-wrap gap-2 mb-4">
				{filters.map(filter => (
					<Badge key={`${filter.type}-${filter.value}`} variant="secondary" className="flex items-center gap-1">
						{filter.value}
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
				gridTemplateColumns: selectedPaperForPreview
					? sidebarState === 'expanded'
						? '1fr 320px'
						: '1fr 384px'
					: '1fr'
			}}>
				<div className="border bg-card transition-all duration-300 ease-in-out min-w-0 overflow-hidden">
					<div className="max-h-[70vh] overflow-y-auto">
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
									processedPapers.map((paper, index) => {
										const isAlreadyInProject = projectPaperIds.includes(paper.id);
										return (
											<TableRow
												key={paper.id}
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
									})
								) : (
									<TableRow>
										<TableCell colSpan={numCols} className="h-24 text-center">
											{searchTerm || filters.length > 0 ? "No papers match your search criteria." : "No papers in your library yet."}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</div>
				{selectedPaperForPreview && (
					<div className="border bg-card rounded-lg transition-all duration-300 ease-in-out min-w-0 overflow-hidden">
						<div className="h-full">
							<div className="p-4 relative max-h-[70vh] overflow-y-auto">
								<Button
									variant="ghost"
									size="icon"
									className="absolute top-2 right-2 z-10"
									onClick={() => setSelectedPaperForPreview(null)}
								>
									<X className="h-4 w-4" />
								</Button>
								<Link href={`/paper/${selectedPaperForPreview.id}`} passHref>
									<h3 className="font-bold text-lg mb-2 pr-8 hover:underline cursor-pointer flex items-center gap-2">
										{selectedPaperForPreview.title}
										<ExternalLink className="h-4 w-4" />
									</h3>
								</Link>
								{selectedPaperForPreview.preview_url && (
									<>
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src={selectedPaperForPreview.preview_url}
											alt="Paper preview"
											className="w-full h-auto my-4 rounded-md"
										/>
									</>
								)}
								<div className="flex items-center gap-2 flex-wrap">
									{selectedPaperForPreview.status && (
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button size="sm" variant="outline" className="h-8 px-3 text-xs capitalize">
													<span className="flex items-center gap-2">
														{getStatusIcon(selectedPaperForPreview.status)}
														{selectedPaperForPreview.status}
													</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => handleStatusChange(selectedPaperForPreview, PaperStatusEnum.TODO, setPaper)}>
													{getStatusIcon(PaperStatusEnum.TODO)}
													Todo
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => handleStatusChange(selectedPaperForPreview, PaperStatusEnum.READING, setPaper)}>
													{getStatusIcon(PaperStatusEnum.READING)}
													Reading
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => handleStatusChange(selectedPaperForPreview, PaperStatusEnum.COMPLETED, setPaper)}>
													{getStatusIcon(PaperStatusEnum.COMPLETED)}
													Completed
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									)}
									<Dialog>
										<DialogTrigger asChild>
											<Button variant="outline" size="sm" className="h-8 px-3 text-xs">
												Cite
											</Button>
										</DialogTrigger>
										<DialogContent className="sm:max-w-[625px]">
											<DialogHeader>
												<DialogTitle>Cite Paper</DialogTitle>
												<DialogDescription>
													Copy the citation format you need for <b>{selectedPaperForPreview.title}</b>.
												</DialogDescription>
											</DialogHeader>
											<ScrollArea className="h-[300px] w-full rounded-md border p-4">
												<div className="grid gap-4 py-4">
													{citationStyles.map((style) => {
														const citationText = style.generator(selectedPaperForPreview);
														return (
															<div key={style.name} className="flex items-start justify-between gap-2">
																<div className="flex-grow min-w-0">
																	<h4 className="font-semibold mb-1">{style.name}</h4>
																	<p className="text-sm bg-muted p-2 rounded break-words">{citationText}</p>
																</div>
																<Button
																	variant="ghost"
																	size="icon"
																	className="mt-5 h-8 w-8 flex-shrink-0"
																	onClick={() => copyToClipboard(citationText, style.name)}
																	aria-label={`Copy ${style.name} citation`}
																>
																	<Copy className="h-4 w-4" />
																</Button>
															</div>
														);
													})}
												</div>
											</ScrollArea>
											<DialogFooter>
												<DialogClose asChild>
													<Button type="button" variant="secondary">
														Close
													</Button>
												</DialogClose>
											</DialogFooter>
										</DialogContent>
									</Dialog>
								</div>
								<p className="text-sm mt-4 break-words">{selectedPaperForPreview.abstract}</p>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
