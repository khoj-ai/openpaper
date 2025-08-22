"use client";

import {
	Table,
	TableBody,
	TableCaption,
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
import { ArrowUpDown } from "lucide-react";

interface LibraryTableProps {
	selectable?: boolean;
	onSelectFiles?: (papers: PaperItem[], action: string) => void;
	actionOptions?: string[];
}

export function LibraryTable({
	selectable = false,
	onSelectFiles,
	actionOptions = [],
}: LibraryTableProps) {
	const [papers, setPapers] = useState<PaperItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState('');
	type SortKey = keyof PaperItem;
	const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'ascending' | 'descending' } | null>({ key: 'created_at', direction: 'descending' });

	useEffect(() => {
		const getPapers = async () => {
			try {
				const data = await fetchFromApi("/api/paper/all");
				setPapers(data.papers);
			} catch (error) {
				setError("Failed to fetch papers.");
				console.error(error);
			} finally {
				setLoading(false);
			}
		};

		getPapers();
	}, []);

	const processedPapers = useMemo(() => {
		let filteredPapers = [...papers];

		if (filter) {
			filteredPapers = filteredPapers.filter(paper => {
				const searchTerm = filter.toLowerCase();
				return (
					paper.title?.toLowerCase().includes(searchTerm) ||
					paper.authors?.join(', ').toLowerCase().includes(searchTerm) ||
					paper.institutions?.join(', ').toLowerCase().includes(searchTerm) ||
					paper.keywords?.join(', ').toLowerCase().includes(searchTerm)
				);
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
	}, [papers, filter, sortConfig]);

	const requestSort = (key: SortKey) => {
		let direction: 'ascending' | 'descending' = 'ascending';
		if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
			direction = 'descending';
		}
		setSortConfig({ key, direction });
	};

	const handleSelectAll = (checked: boolean) => {
		if (checked) {
			setSelectedPapers(new Set(processedPapers.map((p) => p.id)));
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
			const selectedItems = papers.filter((p) => selectedPapers.has(p.id));
			onSelectFiles(selectedItems, action);
		}
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

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-4">
				<Input
					placeholder="Filter papers by title, authors, organizations, or keywords..."
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					className="max-w-lg"
				/>
				{processedPapers.length !== papers.length && (
					<div className="text-sm text-muted-foreground">
						Showing {processedPapers.length} of {papers.length} papers
					</div>
				)}
			</div>

			<div className="rounded-lg border bg-card">
				<div className="max-h-[70vh] overflow-y-auto">
					<Table className="table-fixed w-full" noWrapperOverflow>
						<TableCaption className="mt-4 mb-2">Your research library</TableCaption>
						<TableHeader className="sticky top-0 bg-card z-10">
							<TableRow className="hover:bg-transparent border-b-2">
								{selectable && (
									<TableHead className="w-12 text-center">
										<Checkbox
											checked={
												processedPapers.length > 0 && selectedPapers.size === processedPapers.length
											}
											onCheckedChange={handleSelectAll}
										/>
									</TableHead>
								)}
								<TableHead className="w-[35%]">
									<Button
										variant="ghost"
										onClick={() => requestSort('title')}
										className="h-auto p-0 font-semibold hover:bg-transparent hover:text-primary"
									>
										Title
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead className="w-[20%]">
									<Button
										variant="ghost"
										className="h-auto p-0 font-semibold hover:bg-transparent"
									>
										Authors
									</Button>
								</TableHead>
								<TableHead className="w-[15%]">
									<Button
										variant="ghost"
										className="h-auto p-0 font-semibold hover:bg-transparent"
									>
										Organizations
									</Button>
								</TableHead>
								<TableHead className="w-[12%]">
									<Button
										variant="ghost"
										className="h-auto p-0 font-semibold hover:bg-transparent"
									>
										Keywords
									</Button>
								</TableHead>
								<TableHead className="w-[9%]">
									<Button
										variant="ghost"
										onClick={() => requestSort('created_at')}
										className="h-auto p-0 font-semibold hover:bg-transparent hover:text-primary"
									>
										Added
										<ArrowUpDown className="ml-1 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead className="w-[9%]">
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
								processedPapers.map((paper, index) => (
									<TableRow
										key={paper.id}
										onClick={() => selectable && handleSelect(paper.id)}
										className={`
									border-b transition-colors hover:bg-muted/50
									${index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
									${selectable ? 'cursor-pointer' : ''}
								`}
									>
										{selectable && (
											<TableCell
												className="text-center py-4"
												onClick={(e) => e.stopPropagation()}
											>
												<Checkbox
													checked={selectedPapers.has(paper.id)}
													onCheckedChange={(checked) =>
														handleSelect(paper.id, !!checked)
													}
												/>
											</TableCell>
										)}
										<TableCell className="py-4 pr-4 whitespace-normal">
											<div className="font-medium text-sm leading-relaxed break-words hyphens-auto line-clamp-3">
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
								))
							) : (
								<TableRow>
									<TableCell colSpan={numCols} className="h-24 text-center">
										{filter ? "No papers match your search criteria." : "No papers in your library yet."}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</div>

			{selectable && (
				<div
					className={`flex items-center gap-3 p-4 rounded-lg bg-muted/50 border transition-all duration-200 ${selectedPapers.size > 0
						? "opacity-100 translate-y-0"
						: "opacity-0 translate-y-2 pointer-events-none"
						}`}
				>
					<div className="flex items-center gap-2">
						{actionOptions.map((action) => (
							<Button
								key={action}
								variant="default"
								size="sm"
								onClick={() => handleAction(action)}
								className="font-medium"
							>
								{action}
							</Button>
						))}
					</div>
					{selectedPapers.size > 0 && (
						<span className="text-sm font-medium text-muted-foreground">
							{selectedPapers.size} paper{selectedPapers.size !== 1 ? 's' : ''} selected
						</span>
					)}
				</div>
			)}
		</div>
	);
}
