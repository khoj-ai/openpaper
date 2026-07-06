"use client";

import { Loader2, Sparkles, Table, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchFromApi } from "@/lib/api";
import {
    AudioOverview,
    AudioOverviewJob,
    DataTableJob,
    ProjectRole,
} from "@/lib/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import AudioOverviewCard from "@/components/AudioOverviewCard";
import AudioOverviewGenerationJobCard from "@/components/AudioOverviewGenerationJobCard";
import DataTableGenerationJobCard from "@/components/DataTableGenerationJobCard";
import DataTableSchemaModal, { FieldDefinition } from "@/components/DataTableSchemaModal";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import {
    isAudioOverviewAtLimit,
    isAudioOverviewNearLimit,
    isDataTableAtLimit,
    isDataTableNearLimit,
    useSubscription,
} from "@/hooks/useSubscription";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

const audioLengthOptions = [
    { label: "Short (5-10 mins)", value: "short" },
    { label: "Medium (10-20 mins)", value: "medium" },
    { label: "Long (20+ mins)", value: "long" },
];

interface CreateTileProps {
    icon: React.ReactNode;
    label: string;
    sub: string;
    isNew?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

function CreateTile({ icon, label, sub, isNew, disabled, onClick }: CreateTileProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
            <div className="flex items-center justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    {icon}
                </div>
                {isNew && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300">New</Badge>}
            </div>
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs leading-snug text-muted-foreground">{sub}</span>
        </button>
    );
}

// Right-pane artifacts view: creation up top, pending + completed below.
// Shares the right slot with the reader panel; kept mounted (CSS-hidden) while
// inactive so in-progress polling and audio playback survive mode switches.
export function ArtifactsPanel() {
    const { projectId, project, papers, rightPanel, closeArtifacts } = useProjectWorkspace();
    const router = useRouter();
    const { subscription, refetch: refetchSubscription } = useSubscription();
    const atAudioLimit = subscription ? isAudioOverviewAtLimit(subscription) : false;
    const atDataTableLimit = subscription ? isDataTableAtLimit(subscription) : false;
    const isViewer = project?.role === ProjectRole.Viewer;

    const [audioInstructions, setAudioInstructions] = useState("");
    const [selectedAudioLength, setSelectedAudioLength] = useState("medium");
    const [isCreatingAudio, setIsCreatingAudio] = useState(false);
    const [isCreateAudioDialogOpen, setCreateAudioDialogOpen] = useState(false);
    const [audioOverviews, setAudioOverviews] = useState<AudioOverview[]>([]);
    const [audioJobs, setAudioJobs] = useState<AudioOverviewJob[]>([]);
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);

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
    } = useAudioPlayback(projectId);

    const [isDataTableSchemaModalOpen, setDataTableSchemaModalOpen] = useState(false);
    const [isCreatingDataTable, setIsCreatingDataTable] = useState(false);
    const [dataTableJobs, setDataTableJobs] = useState<DataTableJob[]>([]);

    const getProjectAudioOverviews = useCallback(async () => {
        try {
            const fetchedAudioOverviews = await fetchFromApi(`/api/projects/audio/${projectId}`);
            setAudioOverviews(fetchedAudioOverviews);
        } catch (err) {
            console.error("Failed to fetch audio overviews:", err);
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
            const hasPendingDataTableJobs = dataTableJobs.some((job: DataTableJob) => job.status === 'pending' || job.status === 'running');

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
                const hasPendingDataTableJobs = dataTableJobs.some((job: DataTableJob) => job.status === 'pending' || job.status === 'running');
                if (hasPendingAudioJobs || hasPendingDataTableJobs) {
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

    const pollAudioData = useCallback(async () => {
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
        } finally {
            setIsCreatingAudio(false);
        }
    };

    const handleCreateDataTable = async (columns: FieldDefinition[]) => {
        setDataTableSchemaModalOpen(false);
        setIsCreatingDataTable(true);

        try {
            toast.info("Creating data table...");

            const response: DataTableJob = await fetchFromApi(`/api/projects/tables/`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    project_id: projectId,
                    columns: columns.map(col => col.label),
                }),
            });

            if (!response.id) {
                throw new Error("No job ID returned from API");
            }

            await fetchDataTableJobs();
            startPolling();
            setIsCreatingDataTable(false);
            toast.success("Data table generation started!");

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

    const artifactCount = dataTableJobs.length + audioJobs.length + audioOverviews.length;

    return (
        <>
            <aside
                className={cn(
                    "flex-col bg-background",
                    rightPanel === "artifacts" ? "flex" : "hidden",
                    "fixed inset-0 z-40 md:static md:z-auto md:w-[400px] md:shrink-0 md:border-l",
                )}
            >
                <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-blue-500" aria-hidden />
                        <h2 className="text-sm font-semibold">Artifacts</h2>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeArtifacts} aria-label="Close artifacts">
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
                    {/* Create */}
                    {!isViewer && (
                        <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Create new</div>
                            <div className="grid grid-cols-2 gap-2">
                                <CreateTile
                                    icon={<Volume2 className="h-4 w-4" />}
                                    label="Audio Overview"
                                    sub="Podcast-style discussion of your papers"
                                    disabled={papers.length === 0}
                                    onClick={() => setCreateAudioDialogOpen(true)}
                                />
                                <CreateTile
                                    icon={<Table className="h-4 w-4" />}
                                    label="Data Table"
                                    sub="Compare findings across papers"
                                    isNew
                                    disabled={papers.length === 0}
                                    onClick={() => setDataTableSchemaModalOpen(true)}
                                />
                            </div>
                            {papers.length === 0 && (
                                <p className="mt-2 text-xs text-muted-foreground">Add papers to your project to create artifacts.</p>
                            )}
                        </div>
                    )}

                    {/* List */}
                    <div className="flex min-h-0 flex-col">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your artifacts</div>
                            <span className="text-xs text-muted-foreground">{artifactCount}</span>
                        </div>
                        <div className="space-y-3">
                            {dataTableJobs.map((job) => (
                                <DataTableGenerationJobCard key={job.id} job={job} projectId={projectId} />
                            ))}
                            {audioJobs.map((job) => (
                                <AudioOverviewGenerationJobCard key={job.id} job={job} />
                            ))}
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
                            {artifactCount === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Nothing here yet. Artifacts you generate appear in this list.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="shrink-0 border-t px-4 py-2.5 text-xs text-muted-foreground">
                    Generation runs in the background — keep working while artifacts build.
                </div>
            </aside>

            {/* Audio overview creation dialog */}
            <Dialog open={isCreateAudioDialogOpen} onOpenChange={setCreateAudioDialogOpen}>
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

            {/* Data Table Schema Modal */}
            <DataTableSchemaModal
                open={isDataTableSchemaModalOpen}
                onOpenChange={setDataTableSchemaModalOpen}
                onSubmit={handleCreateDataTable}
                isCreating={isCreatingDataTable}
                atLimit={atDataTableLimit}
            />
        </>
    );
}
