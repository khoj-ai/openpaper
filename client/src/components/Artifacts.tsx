"use client";

import { Loader2, Pause, Play, Volume2, RotateCcw } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
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
    DialogDescription,
    DialogClose
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RichAudioOverview } from "./RichAudioOverview";

interface ArtifactsProps {
    projectId: string;
    papers: PaperItem[];
}

const audioLengthOptions = [
    { label: "Short (5-10 mins)", value: "short" },
    { label: "Medium (10-20 mins)", value: "medium" },
    { label: "Long (20+ mins)", value: "long" },
];

export default function Artifacts({ projectId, papers }: ArtifactsProps) {
    const [audioInstructions, setAudioInstructions] = useState("");
    const [selectedAudioLength, setSelectedAudioLength] = useState("medium");
    const [isCreatingAudio, setIsCreatingAudio] = useState(false);
    const [isCreateAudioDialogOpen, setCreateAudioDialogOpen] = useState(false);
    const [audioOverviews, setAudioOverviews] = useState<AudioOverview[]>([]);
    const [audioJobs, setAudioJobs] = useState<AudioOverviewJob[]>([]);
    const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
    const [activatedAudioIds, setActivatedAudioIds] = useState<string[]>([]);
    const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);
    const [audioProgress, setAudioProgress] = useState<{ [key: string]: { currentTime: number; duration: number } }>({});
    const [audioVolume, setAudioVolume] = useState<{ [key: string]: number }>({});
    const [audioSpeed, setAudioSpeed] = useState<{ [key: string]: number }>({});
    const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

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

    const stopPolling = useCallback(() => {
        if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
        }
    }, []);

    const startPolling = useCallback(() => {
        stopPolling();

        const interval = setInterval(async () => {
            const jobs = await getProjectAudioJobs();
            const hasPendingJobs = jobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');

            if (!hasPendingJobs) {
                // No more pending jobs, stop polling and refresh overviews
                stopPolling();
                getProjectAudioOverviews();
            }
        }, 20000); // Poll every 20 seconds

        pollingInterval.current = interval;
    }, [getProjectAudioJobs, getProjectAudioOverviews, stopPolling]);

    useEffect(() => {
        if (projectId) {
            getProjectAudioOverviews();
            getProjectAudioJobs().then(jobs => {
                const hasPendingJobs = jobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
                if (hasPendingJobs) {
                    startPolling();
                }
            });
        }

        // Cleanup polling on unmount
        return () => {
            stopPolling();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    const handleCreateAudioOverview = async () => {
        setCreateAudioDialogOpen(false);
        setIsCreatingAudio(true);
        try {
            const requestData = {
                additional_instructions: audioInstructions.trim() || null,
                length: selectedAudioLength,
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
                startPolling();
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
            if (playingAudioId === audioOverviewId && audioRefs.current[audioOverviewId]) {
                audioRefs.current[audioOverviewId].pause();
                setPlayingAudioId(null);
                return;
            }

            // Stop any currently playing audio
            Object.values(audioRefs.current).forEach(audio => {
                if (!audio.paused) {
                    audio.pause();
                }
            });
            setPlayingAudioId(null);

            setLoadingAudioId(audioOverviewId);

            // Fetch detailed audio overview data
            const detailedOverview = await fetchFromApi(`/api/projects/audio/file/${projectId}/${audioOverviewId}`);

            if (detailedOverview.audio_url) {
                let audio = audioRefs.current[audioOverviewId];

                if (!audio) {
                    audio = new Audio(detailedOverview.audio_url);
                    audioRefs.current[audioOverviewId] = audio;

                    // Initialize default values
                    setAudioVolume(prev => ({ ...prev, [audioOverviewId]: 1 }));
                    setAudioSpeed(prev => ({ ...prev, [audioOverviewId]: 1 }));

                    audio.onloadedmetadata = () => {
                        setAudioProgress(prev => ({
                            ...prev,
                            [audioOverviewId]: { currentTime: 0, duration: audio.duration }
                        }));
                    };

                    audio.ontimeupdate = () => {
                        setAudioProgress(prev => ({
                            ...prev,
                            [audioOverviewId]: { currentTime: audio.currentTime, duration: audio.duration }
                        }));
                    };

                    audio.onloadstart = () => setLoadingAudioId(audioOverviewId);
                    audio.oncanplay = () => setLoadingAudioId(null);
                    audio.onplay = () => setPlayingAudioId(audioOverviewId);
                    audio.onpause = () => setPlayingAudioId(null);
                    audio.onended = () => {
                        setPlayingAudioId(null);
                    };
                    audio.onerror = () => {
                        setLoadingAudioId(null);
                        setPlayingAudioId(null);
                        console.error('Failed to load audio');
                    };
                }

                if (!activatedAudioIds.includes(audioOverviewId)) {
                    setActivatedAudioIds(prev => [...prev, audioOverviewId]);
                }
                audio.play();
            }
        } catch (err) {
            console.error("Failed to fetch audio details:", err);
            setLoadingAudioId(null);
        }
    };

    const handleSeek = (audioOverviewId: string, percentage: number) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio && !isNaN(audio.duration)) {
            audio.currentTime = (percentage / 100) * audio.duration;
        }
    };

    const handleVolumeChange = (audioOverviewId: string, volume: number) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.volume = volume;
            setAudioVolume(prev => ({ ...prev, [audioOverviewId]: volume }));
        }
    };

    const handleSpeedChange = (audioOverviewId: string, speed: number) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.playbackRate = speed;
            setAudioSpeed(prev => ({ ...prev, [audioOverviewId]: speed }));
        }
    };

    const skipBackward = (audioOverviewId: string) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
        }
    };

    const skipForward = (audioOverviewId: string) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
        }
    };

    const formatTime = (time: number) => {
        if (!isFinite(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <div className="mt-8">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Artifacts</h2>
            </div>

            <div className="flex flex-wrap gap-3">
                <Dialog open={isCreateAudioDialogOpen} onOpenChange={setCreateAudioDialogOpen}>
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
                        <div className="space-y-4 mt-4">
                            <div>
                                <Label htmlFor="audio-length" className="text-sm font-medium">
                                    Audio Length
                                </Label>
                                <Select value={selectedAudioLength} onValueChange={setSelectedAudioLength}>
                                    <SelectTrigger className="mt-2">
                                        <SelectValue placeholder="Select audio length" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {audioLengthOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
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
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <DialogClose asChild>
                                <Button variant="secondary">
                                    Cancel
                                </Button>
                            </DialogClose>
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
                        const progress = audioProgress[overview.id];
                        const volume = audioVolume[overview.id] || 1;
                        const speed = audioSpeed[overview.id] || 1;
                        const progressPercentage = progress && progress.duration ? (progress.currentTime / progress.duration) * 100 : 0;

                        return (
                            <div
                                key={overview.id}
                                className="w-full p-4 border rounded-lg bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                                <div className="flex items-start gap-3 mb-3">
                                    <button
                                        onClick={() => handlePlayAudio(overview.id)}
                                        className="flex-shrink-0 p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                    >
                                        {isLoading ? (
                                            <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
                                        ) : isPlaying ? (
                                            <Pause className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                        ) : (
                                            <Play className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                        )}
                                    </button>
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
                                                    <button className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                                                        {overview.transcript}
                                                    </button>
                                                </DialogTrigger>
                                                <DialogContent className="!max-w-none w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col">
                                                    <div className="flex-1 overflow-hidden">
                                                        <RichAudioOverview
                                                            audioOverview={overview}
                                                            papers={papers || []}
                                                        />
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>
                                </div>

                                {activatedAudioIds.includes(overview.id) && (
                                    <>
                                        {/* Progress Bar */}
                                        <div className="mb-3">
                                            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                                <span>{progress ? formatTime(progress.currentTime) : '0:00'}</span>
                                                <span>{progress ? formatTime(progress.duration) : '0:00'}</span>
                                            </div>
                                            <div className="relative">
                                                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-blue-500 transition-all duration-100"
                                                        style={{ width: `${progressPercentage}%` }}
                                                    />
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={progressPercentage}
                                                    onChange={(e) => handleSeek(overview.id, Number(e.target.value))}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                />
                                            </div>
                                        </div>

                                        {/* Controls */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => skipBackward(overview.id)}
                                                    className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                                                    title="Skip back 10s"
                                                >
                                                    <RotateCcw className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => skipForward(overview.id)}
                                                    className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                                                    title="Skip forward 10s"
                                                >
                                                    <RotateCcw className="w-4 h-4 scale-x-[-1]" />
                                                </button>
                                            </div>

                                            <div className="flex items-center space-x-3">
                                                {/* Volume Control */}
                                                <div className="flex items-center space-x-1">
                                                    <Volume2 className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.01"
                                                        value={volume}
                                                        onChange={(e) => handleVolumeChange(overview.id, Number(e.target.value))}
                                                        className="w-16 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                                                    />
                                                </div>

                                                {/* Speed Control */}
                                                <div className="flex space-x-1">
                                                    {[0.75, 1, 1.25, 1.5, 2].map((speedOption) => (
                                                        <button
                                                            key={speedOption}
                                                            onClick={() => handleSpeedChange(overview.id, speedOption)}
                                                            className={`px-2 py-1 text-xs rounded ${
                                                                speed === speedOption
                                                                    ? 'bg-blue-600 text-white'
                                                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                                                            } transition-colors`}
                                                        >
                                                            {speedOption}x
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
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
