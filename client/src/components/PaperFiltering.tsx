"use client"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { ChevronsUpDown, Check } from "lucide-react"
import { PaperItem } from "@/lib/schema";

export type Filter = {
    type: "author" | "keyword"
    value: string
}

export type Sort = {
    type: "publish_date"
    order: "asc" | "desc"
}

interface PaperFilteringProps {
    papers: PaperItem[]
    onFilterChange: (filters: Filter[]) => void
    onSortChange: (sort: Sort) => void
    filters: Filter[]
    sort: Sort
}

export function PaperFiltering({ papers, onFilterChange, onSortChange, filters, sort }: PaperFilteringProps) {
    const authors = Array.from(new Set(papers.flatMap(p => p.authors || [])))
    const keywords = Array.from(new Set(papers.flatMap(p => p.keywords || [])))

    const handleSelectFilter = (filter: Filter) => {
        const newFilters = filters.some(f => f.type === filter.type && f.value === filter.value)
            ? filters.filter(f => !(f.type === filter.type && f.value === filter.value))
            : [...filters, filter]
        onFilterChange(newFilters)
    }

    const handleSelectSort = (newSort: Sort) => {
        onSortChange(newSort)
    }

    const isFilterActive = (filter: Filter) => {
        return filters.some(f => f.type === filter.type && f.value === filter.value)
    }

    const isSortActive = (newSort: Sort) => {
        return sort.type === newSort.type && sort.order === newSort.order
    }

    return (
        <div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        className="w-[200px] justify-between"
                    >
                        Filter & Sort
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => handleSelectSort({ type: "publish_date", order: "desc" })}>
                            Publish Date (Newest)
                            {isSortActive({ type: "publish_date", order: "desc" }) && <Check className="ml-auto h-4 w-4" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleSelectSort({ type: "publish_date", order: "asc" })}>
                            Publish Date (Oldest)
                            {isSortActive({ type: "publish_date", order: "asc" }) && <Check className="ml-auto h-4 w-4" />}
                        </DropdownMenuItem>

                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                    <DropdownMenuGroup>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Authors</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <Command>
                                    <CommandInput
                                        placeholder="Filter author..."
                                        autoFocus={true}
                                        className="h-9"
                                    />
                                    <CommandList>
                                        <CommandEmpty>No author found.</CommandEmpty>
                                        <CommandGroup>
                                            {authors.map(author => (
                                                <CommandItem
                                                    key={author}
                                                    value={author}
                                                    onSelect={() => handleSelectFilter({ type: "author", value: author })}
                                                >
                                                    {isFilterActive({ type: "author", value: author }) && <Check className="mr-2 h-4 w-4" />}
                                                    {author}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Keywords</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <Command>
                                    <CommandInput
                                        placeholder="Filter keyword..."
                                        autoFocus={true}
                                        className="h-9"
                                    />
                                    <CommandList>
                                        <CommandEmpty>No keyword found.</CommandEmpty>
                                        <CommandGroup>
                                            {keywords.map(keyword => (
                                                <CommandItem
                                                    key={keyword}
                                                    value={keyword}
                                                    onSelect={() => handleSelectFilter({ type: "keyword", value: keyword })}
                                                >
                                                    {isFilterActive({ type: "keyword", value: keyword }) && <Check className="mr-2 h-4 w-4" />}
                                                    {keyword}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>

        </div>
    )
}
