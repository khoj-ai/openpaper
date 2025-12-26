"use client";

import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, Library, Loader2, MessageCircle, Pencil, PlusCircle, Send, Sparkles, UploadCloud } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchFromApi } from "@/lib/api";
import { ProjectRole } from "@/lib/schema";
import { PdfDropzone } from "@/components/PdfDropzone";
import PaperCard from "@/components/PaperCard";
import PdfUploadTracker from "@/components/PdfUploadTracker";
import { CitePaperButton } from "@/components/CitePaperButton";
import { MinimalJob } from "@/lib/schema";
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
import {
	Dialog,
	DialogHeader,
	DialogContent,
	DialogTitle,
	DialogTrigger,
	DialogDescription
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useSubscription, isPaperUploadAtLimit, isChatCreditAtLimit } from "@/hooks/useSubscription";
import { useProject, useProjectPapers, useProjectConversations } from "@/hooks/useProjects";
import { toast } from "sonner";
import ConversationCard from "@/components/ConversationCard";
import Artifacts from "@/components/Artifacts";
import { ProjectCollaborators } from "@/components/ProjectCollaborators";
import ProjectPageSkeleton from "@/components/ProjectPageSkeleton";
import { ConversationListSkeleton } from "@/components/ConversationListSkeleton";
import { PaperListSkeleton } from "@/components/PaperListSkeleton";

interface PdfUploadResponse {
	message: string;
	job_id: string;
}

