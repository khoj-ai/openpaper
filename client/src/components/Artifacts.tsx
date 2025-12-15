"use client";

import { Loader2, Volume2, Table } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { fetchFromApi } from "@/lib/api";
import { AudioOverview, PaperItem, AudioOverviewJob, ProjectRole, DataTableJobStatusResponse } from "@/lib/schema";
import AudioOverviewGenerationJobCard from "@/components/AudioOverviewGenerationJobCard";
import DataTableGenerationJobCard from "@/components/DataTableGenerationJobCard";
import AudioOverviewCard from "@/components/AudioOverviewCard";
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
import { useSubscription, isAudioOverviewAtLimit, isAudioOverviewNearLimit, isDataTableAtLimit, isDataTableNearLimit } from "@/hooks/useSubscription";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DataTableSchemaModal, { ColumnDefinition } from "./DataTableSchemaModal";
import { useAudioPlayback } from "./hooks/useAudioPlayback";

interface ArtifactsProps {
    projectId: string;
    papers: PaperItem[];
    currentUserRole?: ProjectRole;
}

const audioLengthOptions = [
    { label: "Short (5-10 mins)", value: "short" },
    { label: "Medium (10-20 mins)", value: "medium" },
    { label: "Long (20+ mins)", value: "long" },
];

