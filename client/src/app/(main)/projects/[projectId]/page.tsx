"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { fetchFromApi } from "@/lib/api";
import { Project, PaperItem } from "@/lib/schema";
import { PdfDropzone } from "@/components/PdfDropzone";
import PaperCard from "@/components/PaperCard";
import PdfUploadTracker, { MinimalJob } from "@/components/PdfUploadTracker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AddFromLibrary from "@/components/AddFromLibrary";

interface PdfUploadResponse {
	message: string;
	job_id: string;
}

export default function ProjectPage() {
	const params = useParams();
	const projectId = params.projectId as string;
	const [project, setProject] = useState<Project | null>(null);
	const [papers, setPapers] = useState<PaperItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [initialJobs, setInitialJobs] = useState<MinimalJob[]>([]);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
	const [pdfUrl, setPdfUrl] = useState("");
	const [isUploading, setIsUploading] = useState(false);

	const getProject = useCallback(async () => {
		try {
			const fetchedProject = await fetchFromApi(`/api/projects/${projectId}`);
			setProject(fetchedProject);
		} catch (err) {
			setError("Failed to fetch project. Please try again.");
			console.error(err);
		} finally {
			setIsLoading(false);
		}
	}, [projectId]);

	const getProjectPapers = useCallback(async () => {
		try {
			const fetchedPapers = await fetchFromApi(`/api/projects/papers/${projectId}`);
			setPapers(fetchedPapers.papers);
		} catch (err) {
			setError("Failed to fetch project papers. Please try again.");
			console.error(err);
		}
	}, [projectId]);

	useEffect(() => {
		if (projectId) {
			getProject();
			getProjectPapers();
		}
	}, [projectId, getProject, getProjectPapers]);

	const handleFileSelect = async (files: File[]) => {
		setUploadError(null);
		const newJobs: MinimalJob[] = [];
		for (const file of files) {
			const formData = new FormData();
			formData.append("file", file);

			try {
				const response = await fetchFromApi(`/api/paper/upload?project_id=${projectId}`, {
					method: "POST",
					body: formData,
				});
				newJobs.push({ jobId: response.job_id, fileName: file.name });
			} catch (err) {
				setUploadError(`Failed to upload file: ${file.name}. Please try again.`);
				console.error(err);
			}
		}
		setInitialJobs(newJobs);
	};

	const handleUploadComplete = useCallback(async (paperId: string) => {
		await fetchFromApi(`/api/project/${projectId}/papers`, {
			method: "POST",
			body: JSON.stringify({ paper_ids: [paperId] }),
		});
		getProjectPapers(); // Refresh project data
	}, [projectId, getProjectPapers]);

	const handlePdfUrl = async (url: string) => {
		setIsUploading(true);
		try {
			// Fallback to server-side fetch
			const response: PdfUploadResponse = await fetchFromApi('/api/paper/upload/from-url', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ url, project_id: projectId }),
			});
			setInitialJobs([{ jobId: response.job_id, fileName: url }]);
		} catch (serverError) {
			console.error('Both client and server-side fetches failed:', serverError);
			setUploadError(`Failed to upload file from url: ${url}. Please try again.`);
		} finally {
			setIsUploading(false);
			setIsUrlDialogOpen(false);
		}
	};

	const handleLinkClick = () => {
		setIsUrlDialogOpen(true);
	};

	const handleDialogConfirm = async () => {
		if (pdfUrl) {
			await handlePdfUrl(pdfUrl);
		}
		setIsUrlDialogOpen(false);
		setPdfUrl("");
	};


	if (isLoading) {
		return <div className="container mx-auto p-4">Loading project...</div>;
	}

	if (error) {
		return <div className="container mx-auto p-4 text-red-500">{error}</div>;
	}

	if (!project) {
		return <div className="container mx-auto p-4">Project not found.</div>;
	}

	const conversations: { id: number; title: string }[] = [
		// { id: 1, title: "Conversation about paper A" },
		// { id: 2, title: "Summary of paper B" },
		// { id: 3, title: "Questions on paper C" },
	];

	const isEmpty = papers.length === 0 && conversations.length === 0;

	if (isEmpty) {
		return (
			<div className="container mx-auto p-4">
				<h1 className="text-3xl font-bold mb-2 text-gray-800 rounded-lg">{project.title}</h1>
				<p className="text-lg text-gray-600 mb-8">{project.description}</p>
				<div className="mt-4">
					<h2 className="text-2xl font-bold mb-4">Add Papers to Your Project</h2>
					<AddFromLibrary projectId={projectId} onPapersAdded={getProjectPapers} />
					<div className="my-4">
						<div className="relative">
							<div className="absolute inset-0 flex items-center">
								<span className="w-full border-t" />
							</div>
							<div className="relative flex justify-center text-xs uppercase">
								<span className="bg-background px-2 text-muted-foreground">
									Or
								</span>
							</div>
						</div>
					</div>
					<h3 className="text-lg font-semibold mb-2">Upload New Papers</h3>
					<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} />
					{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
					<PdfUploadTracker initialJobs={initialJobs} onComplete={handleUploadComplete} />
				</div>
				<Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Import PDF from URL</DialogTitle>
							<DialogDescription>
								Enter the public URL of the PDF you want to upload.
							</DialogDescription>
						</DialogHeader>
						<Input
							type="url"
							placeholder="https://arxiv.org/pdf/1706.03762v7"
							value={pdfUrl}
							onChange={(e) => setPdfUrl(e.target.value)}
							className="mt-4"
						/>
						<div className="flex justify-end gap-2 mt-4">
							<Button variant="secondary" onClick={() => setIsUrlDialogOpen(false)}>
								Cancel
							</Button>
							<Button onClick={handleDialogConfirm} disabled={!pdfUrl || isUploading}>
								{isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
								Submit
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		)
	}

	return (
		<div className="container mx-auto p-4">
			<h1 className="text-3xl font-bold mb-2 text-gray-800 p-2 rounded-lg">{project.title}</h1>
			<p className="text-lg text-gray-600 mb-8">{project.description}</p>

			<div className="flex -mx-4">
				{/* Left Sidebar: Created Assets */}
				{
					conversations.length > 0 && (
						<div className="w-2/3 px-4">
							<h2 className="text-2xl font-bold mb-4">Created Assets</h2>
							<div>
								{conversations.map((convo, index) => (
									<a href="#" key={convo.id} className="block p-4 mb-4 border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
										<div className="font-semibold text-blue-600 flex items-center justify-between">
											{convo.title}
											<ArrowRight className="w-4 h-4 text-gray-400 transform transition-transform group-hover:translate-x-1" />
										</div>
									</a>
								))}
							</div>
						</div>
					)
				}

				{/* Right Sidebar: Papers and Upload */}
				<div className="w-1/3 px-4">
					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl font-bold">Papers</h2>
						<Dialog>
							<DialogTrigger asChild>
								<Button variant="outline">Add more</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Add Papers to Project</DialogTitle>
								</DialogHeader>
								<div className="mt-4">
									<h3 className="text-lg font-semibold mb-2">Upload New Papers</h3>
									<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} />
									{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
									<PdfUploadTracker initialJobs={initialJobs} onComplete={handleUploadComplete} />
									<div className="my-4">
										<div className="relative">
											<div className="absolute inset-0 flex items-center">
												<span className="w-full border-t" />
											</div>
											<div className="relative flex justify-center text-xs uppercase">
												<span className="bg-background px-2 text-muted-foreground">
													Or
												</span>
											</div>
										</div>
									</div>
									<h3 className="text-lg font-semibold mb-2">Add from Library</h3>
									<AddFromLibrary projectId={projectId} onPapersAdded={getProjectPapers} />
								</div>
							</DialogContent>
						</Dialog>
					</div>

					{papers && papers.length > 0 && (
						<div className="grid grid-cols-1 gap-4">
							{papers.map((paper, index) => (
								<div key={paper.id} className="animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
									<PaperCard paper={paper} minimalist={true} />
								</div>
							))}
						</div>
					)}
				</div>
			</div>
			<Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Import PDF from URL</DialogTitle>
						<DialogDescription>
							Enter the public URL of the PDF you want to upload.
						</DialogDescription>
					</DialogHeader>
					<Input
						type="url"
						placeholder="https://arxiv.org/pdf/1706.03762v7"
						value={pdfUrl}
						onChange={(e) => setPdfUrl(e.target.value)}
						className="mt-4"
					/>
					<div className="flex justify-end gap-2 mt-4">
						<Button variant="secondary" onClick={() => setIsUrlDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleDialogConfirm} disabled={!pdfUrl || isUploading}>
							{isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
							Submit
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