export default function ProjectPage() {
	const params = useParams();
	const router = useRouter();
	const projectId = params.projectId as string;
	const { project, isLoading, error: projectError, refetch: refetchProject } = useProject(projectId);
	const { papers, isLoading: isPapersLoading, refetch: refetchPapers } = useProjectPapers(projectId);
	const { conversations, isLoading: isConversationsLoading, refetch: refetchConversations } = useProjectConversations(projectId);
	const [hasCollaborators, setHasCollaborators] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [initialJobs, setInitialJobs] = useState<MinimalJob[]>([]);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
	const [pdfUrl, setPdfUrl] = useState("");
	const [isUploading, setIsUploading] = useState(false);
	const [newQuery, setNewQuery] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [showEditAlert, setShowEditAlert] = useState(false);
	const [currentTitle, setCurrentTitle] = useState("");
	const [currentDescription, setCurrentDescription] = useState("");
	const [isAddPapersSheetOpen, setIsAddPapersSheetOpen] = useState(false);
	const [addPapersView, setAddPapersView] = useState<'initial' | 'upload' | 'library'>('initial');
	const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
	const [showAllOwnedPapers, setShowAllOwnedPapers] = useState(false);
	const [showAllOtherPapers, setShowAllOtherPapers] = useState(false);
	const { subscription } = useSubscription();

	const chatDisabled = isChatCreditAtLimit(subscription);

	useEffect(() => {
		if (chatDisabled) {
			toast.info("Nice! You have used your chat credits for the week. Upgrade your plan to use more.", {
				action: {
					label: "Upgrade",
					onClick: () => router.push("/pricing"),
				},
			});
		}
	}, [chatDisabled, router]);


	const handleDeleteConversation = async (conversationId: string) => {
		try {
			await fetchFromApi(`/api/conversation/${conversationId}`, {
				method: "DELETE",
			});
			refetchConversations();
		} catch (err) {
			setError("Failed to delete conversation. Please try again.");
			console.error(err);
		}
	};

	const handleFileSelect = async (files: File[]) => {
		if (isPaperUploadAtLimit(subscription)) {
			setUploadError("You have reached your paper upload limit. Please upgrade your plan to upload more papers.");
			return;
		}
		setUploadError(null);
		const newJobs: MinimalJob[] = [];
		if (files.length > 0) {
			setIsAddPapersSheetOpen(false);
			setIsUploadDialogOpen(false);
		}
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
		await fetchFromApi(`/api/projects/papers/${projectId}`, {
			method: "POST",
			body: JSON.stringify({ paper_ids: [paperId] }),
		});
		refetchPapers(); // Refresh project data
	}, [projectId, refetchPapers]);

	const handlePdfUrl = async (url: string) => {
		if (isPaperUploadAtLimit(subscription)) {
			setUploadError("You have reached your paper upload limit. Please upgrade your plan to upload more papers.");
			setIsUrlDialogOpen(false);
			return;
		}
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

	const handleNewQuery = async () => {
		if (!newQuery.trim()) return;

		setIsSubmitting(true);
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
			setIsSubmitting(false);
		}
	};

	const handleNewQuerySubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		handleNewQuery();
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleNewQuery();
		}
	};

	const handleUpdateProject = async () => {
		if (!project) return;
		try {
			const response = await fetchFromApi(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					title: currentTitle,
					description: currentDescription,
				}),
			});
			if (response) {
				refetchProject();
				setShowEditAlert(false);
			} else {
				console.error('Failed to update project');
			}
		} catch (error) {
			console.error('An error occurred while updating the project:', error);
		}
	};

	const handleEditClick = () => {
		if (!project) return;
		setCurrentTitle(project.title);
		setCurrentDescription(project.description || '');
		setShowEditAlert(true);
	};

	if (isLoading) {
		return <ProjectPageSkeleton />;
	}

	if (projectError || error) {
		return <div className="container mx-auto p-4 text-red-500">{projectError?.message || error}</div>;
	}

	if (!project) {
		return <div className="container mx-auto p-4">Project not found.</div>;
	}

	const isEmpty = !papers || (papers.length === 0 && (!conversations || conversations.length === 0));

	if (isEmpty) {
		return (
			<div className="container mx-auto p-4">

				<div className="group relative">
					<div className="flex items-center">
						<h1 className="text-3xl font-bold text-primary rounded-lg px-0">{project.title}</h1>
						{project.role !== ProjectRole.Viewer && (
							<Button
								variant="ghost"
								size="icon"
								className="opacity-0 group-hover:opacity-100 ml-2"
								onClick={handleEditClick}
							>
								<Pencil className="h-4 w-4" />
							</Button>
						)}
					</div>
					<p className="text-lg text-secondary-foreground mb-8">{project.description}</p>
				</div>

				<div className="mt-4">
					<PdfUploadTracker initialJobs={initialJobs} onComplete={handleUploadComplete} />
					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl font-bold">Add Papers to Your Project</h2>
						<Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
							<DialogTrigger asChild>
								<Button variant="outline">Upload New Papers</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Upload New Papers</DialogTitle>
									<DialogDescription>You can upload any additional papers to your library here. They will automatically be added to the project.</DialogDescription>
								</DialogHeader>
								<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} disabled={isPaperUploadAtLimit(subscription)} />
								{isPaperUploadAtLimit(subscription) && (
									<Alert variant="destructive" className="mt-4">
										<AlertCircle className="h-4 w-4" />
										<AlertTitle>Upload Limit Reached</AlertTitle>
										<AlertDescription>
											You have reached your paper upload limit. Please{" "}
											<Link href="/pricing" className="font-bold underline">
												upgrade your plan
											</Link>{" "}
											to upload more papers.
										</AlertDescription>
									</Alert>
								)}
								{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
							</DialogContent>
						</Dialog>
					</div>
					<AddFromLibrary projectId={projectId} onPapersAdded={refetchPapers} projectPaperIds={papers.map(p => p.id)} />
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
				<AlertDialog open={showEditAlert} onOpenChange={setShowEditAlert}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Edit Project</AlertDialogTitle>
							<AlertDialogDescription>
								Update the title and description for your project.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<div className="grid gap-4 py-4">
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor="title" className="text-right">
									Title
								</Label>
								<Input
									id="title"
									value={currentTitle}
									onChange={(e) => setCurrentTitle(e.target.value)}
									className="col-span-3"
								/>
							</div>
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor="description" className="text-right">
									Description
								</Label>
								<Input
									id="description"
									value={currentDescription}
									onChange={(e) => setCurrentDescription(e.target.value)}
									className="col-span-3"
								/>
							</div>
						</div>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction onClick={handleUpdateProject}>Save</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		)
	}

	return (
		<div className="container mx-auto p-4">
			<Breadcrumb className="mb-4">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{project.title}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<PdfUploadTracker initialJobs={initialJobs} onComplete={handleUploadComplete} />


			<div className="group relative">
				<div className="flex items-start justify-between gap-4">
					<div className="flex-1">
						<div className="flex items-center">
							<h1 className="text-3xl font-bold text-primary p-2 rounded-lg px-0">{project.title}</h1>
							{project.role !== ProjectRole.Viewer && (
								<Button
									variant="ghost"
									size="icon"
									className="opacity-0 group-hover:opacity-100 ml-2"
									onClick={handleEditClick}
								>
									<Pencil className="h-4 w-4" />
								</Button>
							)}
						</div>
						<p className="text-lg text-secondary-foreground mb-6">{project.description}</p>
					</div>
					<ProjectCollaborators
						projectId={projectId}
						setHasCollaborators={setHasCollaborators}
						currentUserIsAdmin={project.role === "admin"} />
				</div>
			</div>


			<div className="flex flex-col lg:flex-row gap-6 -mx-4">
				{/* Left side - Conversations */}
				<div className="w-full lg:w-2/3 px-4">
					{/* Conversation Input */}
					{project?.role !== 'viewer' && (
						<>
							{papers.length > 0 ? (
								<div className="mb-6">
									<form onSubmit={handleNewQuerySubmit} className="relative">
										<Textarea
											placeholder={chatDisabled ? "Nice! You have used your chat credits for the week. Upgrade your plan to use more." : "Ask a question about your papers, analyze findings, or explore new ideas..."}
											value={newQuery}
											onChange={(e) => {
												setNewQuery(e.target.value)
											}}
											onKeyDown={handleKeyDown}
											className="min-h-[80px] resize-none pr-12 border-none dark:border-none focus:border-blue-400 focus:ring-transparent bg-secondary dark:bg-accent text-primary"
											disabled={chatDisabled || isSubmitting}
										/>
										<Button
											type="submit"
											disabled={!newQuery.trim() || chatDisabled || isSubmitting}
											size="sm"
											className="absolute bottom-3 right-3 h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
										>
											{isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
						</>
					)}



					{/* Conversations List */}
					<div>
						{isConversationsLoading ? (
							<>
								<div className="flex justify-between items-center mb-4">
									<h2 className="text-2xl font-bold">Chats</h2>
								</div>
								<ConversationListSkeleton count={3} />
							</>
						) : conversations.length > 0 ? (
							<>
								<div className="flex justify-between items-center mb-4">
									<h2 className="text-2xl font-bold">Chats</h2>
								</div>
								{conversations.slice(0, 3).map((convo, index) => (
									<ConversationCard
										key={index}
										convo={convo}
										showAvatar={hasCollaborators}
										href={`/projects/${projectId}/conversations/${convo.id}`}
										onDelete={handleDeleteConversation} />
								))}
								{conversations.length > 3 && (
									<div className="mt-4 text-left">
										<Link href={`/project/${projectId}/past`}>
											View {conversations.length - 3} more
											<ArrowRight className="inline-block ml-1 h-4 w-4" />
										</Link>
									</div>
								)}
							</>
						) : (
							<div className="text-center p-12 rounded-xl">
								<div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
									<MessageCircle className="w-8 h-8 text-blue-400" />
								</div>
								<h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
									{papers.length > 0
										? "Start a conversation"
										: "Add papers to start"}
								</h3>
								<p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
									{papers.length > 0
										? "Ask a question about your papers to analyze findings, compare methodologies, or explore connections."
										: "Add papers to your project to begin exploring and discussing them."
									}
								</p>
							</div>
						)}
					</div>

					{/* Artifacts Section */}
					<Artifacts projectId={projectId} papers={papers} currentUserRole={project.role} />
				</div>

				{/* Right side - Papers */}
				<div className="w-full lg:w-1/3 px-4">
					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl font-bold">Papers</h2>
						<div className="flex gap-2">
							{papers.length > 0 && (
								<CitePaperButton paper={papers} minimalist={true} />
							)}
							{project?.role !== 'viewer' && (
								<Sheet open={isAddPapersSheetOpen} onOpenChange={(isOpen) => {
									setIsAddPapersSheetOpen(isOpen);
									if (!isOpen) {
										setAddPapersView('initial');
									}
								}}>
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
										<div className="mt-0 px-6">
											{addPapersView === 'initial' && (
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
													<button
														onClick={() => setAddPapersView('upload')}
														className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
													>
														<div className="relative">
															<UploadCloud className="w-12 h-12 text-gray-400 group-hover:text-blue-500 mb-4 transition-colors" />
															<div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
																<span className="text-xs font-medium text-blue-600 dark:text-blue-300"><PlusCircle className="h-4 w-4" /></span>
															</div>
														</div>
														<h3 className="text-lg font-semibold group-hover:text-blue-600 transition-colors">Upload New Papers</h3>
														<p className="text-sm text-gray-500 text-center mt-1">
															Upload PDFs from your computer or URL
														</p>
														<p className="text-xs mt-2 font-medium">
															Drag & drop or browse →
														</p>
													</button>
													<button
														onClick={() => setAddPapersView('library')}
														className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
													>
														<div className="relative">
															<Library className="w-12 h-12 text-gray-400 group-hover:text-blue-500 mb-4 transition-colors" />
															<div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
																<span className="text-xs font-medium text-blue-600 dark:text-blue-300"><BookOpen className="h-4 w-4" /></span>
															</div>
														</div>
														<h3 className="text-lg font-semibold group-hover:text-blue-600 transition-colors">Add from Library</h3>
														<p className="text-sm text-gray-500 text-center mt-1">
															Choose from papers already in your library
														</p>
														<p className="text-xs mt-2 font-medium">
															Browse existing papers →
														</p>
													</button>
												</div>
											)}

											{addPapersView === 'upload' && (
												<div>
													<Button variant="ghost" onClick={() => setAddPapersView('initial')} className="mb-4">
														<ArrowLeft className="mr-2 h-4 w-4" />
														Back
													</Button>
													<h3 className="text-lg font-semibold mb-2">Upload New Papers</h3>
													<p className="text-sm text-gray-500 mb-4">Upload papers to your library. They will be automatically added to this project.</p>
													<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} disabled={isPaperUploadAtLimit(subscription)} />
													{isPaperUploadAtLimit(subscription) && (
														<Alert variant="destructive" className="mt-4">
															<AlertCircle className="h-4 w-4" />
															<AlertTitle>Upload Limit Reached</AlertTitle>
															<AlertDescription>
																You have reached your paper upload limit. Please{" "}
																<Link href="/pricing" className="font-bold underline">
																	upgrade your plan
																</Link>{" "}
																to upload more papers.
															</AlertDescription>
														</Alert>
													)}
													{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
												</div>
											)}

											{addPapersView === 'library' && (
												<div>
													<Button variant="ghost" onClick={() => setAddPapersView('initial')} className="mb-4">
														<ArrowLeft className="mr-2 h-4 w-4" />
														Back
													</Button>
													<h3 className="text-lg font-semibold mb-2">Add from Library</h3>
													<AddFromLibrary projectId={projectId} onPapersAdded={refetchPapers} projectPaperIds={papers.map(p => p.id)} />
												</div>
											)}
										</div>
									</SheetContent>
								</Sheet>
							)}
						</div>
					</div>

					{isPapersLoading ? (
						<PaperListSkeleton count={3} />
					) : papers && papers.length > 0 ? (
						(() => {
							const ownedPapers = papers.filter(p => p.is_owner);
							const otherPapers = papers.filter(p => !p.is_owner);
							const papersToShow = 3;

							return (
								<div className="flex flex-col gap-6">
									{ownedPapers.length > 0 && (
										<div>
											{
												otherPapers.length > 0 && (
													<div className="mb-3">
														<Badge variant="secondary">Your Papers</Badge>
													</div>
												)
											}
											<div className="grid grid-cols-1 gap-4">
												{ownedPapers.slice(0, showAllOwnedPapers ? ownedPapers.length : papersToShow).map((paper) => (
													<div key={paper.id}>
														<PaperCard paper={paper} minimalist={true} projectId={projectId} onUnlink={refetchPapers} is_owner={paper.is_owner} />
													</div>
												))}
											</div>
											{ownedPapers.length > papersToShow && !showAllOwnedPapers && (
												<div className="mt-4 text-left">
													<Button variant="ghost" className="p-0 h-auto" onClick={() => setShowAllOwnedPapers(true)}>
														Show All {ownedPapers.length}
													</Button>
												</div>
											)}
										</div>
									)}

									{otherPapers.length > 0 && (
										<div>
											<div className="mb-3">
												<Badge variant="secondary">From Collaborators</Badge>
											</div>
											<div className="grid grid-cols-1 gap-4">
												{otherPapers.slice(0, showAllOtherPapers ? otherPapers.length : papersToShow).map((paper, index) => (
													<div key={paper.id} className="animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
														<PaperCard paper={paper} minimalist={true} projectId={projectId} onUnlink={refetchPapers} is_owner={paper.is_owner} />
													</div>
												))}
											</div>
											{otherPapers.length > papersToShow && !showAllOtherPapers && (
												<div className="mt-4 text-left">
													<Button variant="ghost" className="p-0 h-auto" onClick={() => setShowAllOtherPapers(true)}>
														Show All {otherPapers.length}
													</Button>
												</div>
											)}
										</div>
									)}
								</div>
							)
						})()
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
										<DialogDescription>You can upload any additional papers to your library here. They will automatically be added to the project.</DialogDescription>
									</DialogHeader>
									<PdfDropzone onFileSelect={handleFileSelect} onUrlClick={handleLinkClick} disabled={isPaperUploadAtLimit(subscription)} />
									{isPaperUploadAtLimit(subscription) && (
										<Alert variant="destructive" className="mt-4">
											<AlertCircle className="h-4 w-4" />
											<AlertTitle>Upload Limit Reached</AlertTitle>
											<AlertDescription>
												You have reached your paper upload limit. Please{" "}
												<Link href="/pricing" className="font-bold underline">
													upgrade your plan
												</Link>{" "}
												to upload more papers.
											</AlertDescription>
										</Alert>
									)}
									{uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
								</DialogContent>
							</Dialog>
						</div>
					)}

				</div>
			</div>

			<AlertDialog open={showEditAlert} onOpenChange={setShowEditAlert}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Edit Project</AlertDialogTitle>
						<AlertDialogDescription>
							Update the title and description for your project.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="title" className="text-right">
								Title
							</Label>
							<Input
								id="title"
								value={currentTitle}
								onChange={(e) => setCurrentTitle(e.target.value)}
								className="col-span-3"
							/>
						</div>
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="description" className="text-right">
								Description
							</Label>
							<Textarea
								id="description"
								value={currentDescription}
								onChange={(e) => setCurrentDescription(e.target.value)}
								className="col-span-3"
							/>
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleUpdateProject}>Save</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

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
