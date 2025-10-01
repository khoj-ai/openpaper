"use client";

import { Clock, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { AudioOverviewJob } from "@/lib/schema";
import { formatDateTime } from "./utils/paperUtils";

interface AudioOverviewGenerationJobCardProps {
    job: AudioOverviewJob;
}

const getStatusIcon = (status: string) => {
    switch (status) {
        case 'pending':
            return <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />;
        case 'running':
            return <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />;
        case 'completed':
            return <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />;
        case 'failed':
            return <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />;
        case 'cancelled':
            return <AlertCircle className="w-5 h-5 text-gray-600 dark:text-gray-400" />;
        default:
            return <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />;
    }
};

const getStatusText = (status: string) => {
    switch (status) {
        case 'pending':
            return 'Queued';
        case 'running':
            return 'Generating...';
        case 'completed':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'cancelled':
            return 'Cancelled';
        default:
            return status.charAt(0).toUpperCase() + status.slice(1);
    }
};

const getStatusColor = (status: string) => {
    switch (status) {
        case 'pending':
            return 'text-yellow-600 dark:text-yellow-400';
        case 'running':
            return 'text-blue-600 dark:text-blue-400';
        case 'completed':
            return 'text-green-600 dark:text-green-400';
        case 'failed':
            return 'text-red-600 dark:text-red-400';
        case 'cancelled':
            return 'text-gray-600 dark:text-gray-400';
        default:
            return 'text-gray-600 dark:text-gray-400';
    }
};

export default function AudioOverviewGenerationJobCard({ job }: AudioOverviewGenerationJobCardProps) {

    return (
        <div className="w-full p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                    {getStatusIcon(job.status)}
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                        Creating Audio Overview
                    </h3>
                    <p className={`text-xs font-medium mb-1 ${getStatusColor(job.status)}`}>
                        {getStatusText(job.status)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {job.completed_at ? (
                            <span>Completed at {formatDateTime(job.completed_at)}</span>
                        ) : (
                            <span>Started at {formatDateTime(job.started_at)}</span>
                        )}
                    </p>
                    {job.status === 'running' && (
                        <div className="mt-2">
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                                <div className="bg-blue-600 h-1 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                This may take a few minutes...
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
