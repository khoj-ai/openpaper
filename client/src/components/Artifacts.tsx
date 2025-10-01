"use client";

import { Loader2, Pause, Play, Volume2 } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { fetchFromApi } from "@/lib/api";
import { AudioOverview, PaperItem, AudioOverviewJob } from "@/lib/schema";
import AudioOverviewGenerationJobCard from "@/components/AudioOverviewGenerationJobCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogHeader,
    DialogContent,
    DialogTitle,
    DialogTrigger,
    DialogDescription
} from "@/components/ui/dialog";
import { AnimatedMarkdown } from "./AnimatedMarkdown";
import { RichAudioOverview } from "./RichAudioOverview";

interface ArtifactsProps {
    projectId: string;
    papers: PaperItem[];
}

export default function Artifacts({ projectId, papers }: ArtifactsProps) {
    const [audioInstructions, setAudioInstructions] = useState("");
    const [isCreatingAudio, setIsCreatingAudio] = useState(false);
    const [audioOverviews, setAudioOverviews] = useState<AudioOverview[]>([]);
    const [audioJobs, setAudioJobs] = useState<AudioOverviewJob[]>([]);
    const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
    const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
    const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
    const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

    const getProjectAudioOverviews = useCallback(async () => {
        try {
            const fetchedAudioOverviews = await fetchFromApi(`/api/projects/audio/${projectId}`);
            setAudioOverviews(fetchedAudioOverviews);
        } catch (err) {
            console.error("Failed to fetch audio overviews:", err);
            // Don't set error state for audio overviews as it's not critical
        }
    }, [projectId]);

    const getProjectAudioJobs = useCallback(async () => {
        try {
            const fetchedJobs = await fetchFromApi(`/api/projects/audio/jobs/${projectId}`);
            setAudioJobs(fetchedJobs);
            return fetchedJobs;
        } catch (err) {
            console.error("Failed to fetch audio jobs:", err);
            return [];
        }
    }, [projectId]);

    // const startPolling = useCallback(() => {
    //     if (pollingInterval) {
    //         clearInterval(pollingInterval);
    //     }

    //     const interval = setInterval(async () => {
    //         const jobs = await getProjectAudioJobs();
    //         const hasPendingJobs = jobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');

    //         if (!hasPendingJobs) {
    //             // No more pending jobs, stop polling and refresh overviews
    //             clearInterval(interval);
    //             setPollingInterval(null);
    //             getProjectAudioOverviews();
    //         }
    //     }, 20000); // Poll every 20 seconds

    //     setPollingInterval(interval);
    // }, [pollingInterval, getProjectAudioJobs, getProjectAudioOverviews]);

    const stopPolling = useCallback(() => {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
        }
    }, [pollingInterval]);

    useEffect(() => {
        if (projectId) {
            getProjectAudioOverviews();
            getProjectAudioJobs().then(jobs => {
                const hasPendingJobs = jobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
                if (hasPendingJobs) {
                    // startPolling();
                }
            });
        }

        // Cleanup polling on unmount
        return () => {
            stopPolling();
        };
    }, [projectId, getProjectAudioOverviews, getProjectAudioJobs, stopPolling]);

    const handleCreateAudioOverview = async () => {
        setIsCreatingAudio(true);
        try {
            const requestData = {
                additional_instructions: audioInstructions.trim() || null
            };

            await fetchFromApi(`/api/projects/audio/${projectId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestData),
            });

            setAudioInstructions("");
            // Fetch jobs and start polling
            const jobs = await getProjectAudioJobs();
            const hasPendingJobs = jobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
            if (hasPendingJobs) {
                // startPolling();
            }
        } catch (err) {
            console.error("Failed to create audio overview:", err);
            // You could add error handling here
        } finally {
            setIsCreatingAudio(false);
        }
    };

    const handlePlayAudio = async (audioOverviewId: string) => {
        try {
            // If this audio is currently playing, pause it
            if (playingAudioId === audioOverviewId && currentAudio) {
                currentAudio.pause();
                setPlayingAudioId(null);
                return;
            }

            // Stop any currently playing audio
            if (currentAudio) {
                currentAudio.pause();
                setPlayingAudioId(null);
            }

            setLoadingAudioId(audioOverviewId);

            // Fetch detailed audio overview data
            const detailedOverview = await fetchFromApi(`/api/projects/audio/file/${projectId}/${audioOverviewId}`);

            if (detailedOverview.audio_url) {
                const audio = new Audio(detailedOverview.audio_url);

                audio.onloadstart = () => setLoadingAudioId(audioOverviewId);
                audio.oncanplay = () => setLoadingAudioId(null);
                audio.onplay = () => setPlayingAudioId(audioOverviewId);
                audio.onpause = () => setPlayingAudioId(null);
                audio.onended = () => {
                    setPlayingAudioId(null);
                    setCurrentAudio(null);
                };
                audio.onerror = () => {
                    setLoadingAudioId(null);
                    setPlayingAudioId(null);
                    console.error('Failed to load audio');
                };

                setCurrentAudio(audio);
                audio.play();
            }
        } catch (err) {
            console.error("Failed to fetch audio details:", err);
            setLoadingAudioId(null);
        }
    };

    return (
        <div className="mt-8">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Artifacts</h2>
            </div>

            <div className="flex flex-wrap gap-3">
                <Dialog>
                    <DialogTrigger asChild>
                        <button
                            disabled={papers.length === 0}
                            className="flex flex-col items-center justify-center p-3 border-2 border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed aspect-square w-1/4"
                        >
                            <Volume2 className="w-6 h-6 text-gray-400 group-hover:text-blue-500 mb-1 transition-colors" />
                            <span className="text-xs font-medium text-center leading-tight">Audio Overview</span>
                        </button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create an Audio Overview</DialogTitle>
                            <DialogDescription>
                                Generate an audio overview of your project papers. Add custom instructions to guide the content.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="mt-4">
                            <Label htmlFor="audio-instructions" className="text-sm font-medium">
                                Custom Instructions (Optional)
                            </Label>
                            <Textarea
                                id="audio-instructions"
                                placeholder="Add any specific topics, focus areas, or instructions for the audio overview..."
                                value={audioInstructions}
                                onChange={(e) => setAudioInstructions(e.target.value)}
                                className="mt-2 min-h-[100px] resize-none"
                            />
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <DialogTrigger asChild>
                                <Button variant="secondary">
                                    Cancel
                                </Button>
                            </DialogTrigger>
                            <Button onClick={handleCreateAudioOverview} disabled={isCreatingAudio}>
                                {isCreatingAudio ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
                                Create
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Audio Overview Generation Jobs */}
            {audioJobs.length > 0 && (
                <div className="mt-4 space-y-3">
                    {audioJobs.map((job) => (
                        <AudioOverviewGenerationJobCard key={job.id} job={job} />
                    ))}
                </div>
            )}

            {/* Audio Overview Display Cards */}
            {audioOverviews.length > 0 && (
                <div className="mt-4 space-y-3">
                    {audioOverviews.map((overview) => {
                        const isPlaying = playingAudioId === overview.id;
                        const isLoading = loadingAudioId === overview.id;

                        return (
                            <div
                                key={overview.id}
                                className="w-full p-4 border rounded-lg bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                                onClick={() => handlePlayAudio(overview.id)}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                                        {isLoading ? (
                                            <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
                                        ) : isPlaying ? (
                                            <Pause className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                        ) : (
                                            <Play className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                                            {overview.title || 'Audio Overview'}
                                        </h3>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                            Created {new Date(overview.created_at).toLocaleDateString()}
                                        </p>
                                        {overview.transcript && (
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                                                        {overview.transcript}
                                                    </p>
                                                </DialogTrigger>
                                                <DialogContent className="!max-w-none w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col">
                                                    <div className="flex-1 overflow-hidden">
                                                        <RichAudioOverview
                                                            audioOverview={overview}
                                                            papers={papers || []}
                                                            onClose={() => { }}
                                                        />
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {papers.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">Add papers to your project to create artifacts.</p>
            )}
        </div>
    );
}
