"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Project } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { PlusCircle, FolderOpen, Sparkles, Target, BookOpen, FileText } from "lucide-react";

export default function Projects() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

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
		getProjects();
	}, []);

	// Enhanced empty state component
	const EmptyState = () => (
		<div className="flex flex-col items-center justify-center py-12 px-4 text-center max-w-2xl mx-auto">
			<div className="relative mb-6">
				<div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-cyan-100 rounded-full flex items-center justify-center mb-4">
					<FolderOpen className="w-12 h-12 text-blue-600" />
				</div>
			</div>

			<h2 className="text-2xl font-semibold text-gray-900 mb-3">
				Ready to organize your research?
			</h2>

			<p className="text-gray-600 mb-8 leading-relaxed">
				Projects help you organize your library, get targeted AI assistance, and keep your research focused.
				Create your first project to make more use of your workspace.
			</p>

			<div className="grid md:grid-cols-3 gap-4 mb-8 w-full max-w-lg">
				<div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
					<Target className="w-6 h-6 text-blue-600 mb-2" />
					<h3 className="font-medium text-sm text-gray-900 mb-1">Stay Focused</h3>
					<p className="text-xs text-gray-600 text-center">Organize resources by topic or goal</p>
				</div>
				<div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
					<Target className="w-6 h-6 text-purple-600 mb-2" />
					<h3 className="font-medium text-sm text-gray-900 mb-1">Smart AI Help</h3>
					<p className="text-xs text-gray-600 text-center">Get context-aware assistance</p>
				</div>
				<div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
					<FileText className="w-6 h-6 text-green-600 mb-2" />
					<h3 className="font-medium text-sm text-gray-900 mb-1">Collate Research</h3>
					<p className="text-xs text-gray-600 text-center">Streamline literature reviews</p>
				</div>
			</div>

			<div className="flex flex-col sm:flex-row gap-3">
				<Button
					asChild
					className="bg-gradient-to-br from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 px-6"
					size="lg"
				>
					<Link href="/projects/create">
						<PlusCircle className="mr-2 w-5 h-5" />
						Create Your First Project
					</Link>
				</Button>
				<Button variant="outline" size="lg" className="px-6">
					<BookOpen className="mr-2 w-4 h-4" />
					Learn More
				</Button>
			</div>
		</div>
	);

	return (
		<div className="container mx-auto p-4">
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-2xl font-bold">Projects</h1>
				{projects.length > 0 && (
					<Button asChild className="bg-gradient-to-br from-blue-500 to-cyan-500">
						<Link href="/projects/create">
							<PlusCircle className="mr-2" />
							New Project
						</Link>
					</Button>
				)}
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-12">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
					<span className="ml-3 text-gray-600">Loading projects...</span>
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
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{projects.map((project) => (
						<ProjectCard key={project.id} project={project} onProjectUpdate={getProjects} />
					))}
				</div>
			)}
		</div>
	);
}
