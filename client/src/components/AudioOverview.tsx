import { fetchFromApi } from '@/lib/api';
import { Pause, Play } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import EnigmaticLoadingExperience from './EnigmaticLoadingExperience';
import { Badge } from '@/components/ui/badge';

interface AudioOverviewProps {
    paper_id: string;
}

interface AudioOverview {
    id: string;
    paper_id: string;
    audio_url: string;
    transcript: string;
    created_at: string;
    updated_at: string;
    job_id: string;
}

type JobStatusType = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface JobStatus {
    job_id: string;
    status: JobStatusType;
    paper_id: string;
}

// TODO: Add buttons to customize voice and additional instructions in the UI
interface AudioOverviewCreateRequestBody {
    additional_instructions?: string;
    voice?: string;
}

const audioOverviewLoadingText = [
    'Generating audio overview...',
    'Creating your audio summary...',
    'Summarizing the paper for you...',
    'Crafting your audio overview...',
    'Creating a sublime audio experience...',
    'Transforming text to audio...',
    'Converting paper to audio...',
]

export function AudioOverview({ paper_id }: AudioOverviewProps) {
    const [audioOverviewJobId, setAudioOverviewJobId] = useState<string | null>(null);
    const [audioOverview, setAudioOverview] = useState<AudioOverview | null>(null);
    const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState<string>(audioOverviewLoadingText[Math.floor(Math.random() * audioOverviewLoadingText.length)]);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // Check for existing audio overview on component mount
    useEffect(() => {
        checkExistingAudioOverview();
    }, [paper_id]);

    // Poll job status when a job is in progress
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (jobStatus && (jobStatus.status === 'pending' || jobStatus.status === 'running')) {
            interval = setInterval(() => {
                pollJobStatus();
                // Randomize loading text for each poll
                setLoadingText(audioOverviewLoadingText[Math.floor(Math.random() * audioOverviewLoadingText.length)]);
            }, 2000); // Poll every 2 seconds
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [jobStatus]);

    const checkExistingAudioOverview = async () => {
        try {
            const response: AudioOverview | null = await fetchFromApi(`/api/paper/audio/${paper_id}/file`);

            if (response) {
                setAudioOverview(response);
            } else {
                // No existing audio overview found
                setAudioOverview(null);
            }
        } catch (err) {
            console.error('Error checking existing audio overview:', err);
        }
    };

    const createAudioOverview = async () => {
        setIsLoading(true);
        setError(null);

        const body: AudioOverviewCreateRequestBody = {
            additional_instructions: 'Please summarize the key points of this paper.',
            voice: undefined
        }

        try {
            const response: JobStatus = await fetchFromApi(`/api/paper/audio?id=${paper_id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });

            if (response.job_id && response.status) {
                setJobStatus(response);
                setAudioOverviewJobId(response.job_id);
                setAudioOverview(null); // Clear existing audio overview while job is in progress
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const pollJobStatus = async () => {
        try {
            const response: JobStatus = await fetchFromApi(`/api/paper/audio/${paper_id}/status`);

            if (response.job_id && response.status) {
                console.log('Polling job status:', audioOverviewJobId);
                setJobStatus(response);

                // If job is completed, fetch the audio overview
                if (response.status === 'completed') {
                    await fetchAudioOverview();
                }
            } else {
                throw new Error('Failed to get job status');
            }
        } catch (err) {
            console.error('Error polling job status:', err);
            setError('Failed to get job status');
        }
    };

    const fetchAudioOverview = async () => {
        try {
            const response: AudioOverview = await fetchFromApi(`/api/paper/audio/${paper_id}/file`);

            if (response) {
                setAudioOverview(response);
                setJobStatus(null); // Clear job status since we have the result
            } else {
                throw new Error('Failed to fetch audio overview');
            }
        } catch (err) {
            console.error('Error fetching audio overview:', err);
            setError('Failed to fetch audio overview');
        }
    };

    const toggleAudioPlayback = () => {
        const audioElement = document.getElementById(`audio-${paper_id}`) as HTMLAudioElement;

        if (audioElement) {
            if (isPlaying) {
                audioElement.pause();
                setIsPlaying(false);
            } else {
                audioElement.play();
                setIsPlaying(true);
            }
        }
    };

    const handleAudioEnded = () => {
        setIsPlaying(false);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getStatusColor = (status: JobStatusType) => {
        switch (status) {
            case 'completed': return 'text-green-600';
            case 'running': return 'text-blue-600';
            case 'pending': return 'text-yellow-600';
            case 'failed': return 'text-red-600';
            case 'cancelled': return 'text-gray-600';
            default: return 'text-gray-600';
        }
    };


    return (
        <div className="rounded-lg p-6 h-full w-full">
            <h3 className="text-lg font-semibold mb-4">Audio Overview</h3>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {/* No audio overview exists */}
            {!audioOverview && !jobStatus && (
                <div className="text-center py-8">
                    <p className="text-secondary-foreground mb-4">
                        Generate an audio overview of this paper to listen to a summary.
                    </p>
                    <button
                        onClick={createAudioOverview}
                        disabled={isLoading}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2 rounded-lg font-medium"
                    >
                        {isLoading ? 'Creating...' : 'Generate Audio Overview'}
                    </button>
                </div>
            )}

            {/* Job in progress */}
            {jobStatus && !audioOverview && (
                <div className="text-center py-8">
                    <div className="inline-flex items-center space-x-2 mb-4">
                        {(jobStatus.status === 'pending' || jobStatus.status === 'running') && (
                            <EnigmaticLoadingExperience />
                        )}
                    </div>
                    <div className="text-lg font-semibold mb-2">
                        <span className={`font-medium ${getStatusColor(jobStatus.status)}`}>
                            Status: <Badge
                                variant="outline"
                                className={`text-xs ${getStatusColor(jobStatus.status)}`}
                            >
                                {jobStatus.status.charAt(0).toUpperCase() + jobStatus.status.slice(1)}
                            </Badge>
                        </span>
                    </div>
                    <p className="text-gray-600">
                        {jobStatus.status === 'pending' && 'Your audio overview is queued for processing...'}
                        {jobStatus.status === 'running' && loadingText}
                        {jobStatus.status === 'failed' && 'Audio overview generation failed. Please try again.'}
                    </p>
                    {jobStatus.status === 'failed' && (
                        <button
                            onClick={createAudioOverview}
                            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                        >
                            Try Again
                        </button>
                    )}
                </div>
            )}

            {/* Audio overview available */}
            {audioOverview && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                            Created: {formatDate(audioOverview.created_at)}
                        </div>
                        <button
                            onClick={createAudioOverview}
                            disabled={isLoading}
                            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                        >
                            Regenerate
                        </button>
                    </div>

                    {/* Audio player */}
                    <div className="bg-secondary rounded-lg p-4">
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={toggleAudioPlayback}
                                className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full"
                            >
                                {isPlaying ? (
                                    <Pause className="w-5 h-5" fill="currentColor" />
                                ) : (
                                    <Play className="w-5 h-5" fill="currentColor" />
                                )}
                            </button>
                            <div className="flex-1">
                                <div className="text-sm font-medium text-secondary-foreground">Audio Overview</div>
                                <div className="text-sm text-secondary-foreground">Click to {isPlaying ? 'pause' : 'play'}</div>
                            </div>
                        </div>

                        <audio
                            id={`audio-${paper_id}`}
                            src={audioOverview.audio_url}
                            onEnded={handleAudioEnded}
                            controls
                            className="w-full mt-4"
                        />
                    </div>

                    {/* Transcript */}
                    {audioOverview.transcript && (
                        <div className="space-y-2">
                            <h4 className="font-medium text-secondary-foreground">Transcript</h4>
                            <div className="bg-secondary rounded-lg p-4">
                                <p className="text-sm text-secondary-foreground whitespace-pre-wrap">
                                    {audioOverview.transcript}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
