"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchFromApi } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function CreateProjectPage() {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);

		try {
			const project = await fetchFromApi("/api/projects", {
				method: "POST",
				body: JSON.stringify({ title, description }),
			});
			router.push(`/projects/${project.id}`);
		} catch (err) {
			setError("Failed to create project. Please try again.");
			console.error(err);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="container mx-auto p-4 max-w-2xl">
			<h1 className="text-2xl font-bold mb-4">New Project</h1>
			<form onSubmit={handleSubmit}>
				<div className="grid w-full items-center gap-4">
					<div className="flex flex-col space-y-1.5">
						<Input
							id="title"
							placeholder="Project Title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							required
							className="text-lg"
						/>
					</div>
					<div className="flex flex-col space-y-1.5">
						<Textarea
							id="description"
							placeholder="Project Description (Optional)"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={5}
						/>
					</div>
					{error && <p className="text-red-500 text-sm">{error}</p>}
					<div className="flex justify-end gap-2">
						<Button variant="outline" asChild>
							<Link href="/projects">Cancel</Link>
						</Button>
						<Button type="submit" disabled={isLoading}>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creating...
								</>
							) : (
								"Create"
							)}
						</Button>
					</div>
				</div>
			</form>
		</div>
	);
}
