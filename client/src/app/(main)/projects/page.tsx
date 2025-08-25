
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Project } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { PlusCircle } from "lucide-react";

export default function Projects() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const getProjects = async () => {
		try {
			const fetchedProjects = await fetchFromApi("/api/projects");
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

	return (
		<div className="container mx-auto p-4">
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-2xl font-bold">Projects</h1>
				<Button asChild className="bg-gradient-to-br from-blue-500 to-cyan-500">
					<Link href="/projects/create">
						<PlusCircle className="mr-2" />
						New Project
					</Link>
				</Button>
			</div>
			{isLoading ? (
				<p>Loading projects...</p>
			) : error ? (
				<p className="text-red-500">{error}</p>
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
