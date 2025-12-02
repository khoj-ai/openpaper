import React, { useState, useEffect } from 'react';
import { fetchFromApi } from "@/lib/api";
import { JobStatusResponse, JobStatusType, MinimalJob } from "@/lib/schema";
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface Job extends MinimalJob {
	status: JobStatusType;
	details?: JobStatusResponse;
	paperId?: string;
}

interface PdfUploadTrackerProps {
	initialJobs: MinimalJob[];
	onComplete: (paperId: string) => void;
}

const PdfUploadTracker: React.FC<PdfUploadTrackerProps> = ({ initialJobs, onComplete }) => {
	const [jobs, setJobs] = useState<Job[]>([]);

	useEffect(() => {
		setJobs(prevJobs => {
			const newJobs = initialJobs.filter(ij => !prevJobs.some(pj => pj.jobId === ij.jobId));
			return [...prevJobs, ...newJobs.map(j => ({ ...j, status: 'pending' as JobStatusType }))];
		});
	}, [initialJobs]);

	useEffect(() => {
		if (jobs.length === 0) return;

		const interval = setInterval(async () => {
			let hasPendingJobs = false;
			for (const job of jobs) {
				if (job.status === 'pending' || job.status === 'running') {
					hasPendingJobs = true;
					try {
						const statusResponse: JobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${job.jobId}`);
						setJobs(prevJobs => prevJobs.map(j => j.jobId === job.jobId ? {
							...j,
							status: statusResponse.status,
							details: statusResponse,
							paperId: statusResponse.paper_id || j.paperId
						} : j));

						if (statusResponse.status === "completed" && statusResponse.paper_id) {
							onComplete(statusResponse.paper_id);
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
	}, [jobs, onComplete]);

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
