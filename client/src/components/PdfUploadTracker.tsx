import React, { useState, useEffect, useRef } from 'react';
import { fetchFromApi } from "@/lib/api";
import { PaperUploadJobStatusResponse, JobStatusType, MinimalJob } from "@/lib/schema";
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface Job extends MinimalJob {
	status: JobStatusType;
	details?: PaperUploadJobStatusResponse;
	paperId?: string;
}

interface PdfUploadTrackerProps {
	initialJobs: MinimalJob[];
	onComplete: (paperId: string) => void;
}

// Track jobs that have already triggered onComplete - persists across component remounts
// This prevents the infinite loop: complete -> refetch -> unmount -> remount -> complete again
// Also stores paperId so we can restore full job state on remount
const completedJobs = new Map<string, string>(); // jobId -> paperId

const PdfUploadTracker: React.FC<PdfUploadTrackerProps> = ({ initialJobs, onComplete }) => {
	const [jobs, setJobs] = useState<Job[]>([]);
	const jobsRef = useRef<Job[]>(jobs);
	const onCompleteRef = useRef(onComplete);

	// Keep refs in sync with current values
	useEffect(() => {
		jobsRef.current = jobs;
	}, [jobs]);

	useEffect(() => {
		onCompleteRef.current = onComplete;
	}, [onComplete]);

	useEffect(() => {
		setJobs(prevJobs => {
			const newJobs = initialJobs.filter(ij => !prevJobs.some(pj => pj.jobId === ij.jobId));
			return [...prevJobs, ...newJobs.map(j => {
				// If this job already completed, restore its completed status and paperId
				const completedPaperId = completedJobs.get(j.jobId);
				return {
					...j,
					status: completedPaperId ? 'completed' as JobStatusType : 'pending' as JobStatusType,
					paperId: completedPaperId
				};
			})];
		});
	}, [initialJobs]);

	useEffect(() => {
		const interval = setInterval(async () => {
			const currentJobs = jobsRef.current;
			if (currentJobs.length === 0) return;

			let hasPendingJobs = false;
			for (const job of currentJobs) {
				// Skip jobs that have already completed (including across remounts)
				if (completedJobs.has(job.jobId)) continue;

				if (job.status === 'pending' || job.status === 'running') {
					hasPendingJobs = true;
					try {
						const statusResponse: PaperUploadJobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${job.jobId}`);
						setJobs(prevJobs => prevJobs.map(j => j.jobId === job.jobId ? {
							...j,
							status: statusResponse.status,
							details: statusResponse,
							paperId: statusResponse.paper_id || j.paperId
						} : j));

						if (statusResponse.status === "completed" && statusResponse.paper_id) {
							// Mark as completed before calling onComplete to prevent duplicate calls
							completedJobs.set(job.jobId, statusResponse.paper_id);
							onCompleteRef.current(statusResponse.paper_id);
						}
					} catch (err) {
						console.error(`Failed to get upload status for ${job.fileName}.`, err);
						setJobs(prevJobs => prevJobs.map(j => j.jobId === job.jobId ? { ...j, status: 'failed' } : j));
					}
				}
			}
			if (!hasPendingJobs) {
				clearInterval(interval);
			}
		}, 2000);

		return () => clearInterval(interval);
	}, []);

	return (
		<div className="w-full overflow-hidden">
			{jobs.map(job => (
				<div key={job.jobId} className="w-full p-4 my-2 border rounded-lg flex items-center justify-between overflow-hidden">
					<div className="flex-1 min-w-0 mr-4 overflow-hidden">
						{job.status === 'completed' && job.paperId ? (
							<Link
								href={`/paper/${job.paperId}`}
								className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 hover:underline cursor-pointer block truncate break-all"
								title={job.fileName}
							>
								{job.fileName}
							</Link>
						) : (
							<span className="text-sm font-medium block truncate break-all" title={job.fileName}>
								{job.fileName}
							</span>
						)}
					</div>
					{(() => {
						switch (job.status) {
							case 'pending':
							case 'running':
								return (
									<div className="flex items-center">
										<div className="w-4 h-4 border-2 border-t-transparent border-blue-500 rounded-full animate-spin" />
										<span className="ml-2 text-sm capitalize">{job.status}</span>
									</div>
								);
							case 'completed':
								return (
									<div className="flex items-center text-green-500">
										<CheckCircle2 className="w-4 h-4" />
										<span className="ml-2 text-sm capitalize">{job.status}</span>
									</div>
								);
							case 'failed':
								return <span className="text-sm text-red-500">Failed</span>;
							default:
								return <span className="text-sm text-gray-500 capitalize">{job.status}</span>;
						}
					})()}
				</div>
			))}
		</div>
	);
};

export default PdfUploadTracker;
