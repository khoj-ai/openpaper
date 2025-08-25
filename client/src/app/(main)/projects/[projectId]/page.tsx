"use client";

import { ArrowRight, Loader2, MessageCircle, PlusCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchFromApi } from "@/lib/api";
import { Project, PaperItem, Conversation } from "@/lib/schema";
import { PdfDropzone } from "@/components/PdfDropzone";
import PaperCard from "@/components/PaperCard";
import PdfUploadTracker, { MinimalJob } from "@/components/PdfUploadTracker";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AddFromLibrary from "@/components/AddFromLibrary";
import { formatDate } from "@/lib/utils";
import {
	Dialog,
	DialogHeader,
	DialogContent,
	DialogTitle,
	DialogTrigger,
	DialogDescription
} from "@/components/ui/dialog";

interface PdfUploadResponse {
	message: string;
	job_id: string;
}

export default function ProjectPage() {
	const params = useParams();
	const router = useRouter();
	const projectId = params.projectId as string;
	const [project, setProject] = useState<Project | null>(null);
	const [papers, setPapers] = useState<PaperItem[]>([]);
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [initialJobs, setInitialJobs] = useState<MinimalJob[]>([]);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
	const [pdfUrl, setPdfUrl] = useState("");
	const [isUploading, setIsUploading] = useState(false);
	const [newQuery, setNewQuery] = useState("");

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

	const getProjectConversations = useCallback(async () => {
		try {
			const fetchedConversations = await fetchFromApi(`/api/projects/conversations/${projectId}`);
			setConversations(fetchedConversations);
		} catch (err) {
			setError("Failed to fetch project conversations. Please try again.");
			console.error(err);
		}
	}, [projectId]);

	useEffect(() => {
		if (projectId) {
			getProject();
			getProjectPapers();
			getProjectConversations();
		}
	}, [projectId, getProject, getProjectPapers, getProjectConversations]);

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



	const handleNewQuerySubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newQuery.trim()) return;

		try {
			const newConversation = await fetchFromApi(`/api/projects/conversations/${projectId}`, {
				method: "POST",
				body: JSON.stringify({ title: "New Conversation" }),
			});
			localStorage.setItem(`pending-query-${newConversation.id}`, newQuery);
			router.push(`/projects/${projectId}/conversations/${newConversation.id}`);
		} catch (err) {
			setError("Failed to create a new conversation. Please try again.");
			console.error(err);
		}
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

	const isEmpty = !papers || (papers.length === 0 && (!conversations || conversations.length === 0));

	if (isEmpty) {
		return (
			<div className="container mx-auto p-4">
				<h1 className="text-3xl font-bold mb-2 text-gray-800 rounded-lg px-0">{project.title}</h1>
				<p className="text-lg text-gray-600 mb-8">{project.description}</p>
				<div className="mt-4">
					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl font-bold">Add Papers to Your Project</h2>
						<Dialog>
							<DialogTrigger asChild>
								<Button variant="outline">Upload New Papers</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Upload New Papers</DialogTitle>
								</DialogHeader>
								<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} />
								{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
							</DialogContent>
						</Dialog>
					</div>
					<AddFromLibrary projectId={projectId} onPapersAdded={getProjectPapers} projectPaperIds={papers.map(p => p.id)} />
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
			<h1 className="text-3xl font-bold mb-2 text-gray-800 dark:text-gray-200 p-2 rounded-lg px-0">{project.title}</h1>
			<p className="text-lg text-gray-600 mb-6">{project.description}</p>

			<div className="flex gap-6 -mx-4">
				{/* Left side - Conversations */}
				<div className="w-2/3 px-4">
					{/* Conversation Input */}
					{papers.length > 0 ? (
						<div className="mb-6">
							<form onSubmit={handleNewQuerySubmit} className="relative">
								<Textarea
									placeholder="Ask a question about your papers, analyze findings, or explore new ideas..."
									value={newQuery}
									onChange={(e) => setNewQuery(e.target.value)}
									className="min-h-[80px] resize-none pr-12 border-none dark:border-none focus:border-blue-400 focus:ring-transparent bg-secondary dark:bg-accent text-primary"
								/>
								<Button
									type="submit"
									disabled={!newQuery.trim()}
									size="sm"
									className="absolute bottom-3 right-3 h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
								>
									<Send className="w-4 h-4" />
								</Button>
							</form>
						</div>
					) : (
						<div className="mb-6 text-center p-8 border-dashed border-2 border-gray-300 rounded-xl bg-gray-50">
							<div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
								<MessageCircle className="w-8 h-8 text-gray-400" />
							</div>
							<h3 className="text-lg font-semibold text-gray-600 mb-2">Ready to Start Conversations</h3>
							<p className="text-gray-500">Add papers to your project to begin discussing and analyzing them.</p>
						</div>
					)}

					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl font-bold">Conversations</h2>
					</div>

					{/* Conversations List */}
					<div>
						{conversations.length > 0 ? (
							conversations.map((convo, index) => (
								<a href={`/projects/${projectId}/conversations/${convo.id}`} key={convo.id} className="block p-4 mb-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-shadow animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
									<div className="font-semibold text-blue-600 dark:text-blue-400 flex items-center justify-between">
										{convo.title}
										<ArrowRight className="w-4 h-4 text-gray-400 transform transition-transform group-hover:translate-x-1" />
									</div>
									<p>{formatDate(convo.updated_at)}</p>
								</a>
							))
						) : (
							<div className="text-center p-8 border-dashed border-2 border-gray-300 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800/50">
								<div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
									<MessageCircle className="w-8 h-8 text-blue-400" />
								</div>
								<h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No Conversations Yet</h3>
								<p className="text-gray-500 dark:text-gray-400 mb-4">
									{papers.length > 0
										? "Start discussing your papers by asking questions about findings, methodologies, or connections between studies."
										: "Add papers to your project first, then start conversations to analyze and explore them."
									}
								</p>
								{papers.length > 0 && (
									<div className="flex flex-col sm:flex-row gap-2 justify-center items-center text-sm text-gray-600 dark:text-gray-400">
										<div className="flex items-center gap-2">
											<div className="w-2 h-2 bg-blue-400 rounded-full"></div>
											<span>Ask about specific findings</span>
										</div>
										<div className="flex items-center gap-2">
											<div className="w-2 h-2 bg-green-400 rounded-full"></div>
											<span>Compare methodologies</span>
										</div>
										<div className="flex items-center gap-2">
											<div className="w-2 h-2 bg-purple-400 rounded-full"></div>
											<span>Explore connections</span>
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				</div>

				{/* Right side - Papers */}
				<div className="w-1/3 px-4">
					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl font-bold">Papers</h2>
						<Sheet>
							<SheetTrigger asChild>
								<Button variant="outline">
									<PlusCircle className="mr-2 h-4 w-4" />
									Add
								</Button>
							</SheetTrigger>
							<SheetContent className="sm:max-w-[90vw]! w-[90vw] overflow-y-auto">
								<SheetHeader className="px-6">
									<SheetTitle>Add Papers to Project</SheetTitle>
								</SheetHeader>
								<div className="mt-4 px-6">
									<h3 className="text-lg font-semibold mb-2">Upload New Papers</h3>
									<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} />
									{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
									<PdfUploadTracker initialJobs={initialJobs} onComplete={handleUploadComplete} />
									<h3 className="text-lg font-semibold mb-2">Add from Library</h3>
									<AddFromLibrary projectId={projectId} onPapersAdded={getProjectPapers} projectPaperIds={papers.map(p => p.id)} />
								</div>
							</SheetContent>
						</Sheet>
					</div>

					{papers && papers.length > 0 ? (
						<div className="grid grid-cols-1 gap-4">
							{papers.map((paper, index) => (
								<div key={paper.id} className="animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
									<PaperCard paper={paper} minimalist={true} projectId={projectId} onUnlink={getProjectPapers} />
								</div>
							))}
						</div>
					) : (
						<div className="text-center p-8 border-dashed border-2 border-gray-300 rounded-xl bg-gray-50">
							<div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
								<Sparkles className="w-8 h-8 text-gray-400" />
							</div>
							<h3 className="text-lg font-semibold text-gray-600 mb-2">No Papers Yet</h3>
							<p className="text-gray-500 mb-4">Add papers to start analyzing and discussing them.</p>
							<Dialog>
								<DialogTrigger asChild>
									<Button variant="outline">Upload Papers</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Upload New Papers</DialogTitle>
									</DialogHeader>
									<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} />
									{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
								</DialogContent>
							</Dialog>
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
