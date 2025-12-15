"use client";

import { Clock, Loader2, CheckCircle, XCircle, AlertCircle, Table } from "lucide-react";
import { DataTableJobStatusResponse, JobStatusType, JobStatus } from "@/lib/schema";
import { formatDateTime } from "./utils/paperUtils";
import Link from "next/link";

interface DataTableGenerationJobCardProps {
    job: DataTableJobStatusResponse;
    projectId: string;
}

const getStatusIcon = (status: JobStatusType) => {
    switch (status) {
        case JobStatus.PENDING:
            return <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />;
        case JobStatus.RUNNING:
            return <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />;
        case JobStatus.COMPLETED:
            return <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />;
        case JobStatus.FAILED:
            return <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />;
        case JobStatus.CANCELLED:
            return <AlertCircle className="w-5 h-5 text-gray-600 dark:text-gray-400" />;
        default:
            return <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />;
    }
};

const getStatusText = (status: JobStatusType) => {
    switch (status) {
        case JobStatus.PENDING:
            return 'Queued';
        case JobStatus.RUNNING:
            return 'Generating...';
        case JobStatus.COMPLETED:
            return 'Completed';
        case JobStatus.FAILED:
            return 'Failed';
        case JobStatus.CANCELLED:
            return 'Cancelled';
        default:
            return status.charAt(0).toUpperCase() + status.slice(1);
    }
};

const getStatusColor = (status: JobStatusType) => {
    switch (status) {
        case JobStatus.PENDING:
            return 'text-yellow-600 dark:text-yellow-400';
        case JobStatus.RUNNING:
            return 'text-blue-600 dark:text-blue-400';
        case JobStatus.COMPLETED:
            return 'text-green-600 dark:text-green-400';
        case JobStatus.FAILED:
            return 'text-red-600 dark:text-red-400';
        case JobStatus.CANCELLED:
            return 'text-gray-600 dark:text-gray-400';
        default:
            return 'text-gray-600 dark:text-gray-400';
    }
};

export default function DataTableGenerationJobCard({ job, projectId }: DataTableGenerationJobCardProps) {
    const CardContent = () => (
        <div className="w-full p-4 border rounded-lg">
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    {job.status === JobStatus.COMPLETED ? <Table className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : getStatusIcon(job.status)}
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                        {job.title || 'Creating Data Table'}
                    </h3>
                    {job.status !== JobStatus.COMPLETED && (
                        <p className={`text-xs font-medium mb-1 ${getStatusColor(job.status)}`}>
                            {getStatusText(job.status)}
                        </p>
                    )}
                    {job.celery_progress_message && job.status === JobStatus.RUNNING && (
                        <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                            {job.celery_progress_message}
                        </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        <span>{formatDateTime(job.created_at)}</span>
                    </p>
                    {job.status === JobStatus.RUNNING && (
                        <div className="mt-2">
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                                <div className="bg-blue-600 h-1 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                This may take a few minutes...
                            </p>
                        </div>
                    )}
                    {job.status === JobStatus.COMPLETED && job.result_id && (
                        <Link
                            href={`/projects/${projectId}/tables/${job.result_id}`}
                            className="inline-block mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            View Data Table →
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );

    if (job.status === JobStatus.COMPLETED && job.result_id) {
        return (
            <Link href={`/projects/${projectId}/tables/${job.result_id}`}>
                <CardContent />
            </Link>
        );
    }

    return <CardContent />;
}
