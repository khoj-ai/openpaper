"use client";
import { useEffect, useState, Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Project } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { PlusCircle, Target, BookOpen, FileText, AlertTriangle, Search, Headphones, MessageCircle, Table, Users, X, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSubscription, isProjectNearLimit, isProjectAtLimit, getProjectUsagePercentage } from "@/hooks/useSubscription";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Progress } from "@/components/ui/progress";
import LoadingIndicator from "@/components/utils/Loading";
import { ProjectInvitations } from "@/components/ProjectInvitations";

type ProjectFilter = "hasAudio" | "hasChats" | "hasDataTables" | "shared";

const FILTER_CONFIG: Record<ProjectFilter, { label: string; icon: React.ElementType; check: (p: Project) => boolean }> = {
	hasAudio: { label: "Audio Overviews", icon: Headphones, check: (p) => (p.num_audio_overviews ?? 0) > 0 },
	hasChats: { label: "Chats", icon: MessageCircle, check: (p) => (p.num_conversations ?? 0) > 0 },
	hasDataTables: { label: "Data Tables", icon: Table, check: (p) => (p.num_data_tables ?? 0) > 0 },
	shared: { label: "Shared", icon: Users, check: (p) => (p.num_roles ?? 1) > 1 },
};

function ProjectsPage() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const { user, loading: userLoading } = useAuth();
	const [error, setError] = useState<string | null>(null);
	const { subscription } = useSubscription();
	const router = useRouter();
	const searchParams = useSearchParams();

	const [showUsageAlert, setShowUsageAlert] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [activeFilters, setActiveFilters] = useState<Set<ProjectFilter>>(new Set());

	const atProjectLimit = subscription ? isProjectAtLimit(subscription) : false;
	const nearProjectLimit = subscription ? isProjectNearLimit(subscription) : false;
	const openInvites = searchParams.get("openInvites") !== null;

	const toggleFilter = (filter: ProjectFilter) => {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(filter)) {
				next.delete(filter);
			} else {
				next.add(filter);
			}
			return next;
		});
	};

	const clearAllFilters = () => {
		setSearchQuery("");
		setActiveFilters(new Set());
	};

	const filteredProjects = useMemo(() => {
		return projects.filter((project) => {
			// Search filter
			if (searchQuery.trim()) {
				const query = searchQuery.toLowerCase();
				const matchesTitle = project.title.toLowerCase().includes(query);
				const matchesDescription = project.description?.toLowerCase().includes(query);
				if (!matchesTitle && !matchesDescription) return false;
			}

			// Quick filters - all active filters must match
			for (const filter of activeFilters) {
				if (!FILTER_CONFIG[filter].check(project)) return false;
			}

			return true;
		});
	}, [projects, searchQuery, activeFilters]);

	const hasActiveFilters = searchQuery.trim() !== "" || activeFilters.size > 0;

	const getProjects = async () => {
		try {
			const fetchedProjects = await fetchFromApi("/api/projects?detailed=true");
			setProjects(fetchedProjects);
		} catch (err) {
			setError("Failed to fetch projects. Please try again.");
			console.error(err);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		if (userLoading) return;
		if (!user) {
			localStorage.setItem('returnTo', window.location.pathname);
			router.push("/login");
			return;
		}
		getProjects();
	}, [userLoading, user, router]);

	useEffect(() => {
		if (subscription) {
			if (atProjectLimit) {
				toast.info("You've built some great projects! Upgrade to create more.", {
					description: "You have used all of your available projects. Upgrade your plan to create more.",
					action: {
						label: "View Plans",
						onClick: () => router.push("/pricing"),
					},
				});
			} else if (nearProjectLimit) {
				toast.warning("Approaching Project Limit", {
					description: `You have used ${subscription.usage.projects} of ${subscription.usage.projects + subscription.usage.projects_remaining
						} projects. Consider upgrading soon.`,
					action: {
						label: "View Plans",
						onClick: () => router.push("/pricing"),
					},
				});
			}
		}
	}, [atProjectLimit, nearProjectLimit, subscription, router]);

	// Empty state component
	const EmptyState = () => (
		<div className="flex flex-col items-center justify-center py-16 px-4 text-center max-w-2xl mx-auto min-h-[60vh]">
			<h2 className="text-2xl font-bold text-foreground mb-3">
				Organize Your Research
			</h2>
			<p className="text-muted-foreground mb-8 max-w-md">
				Group papers by topic, get focused AI assistance, and streamline your literature reviews.
			</p>

			{/* CTA buttons */}
			<div className="flex flex-col sm:flex-row gap-3 mb-12">
				{atProjectLimit ? (
					<Button
						size="lg"
						className="bg-primary hover:bg-primary/90"
						disabled
					>
						<PlusCircle className="mr-2 h-4 w-4" />
						Create your first project
					</Button>
				) : (
					<Button
						asChild
						size="lg"
						className="bg-primary hover:bg-primary/90"
					>
						<Link href="/projects/create">
							<PlusCircle className="mr-2 h-4 w-4" />
							Create your first project
						</Link>
					</Button>
				)}
				<Button variant="outline" size="lg" asChild>
					<Link href="/blog/projects">
						Learn more
					</Link>
				</Button>
			</div>

			{/* Feature highlights */}
			<div className="flex items-center justify-center gap-8 text-blue-500">
				<div className="flex flex-col items-center gap-1 max-w-24">
					<Target className="h-5 w-5" />
					<span className="text-xs font-medium text-foreground">Focus</span>
					<span className="text-xs text-muted-foreground text-center">Organize by topic or goal</span>
				</div>
				<div className="flex flex-col items-center gap-1 max-w-24">
					<BookOpen className="h-5 w-5" />
					<span className="text-xs font-medium text-foreground">AI Chat</span>
					<span className="text-xs text-muted-foreground text-center">Context-aware assistance</span>
				</div>
				<div className="flex flex-col items-center gap-1 max-w-24">
					<FileText className="h-5 w-5" />
					<span className="text-xs font-medium text-foreground">Research</span>
					<span className="text-xs text-muted-foreground text-center">Streamline lit reviews</span>
				</div>
			</div>
		</div>
	);

	return (
		<div className="container mx-auto p-4">
			{(nearProjectLimit || atProjectLimit) && subscription && showUsageAlert && (
				<Alert variant={'default'} className="mb-4">
					<div className="flex justify-between items-start">
						<div className="flex items-start">
							<AlertTriangle className="h-4 w-4 mt-1" />
							<div className="ml-2">
								<AlertTitle className={atProjectLimit ? "text-destructive" : "text-blue-500"}>{atProjectLimit ? "You've built some great projects!" : "Approaching Project Limit"}</AlertTitle>
								<AlertDescription className="text-muted-foreground">
									{atProjectLimit
										? `You have used all of your available projects. Upgrade your plan to create more.`
										: `You have used ${subscription.usage.projects} of ${subscription.limits.projects} projects. Consider upgrading soon.`}
								</AlertDescription>
							</div>
						</div>
						<div className="flex items-center gap-x-2">
							<Button asChild size="sm">
								<Link href="/pricing">Upgrade</Link>
							</Button>
							<Button variant="outline" size="sm" onClick={() => setShowUsageAlert(false)} className="self-start">
								Dismiss
							</Button>
						</div>
					</div>
					<div className="mt-4 space-y-4">
						<div>
							<div className="flex justify-between text-sm text-muted-foreground">
								<span>Projects: {subscription.usage.projects} used</span>
								<span>{subscription.limits.projects} total</span>
							</div>
							<Progress value={getProjectUsagePercentage(subscription)} className="h-2 mt-1" />
						</div>
					</div>
				</Alert>
			)}

			<div className="flex justify-between items-center mb-4">
				<h1 className="text-2xl font-bold">Projects</h1>
				<div className="flex gap-2">
					<ProjectInvitations onInvitationAccepted={getProjects} defaultOpen={openInvites} />
					{projects.length > 0 && (
						atProjectLimit ? (
							<Button className="bg-blue-500 dark:text-card-foreground hover:bg-blue-600 dark:hover:bg-blue-400" disabled>
								<PlusCircle className="mr-2" />
								New Project
							</Button>
						) : (
							<Button asChild className="bg-blue-500 dark:text-card-foreground hover:bg-blue-600 dark:hover:bg-blue-400">
								<Link href="/projects/create">
									<PlusCircle className="mr-2" />
									New Project
								</Link>
							</Button>
						)
					)}
				</div>
			</div>

			{/* Search and Filters */}
			{projects.length > 0 && (
				<div className="mb-4 space-y-3">
					{/* Search Input */}
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							type="text"
							placeholder="Search projects by title or description..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9 max-w-md"
						/>
					</div>

					{/* Quick Filters */}
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm text-muted-foreground mr-1">Filter:</span>
						{(Object.keys(FILTER_CONFIG) as ProjectFilter[]).map((filterKey) => {
							const config = FILTER_CONFIG[filterKey];
							const Icon = config.icon;
							const isActive = activeFilters.has(filterKey);
							return (
								<button
									key={filterKey}
									onClick={() => toggleFilter(filterKey)}
									className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
										isActive
											? "bg-primary text-primary-foreground"
											: "bg-secondary text-secondary-foreground hover:bg-secondary/80"
									}`}
								>
									<Icon className="h-3.5 w-3.5" />
									{config.label}
								</button>
							);
						})}
						{hasActiveFilters && (
							<>
								<button
									onClick={clearAllFilters}
									className="inline-flex items-center gap-1 px-2 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
								>
									<X className="h-3.5 w-3.5" />
									Clear
								</button>
								<span className="text-sm text-muted-foreground ml-2">
									{filteredProjects.length} of {projects.length} project{projects.length !== 1 ? "s" : ""}
								</span>
							</>
						)}
					</div>
				</div>
			)}
			{isLoading ? (
				<div className="flex items-center justify-center py-12">
					<LoadingIndicator />
					<span className="ml-3 text-gray-600">Retrieving your projects...</span>
				</div>
			) : error ? (
				<div className="flex flex-col items-center justify-center py-12">
					<p className="text-red-500 mb-4">{error}</p>
					<Button onClick={getProjects} variant="outline">
						Try Again
					</Button>
				</div>
			) : projects.length === 0 ? (
				<EmptyState />
			) : filteredProjects.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
						<Search className="w-8 h-8 text-muted-foreground" />
					</div>
					<h3 className="text-lg font-semibold mb-2">No projects match your filters</h3>
					<p className="text-muted-foreground mb-4 max-w-md">
						{searchQuery.trim()
							? `No projects found matching "${searchQuery}"`
							: "No projects match the selected filters"}
					</p>
					<Button variant="outline" onClick={clearAllFilters}>
						<X className="mr-2 h-4 w-4" />
						Clear Filters
					</Button>
				</div>
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
					{/* New Project Card */}
					{!hasActiveFilters && (
						atProjectLimit ? (
							<Card className="h-64 border-2 border-dashed border-border/50 bg-secondary/30 flex flex-col items-center justify-center text-muted-foreground cursor-not-allowed">
								<div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
									<Plus className="w-6 h-6" />
								</div>
								<span className="font-medium">New Project</span>
								<span className="text-xs mt-1">Upgrade to create more</span>
							</Card>
						) : (
							<Link href="/projects/create">
								<Card className="h-64 border-2 border-dashed border-border/50 hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-all duration-300 cursor-pointer group">
									<div className="w-12 h-12 rounded-full bg-muted group-hover:bg-primary/10 flex items-center justify-center mb-3 transition-colors">
										<Plus className="w-6 h-6 group-hover:text-primary transition-colors" />
									</div>
									<span className="font-medium">New Project</span>
									<span className="text-xs mt-1 text-muted-foreground">Create a new research project</span>
								</Card>
							</Link>
						)
					)}
					{filteredProjects.map((project) => (
						<ProjectCard key={project.id} project={project} onProjectUpdate={getProjects} />
					))}
				</div>
			)}
		</div>
	);
}

export default function Projects() {
	return (
		<Suspense fallback={<div className="flex items-center justify-center py-12">
			<LoadingIndicator />
			<span className="ml-3 text-gray-600">Loading...</span>
		</div>}>
			<ProjectsPage />
		</Suspense>
	)
}
