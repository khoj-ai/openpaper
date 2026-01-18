"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Loader2, CheckCircle, XCircle, AlertCircle, Table, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { DataTableJob, DataTableJobStatusResponse, JobStatusType, JobStatus } from "@/lib/schema";
import { formatDateTime } from "./utils/paperUtils";
import { fetchFromApi } from "@/lib/api";
import Link from "next/link";

interface DataTableGenerationJobCardProps {
    job: DataTableJob;
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
    const [isExpanded, setIsExpanded] = useState(false);
    const [liveData, setLiveData] = useState<DataTableJobStatusResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchLiveData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchFromApi(`/api/projects/tables/${job.id}`);
            setLiveData(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch job status');
        } finally {
            setIsLoading(false);
        }
    }, [job.id]);

    useEffect(() => {
        if (isExpanded && !liveData) {
            fetchLiveData();
        }
    }, [isExpanded, liveData, fetchLiveData]);

    // Poll for updates if job is running
    useEffect(() => {
        if (!isExpanded) return;

        const currentStatus = liveData?.status ?? job.status;
        if (currentStatus !== JobStatus.RUNNING && currentStatus !== JobStatus.PENDING) return;

        const interval = setInterval(fetchLiveData, 5000);
        return () => clearInterval(interval);
    }, [isExpanded, liveData?.status, job.status, fetchLiveData]);

    const currentStatus = liveData?.status ?? job.status;
    const isCompleted = currentStatus === JobStatus.COMPLETED && job.result_id;

    const handleCardClick = (e: React.MouseEvent) => {
        // Don't toggle if clicking on the link
        if ((e.target as HTMLElement).closest('a')) return;
        setIsExpanded(!isExpanded);
    };

    const CardContent = () => (
        <div className="w-full p-4 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    {currentStatus === JobStatus.COMPLETED ? <Table className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : getStatusIcon(currentStatus)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        {isCompleted && job.result_id ? (
                            <Link
                                href={`/projects/${projectId}/tables/${job.result_id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline mb-1"
                            >
                                {job.title || 'Data Table'}
                            </Link>
                        ) : (
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                                {job.title || 'Creating Data Table'}
                            </h3>
                        )}
                        <div className="flex items-center gap-2">
                            {isExpanded && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        fetchLiveData();
                                    }}
                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                    title="Refresh status"
                                >
                                    <RefreshCw className={`w-4 h-4 text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                            )}
                            {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-gray-500" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                            )}
                        </div>
                    </div>
                    {currentStatus !== JobStatus.COMPLETED && (
                        <p className={`text-xs font-medium mb-1 ${getStatusColor(currentStatus)}`}>
                            {getStatusText(currentStatus)}
                        </p>
                    )}
                    {job.created_at && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            <span>{formatDateTime(job.created_at)}</span>
                        </p>
                    )}
                    {currentStatus === JobStatus.RUNNING && (
                        <div className="mt-2">
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                                <div className="bg-blue-600 h-1 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                This may take a few minutes...
                            </p>
                        </div>
                    )}

                    {/* Expanded details */}
                    {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                            {error && (
                                <p className="text-xs text-red-500">{error}</p>
                            )}

                            {liveData && (
                                <>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <span className="text-gray-500 dark:text-gray-400">Status:</span>
                                            <span className={`ml-1 font-medium ${getStatusColor(liveData.status)}`}>
                                                {getStatusText(liveData.status)}
                                            </span>
                                        </div>
                                        {liveData.celery_status && currentStatus !== JobStatus.COMPLETED && currentStatus !== JobStatus.FAILED && (
                                            <div>
                                                <span className="text-gray-500 dark:text-gray-400">Task Status:</span>
                                                <span className="ml-1 font-medium text-gray-700 dark:text-gray-300">
                                                    {liveData.celery_status}
                                                </span>
                                            </div>
                                        )}
                                        {liveData.task_id && (
                                            <div>
                                                <span className="text-gray-500 dark:text-gray-400">Task ID:</span>
                                                <span className="ml-1 font-mono text-gray-700 dark:text-gray-300 truncate">
                                                    {liveData.task_id.slice(0, 8)}...
                                                </span>
                                            </div>
                                        )}
                                        {liveData.completed_at && (
                                            <div>
                                                <span className="text-gray-500 dark:text-gray-400">Completed:</span>
                                                <span className="ml-1 text-gray-700 dark:text-gray-300">
                                                    {formatDateTime(liveData.completed_at)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {liveData.celery_progress_message && (
                                        <div className="text-xs">
                                            <span className="text-gray-500 dark:text-gray-400">Progress:</span>
                                            <p className="mt-1 text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
                                                {liveData.celery_progress_message}
                                            </p>
                                        </div>
                                    )}

                                    {liveData.columns && liveData.columns.length > 0 && (
                                        <div className="text-xs">
                                            <span className="text-gray-500 dark:text-gray-400">Columns:</span>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {liveData.columns.map((col, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300"
                                                    >
                                                        {col}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {liveData.error_message && (
                                        <div className="text-xs">
                                            <span className="text-red-500 dark:text-red-400">Error:</span>
                                            <p className="mt-1 text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                                                {liveData.error_message}
                                            </p>
                                        </div>
                                    )}

                                    {isCompleted && job.result_id && (
                                        <Link
                                            href={`/projects/${projectId}/tables/${job.result_id}`}
                                            className="inline-block mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            View Table →
                                        </Link>
                                    )}
                                </>
                            )}

                            {isLoading && !liveData && (
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Loading job details...
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div onClick={handleCardClick}>
            <CardContent />
        </div>
    );
}