export default function Artifacts({ projectId, papers, currentUserRole }: ArtifactsProps) {
    const router = useRouter();
    const { subscription, refetch: refetchSubscription } = useSubscription();
    const atAudioLimit = subscription ? isAudioOverviewAtLimit(subscription) : false;
    const atDataTableLimit = subscription ? isDataTableAtLimit(subscription) : false;
    const [audioInstructions, setAudioInstructions] = useState("");
    const [selectedAudioLength, setSelectedAudioLength] = useState("medium");
    const [isCreatingAudio, setIsCreatingAudio] = useState(false);
    const [isCreateAudioDialogOpen, setCreateAudioDialogOpen] = useState(false);
    const [audioOverviews, setAudioOverviews] = useState<AudioOverview[]>([]);
    const [audioJobs, setAudioJobs] = useState<AudioOverviewJob[]>([]);
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);

    // Audio playback management
    const {
        playingAudioId,
        loadingAudioId,
        activatedAudioIds,
        audioProgress,
        audioVolume,
        audioSpeed,
        handlePlayAudio,
        handleSeek,
        handleVolumeChange,
        handleSpeedChange,
        skipBackward,
        skipForward,
        formatTime,
        getProgressPercentage,
    } = useAudioPlayback(projectId);    // Data Table states
    const [isDataTableSchemaModalOpen, setDataTableSchemaModalOpen] = useState(false);
    const [isCreatingDataTable, setIsCreatingDataTable] = useState(false);
    const [dataTableJobs, setDataTableJobs] = useState<DataTableJobStatusResponse[]>([]);

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

    const fetchDataTableJobs = useCallback(async () => {
        try {
            const fetchedJobs = await fetchFromApi(`/api/projects/tables/jobs/${projectId}`);
            setDataTableJobs(fetchedJobs.jobs);
            return fetchedJobs.jobs;
        } catch (err) {
            console.error("Failed to fetch data table jobs:", err);
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
            const [audioJobs, dataTableJobs] = await Promise.all([
                getProjectAudioJobs(),
                fetchDataTableJobs()
            ]);
            const hasPendingAudioJobs = audioJobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
            const hasPendingDataTableJobs = dataTableJobs.some((job: DataTableJobStatusResponse) => job.status === 'pending' || job.status === 'running');

            if (!hasPendingAudioJobs && !hasPendingDataTableJobs) {
                // No more pending jobs, stop polling and refresh overviews
                stopPolling();
                getProjectAudioOverviews();
            }
        }, 20000); // Poll every 20 seconds

        pollingInterval.current = interval;
    }, [getProjectAudioJobs, fetchDataTableJobs, getProjectAudioOverviews, stopPolling]);

    useEffect(() => {
        if (projectId) {
            getProjectAudioOverviews();
            Promise.all([
                getProjectAudioJobs(),
                fetchDataTableJobs()
            ]).then(([audioJobs, dataTableJobs]) => {
                const hasPendingAudioJobs = audioJobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
                const hasPendingDataTableJobs = dataTableJobs.some((job: DataTableJobStatusResponse) => job.status === 'pending' || job.status === 'running');
                if (hasPendingAudioJobs || hasPendingDataTableJobs) {
                    startPolling();
                }
            });
        }

        // Cleanup polling on unmount
        return () => {
            stopPolling();
        };
    }, [projectId]);

    const pollAudioData = useCallback(async () => {
        // Fetch jobs first to determine if there are pending/running jobs,
        // then refresh audio overviews so UI updates.
        const jobs = await getProjectAudioJobs();
        await getProjectAudioOverviews();
        const hasPendingJobs = jobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
        return hasPendingJobs;
    }, [getProjectAudioJobs, getProjectAudioOverviews]);

    const handleCreateAudioOverview = async () => {
        if (atAudioLimit) {
            toast.error("You have reached your audio overview limit. Please upgrade to create more.");
            setCreateAudioDialogOpen(false);
            return;
        }
        setCreateAudioDialogOpen(false);
        setIsCreatingAudio(true);
        try {
            toast.info("Your audio overview is being generated. This may take a few minutes.");
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

            refetchSubscription();
            if (subscription) {
                const newUsage = {
                    ...subscription.usage,
                    audio_overviews_used: subscription.usage.audio_overviews_used + 1,
                    audio_overviews_remaining: subscription.usage.audio_overviews_remaining - 1,
                };
                const tempUpdatedSubscription = {
                    ...subscription,
                    usage: newUsage,
                };

                const newAtLimit = isAudioOverviewAtLimit(tempUpdatedSubscription);
                const newNearLimit = isAudioOverviewNearLimit(tempUpdatedSubscription);

                if (newAtLimit) {
                    toast.warning("You've used all of your audio overviews for the week.", {
                        action: {
                            label: "Upgrade",
                            onClick: () => router.push('/pricing'),
                        }
                    });
                } else if (newNearLimit) {
                    toast.info(`You have ${newUsage.audio_overviews_remaining} audio overviews remaining this week.`, {
                        action: {
                            label: "Upgrade",
                            onClick: () => router.push('/pricing'),
                        }
                    });
                }
            }

            // Immediately poll for jobs and overviews, then start interval polling
            const hasPendingJobs = await pollAudioData();
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

    const handleCreateDataTable = async (columns: ColumnDefinition[]) => {
        setDataTableSchemaModalOpen(false);
        setIsCreatingDataTable(true);

        try {
            toast.info("Creating data table...");

            // Create the data table via API
            const response: DataTableJobStatusResponse = await fetchFromApi(`/api/projects/tables/`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    project_id: projectId,
                    columns: columns.map(col => col.label),
                }),
            });

            // Fetch updated jobs and start polling
            await fetchDataTableJobs();
            startPolling();
            setIsCreatingDataTable(false);
            toast.success("Data table generation started!");

            // Refetch subscription and warn if near limit
            refetchSubscription();
            if (subscription) {
                const newUsage = {
                    ...subscription.usage,
                    data_tables_used: subscription.usage.data_tables_used + 1,
                    data_tables_remaining: subscription.usage.data_tables_remaining - 1,
                };
                const tempUpdatedSubscription = {
                    ...subscription,
                    usage: newUsage,
                };

                const newAtLimit = isDataTableAtLimit(tempUpdatedSubscription);
                const newNearLimit = isDataTableNearLimit(tempUpdatedSubscription);

                if (newAtLimit) {
                    toast.warning("You've used all of your data tables for the week.", {
                        action: {
                            label: "Upgrade",
                            onClick: () => router.push('/pricing'),
                        }
                    });
                } else if (newNearLimit) {
                    toast.info(`You have ${newUsage.data_tables_remaining} data tables remaining this week.`, {
                        action: {
                            label: "Upgrade",
                            onClick: () => router.push('/pricing'),
                        }
                    });
                }
            }
        } catch (err) {
            console.error("Failed to create data table:", err);
            toast.error("Failed to create data table. Please try again.");
        }
    };

    return (
        <div className="mt-8">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Artifacts</h2>
            </div>

            <div className="flex flex-wrap gap-3">
                {currentUserRole !== ProjectRole.Viewer && (
                    <>
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
                            {atAudioLimit ? (
                                <div className="mt-4 text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/30 rounded-md">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200">You&apos;ve used all your audio overviews for this week.</p>
                                    <Link href="/pricing" passHref>
                                        <Button variant="link" className="p-0 h-auto text-sm">Upgrade your plan to create more.</Button>
                                    </Link>
                                </div>
                            ) : (
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
                            )}
                            {!atAudioLimit && (
                                <div className="flex justify-end gap-2 mt-6">
                                    <DialogClose asChild>
                                        <Button variant="secondary">
                                            Cancel
                                        </Button>
                                    </DialogClose>
                                    <Button onClick={handleCreateAudioOverview} disabled={isCreatingAudio || atAudioLimit}>
                                        {isCreatingAudio ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
                                        Create
                                    </Button>
                                </div>
                            )}
                        </DialogContent>
                    </Dialog>

                    <button
                        disabled={papers.length === 0}
                        onClick={() => setDataTableSchemaModalOpen(true)}
                        className="flex flex-col items-center justify-center p-3 border-2 border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed aspect-square w-1/4"
                    >
                        <Table className="w-6 h-6 text-gray-400 group-hover:text-blue-500 mb-1 transition-colors" />
                        <span className="text-xs font-medium text-center leading-tight">Data Table</span>
                    </button>
                </>
                )}
            </div>

            {/* Data Table Schema Modal */}
            <DataTableSchemaModal
                open={isDataTableSchemaModalOpen}
                onOpenChange={setDataTableSchemaModalOpen}
                onSubmit={handleCreateDataTable}
                isCreating={isCreatingDataTable}
                atLimit={atDataTableLimit}
            />

            {/* Data Table Generation Jobs */}
            {dataTableJobs.length > 0 && (
                <div className="mt-4 space-y-3">
                    {dataTableJobs.map((job) => (
                        <DataTableGenerationJobCard key={job.job_id} job={job} projectId={projectId} />
                    ))}
                </div>
            )}

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
                    {audioOverviews.map((overview) => (
                        <AudioOverviewCard
                            key={overview.id}
                            overview={overview}
                            papers={papers}
                            isPlaying={playingAudioId === overview.id}
                            isLoading={loadingAudioId === overview.id}
                            isActivated={activatedAudioIds.includes(overview.id)}
                            progress={audioProgress[overview.id]}
                            volume={audioVolume[overview.id] || 1}
                            speed={audioSpeed[overview.id] || 1}
                            progressPercentage={getProgressPercentage(overview.id)}
                            onPlayPause={() => handlePlayAudio(overview.id)}
                            onSeek={(percentage) => handleSeek(overview.id, percentage)}
                            onVolumeChange={(volume) => handleVolumeChange(overview.id, volume)}
                            onSpeedChange={(speed) => handleSpeedChange(overview.id, speed)}
                            onSkipBackward={() => skipBackward(overview.id)}
                            onSkipForward={() => skipForward(overview.id)}
                            formatTime={formatTime}
                        />
                    ))}
                </div>
            )}

            {papers.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">Add papers to your project to create artifacts.</p>
            )}
        </div>
    );
}
