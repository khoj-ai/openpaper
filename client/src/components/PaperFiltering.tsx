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
import { PaperStatusEnum } from "@/components/utils/PdfStatus";

export type Filter = {
    type: "author" | "status" | "tag" | "project"
    value: string
}

export const NO_TAGS_FILTER_VALUE = "__NO_TAGS__";
export const NO_PROJECT_FILTER_VALUE = "__NO_PROJECT__";

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
    showSort?: boolean
}

export function PaperFiltering({ papers, onFilterChange, onSortChange, filters, sort, showSort = true }: PaperFilteringProps) {
    const authors = Array.from(new Set(papers.flatMap(p => p.authors || [])))
    const tags = Array.from(new Set(papers.flatMap(p => p.tags?.map(t => t.name) || [])))
    const projects = Array.from(
        new Map(papers.flatMap(p => p.projects || []).map(project => [project.id, project])).values()
    ).sort((a, b) => a.title.localeCompare(b.title))

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
                        {showSort ? "Filter & Sort" : "Filter"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                    {showSort &&
                        <>
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
                        </>
                    }
                    <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                    <DropdownMenuGroup>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Projects</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <Command>
                                    <CommandInput
                                        placeholder="Filter project..."
                                        autoFocus={true}
                                        className="h-9"
                                    />
                                    <CommandList>
                                        <CommandEmpty>No projects found.</CommandEmpty>
                                        <CommandGroup>
                                            <CommandItem
                                                value="No project"
                                                onSelect={() => handleSelectFilter({ type: "project", value: NO_PROJECT_FILTER_VALUE })}
                                                className="text-muted-foreground"
                                            >
                                                {isFilterActive({ type: "project", value: NO_PROJECT_FILTER_VALUE }) && <Check className="mr-2 h-4 w-4" />}
                                                No project
                                            </CommandItem>
                                            {projects.map(project => (
                                                <CommandItem
                                                    key={project.id}
                                                    value={`${project.title}-${project.id}`}
                                                    onSelect={() => handleSelectFilter({ type: "project", value: project.id })}
                                                >
                                                    {isFilterActive({ type: "project", value: project.id }) && <Check className="mr-2 h-4 w-4" />}
                                                    {project.title}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
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
                            <DropdownMenuSubTrigger>Tags</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <Command>
                                    <CommandInput
                                        placeholder="Filter tag..."
                                        autoFocus={true}
                                        className="h-9"
                                    />
                                    <CommandList>
                                        <CommandEmpty>No tags found.</CommandEmpty>
                                        <CommandGroup>
                                            <CommandItem
                                                value="No tags"
                                                onSelect={() => handleSelectFilter({ type: "tag", value: NO_TAGS_FILTER_VALUE })}
                                                className="text-muted-foreground"
                                            >
                                                {isFilterActive({ type: "tag", value: NO_TAGS_FILTER_VALUE }) && <Check className="mr-2 h-4 w-4" />}
                                                No tags
                                            </CommandItem>
                                            {tags.map(tag => (
                                                <CommandItem
                                                    key={tag}
                                                    value={tag}
                                                    onSelect={() => handleSelectFilter({ type: "tag", value: tag })}
                                                >
                                                    {isFilterActive({ type: "tag", value: tag }) && <Check className="mr-2 h-4 w-4" />}
                                                    {tag}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <Command>
                                    <CommandList>
                                        <CommandGroup>
                                            {Object.values(PaperStatusEnum).map(status => (
                                                <CommandItem
                                                    key={status}
                                                    value={status}
                                                    onSelect={() => handleSelectFilter({ type: "status", value: status })}
                                                >
                                                    {isFilterActive({ type: "status", value: status }) && <Check className="mr-2 h-4 w-4" />}
                                                    {status}
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
