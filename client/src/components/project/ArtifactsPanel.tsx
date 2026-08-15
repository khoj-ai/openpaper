"use client";

import { BarChart3, Loader2, MessageSquare, Sparkles, Table, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchFromApi } from "@/lib/api";
import {
    AudioOverview,
    AudioOverviewJob,
    ChatArtifact,
    ChartGenerationJob,
    DataTableJob,
    ProjectChatArtifact,
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
import { ChatArtifactCards } from "@/components/ChatArtifactCards";
import { ChartComposerDialog } from "@/components/project/ChartComposerDialog";
import { ChartGenerationJobCard } from "@/components/ChartGenerationJobCard";
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

/** The kinds of row the panel can list. Named rather than spelled out at each
 * use so the switch below, the row builders and the type all move together. */
const ArtifactRow = {
    DataTable: "data-table",
    Chart: "chart",
    AudioJob: "audio-job",
    AudioOverview: "audio-overview",
    Chat: "chat",
} as const;

type ArtifactListItem =
    | { id: string; timestamp: string | null; type: typeof ArtifactRow.DataTable; job: DataTableJob }
    | { id: string; timestamp: string | null; type: typeof ArtifactRow.Chart; job: ChartGenerationJob }
    | { id: string; timestamp: string | null; type: typeof ArtifactRow.AudioJob; job: AudioOverviewJob }
    | { id: string; timestamp: string | null; type: typeof ArtifactRow.AudioOverview; overview: AudioOverview }
    | {
        id: string;
        timestamp: string | null;
        type: typeof ArtifactRow.Chat;
        group: {
            messageId: string;
            conversationId: string;
            conversationTitle: string | null;
            timestamp: string | null;
            artifacts: ChatArtifact[];
            chartDetailHrefs: string[];
        };
    };

const timestampMs = (timestamp: string | null) => {
    const value = timestamp ? new Date(timestamp).getTime() : 0;
    return Number.isNaN(value) ? 0 : value;
};

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
    const { projectId, project, papers, rightPanel, closeArtifacts, openPaper } = useProjectWorkspace();
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
    const [chartJobs, setChartJobs] = useState<ChartGenerationJob[]>([]);
    const [chatArtifacts, setChatArtifacts] = useState<ProjectChatArtifact[]>([]);
    const [isChartComposerOpen, setChartComposerOpen] = useState(false);

    const fetchChatArtifacts = useCallback(async () => {
        try {
            const response = await fetchFromApi(`/api/projects/artifacts/${projectId}`);
            setChatArtifacts(response.artifacts ?? []);
        } catch (err) {
            console.error("Failed to fetch chat artifacts:", err);
        }
    }, [projectId]);

    // Chat artifacts arrive one row per payload; bundle them by message so the
    // project panel preserves the same grouping as the conversation.
    const chatArtifactGroups = useMemo(() => {
        const groups: {
            messageId: string;
            conversationId: string;
            conversationTitle: string | null;
            timestamp: string | null;
            artifacts: ChatArtifact[];
            chartDetailHrefs: string[];
        }[] = [];
        const byMessage = new Map<string, (typeof groups)[number]>();
        for (const artifact of chatArtifacts) {
            // Artifact-native jobs are rendered from their job cards. They have
            // no chat message and must not become a synthetic conversation row.
            if (!artifact.message_id || !artifact.conversation_id) continue;
            const artifactTimestamp = artifact.updated_at ?? artifact.created_at ?? null;
            let group = byMessage.get(artifact.message_id);
            if (!group) {
                group = {
                    messageId: artifact.message_id,
                    conversationId: artifact.conversation_id,
                    conversationTitle: artifact.conversation_title ?? null,
                    timestamp: artifactTimestamp,
                    artifacts: [],
                    chartDetailHrefs: [],
                };
                byMessage.set(artifact.message_id, group);
                groups.push(group);
            } else if (timestampMs(artifactTimestamp) > timestampMs(group.timestamp)) {
                group.timestamp = artifactTimestamp;
            }
            group.artifacts.push(artifact.payload);
            if (artifact.kind === "chart") {
                group.chartDetailHrefs.push(`/projects/${projectId}/charts/${artifact.id}`);
            }
        }
        return groups;
    }, [chatArtifacts]);

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

    const fetchChartJobs = useCallback(async () => {
        try {
            const response = await fetchFromApi(`/api/projects/charts/jobs/${projectId}`);
            const jobs = response.jobs ?? [];
            setChartJobs(jobs);
            return jobs;
        } catch (err) {
            console.error("Failed to fetch chart jobs:", err);
            return [] as ChartGenerationJob[];
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
            const [audioJobs, dataTableJobs, chartJobs] = await Promise.all([
                getProjectAudioJobs(),
                fetchDataTableJobs(),
                fetchChartJobs(),
            ]);
            const hasPendingAudioJobs = audioJobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
            // A completed job whose result hasn't landed yet is still pending —
            // stopping here would freeze the card in its pre-result state.
            const hasPendingDataTableJobs = dataTableJobs.some((job: DataTableJob) =>
                job.status === 'pending' || job.status === 'running' ||
                (job.status === 'completed' && !job.result_id));

            const hasPendingChartJobs = chartJobs.some((job: ChartGenerationJob) => job.status === 'pending' || job.status === 'running');
            if (!hasPendingAudioJobs && !hasPendingDataTableJobs && !hasPendingChartJobs) {
                // No more pending jobs, stop polling and refresh overviews
                stopPolling();
                getProjectAudioOverviews();
                fetchChatArtifacts();
            }
        }, 20000); // Poll every 20 seconds

        pollingInterval.current = interval;
    }, [getProjectAudioJobs, fetchDataTableJobs, fetchChartJobs, getProjectAudioOverviews, fetchChatArtifacts, stopPolling]);

    useEffect(() => {
        if (projectId) {
            getProjectAudioOverviews();
            fetchChatArtifacts();
            Promise.all([
                getProjectAudioJobs(),
                fetchDataTableJobs(),
                fetchChartJobs()
            ]).then(([audioJobs, dataTableJobs, chartJobs]) => {
                const hasPendingAudioJobs = audioJobs.some((job: AudioOverviewJob) => job.status === 'pending' || job.status === 'running');
                // A completed job whose result hasn't landed yet is still pending —
            // stopping here would freeze the card in its pre-result state.
            const hasPendingDataTableJobs = dataTableJobs.some((job: DataTableJob) =>
                job.status === 'pending' || job.status === 'running' ||
                (job.status === 'completed' && !job.result_id));
                const hasPendingChartJobs = chartJobs.some((job: ChartGenerationJob) => job.status === 'pending' || job.status === 'running');
                if (hasPendingAudioJobs || hasPendingDataTableJobs || hasPendingChartJobs) {
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
                    // Computed columns run through the compute agent after
                    // extraction, never through the extraction model.
                    computed_columns: columns
                        .filter(col => col.kind === 'computed' && col.spec && col.inputs?.length)
                        .map(col => ({
                            label: col.label,
                            spec: col.spec,
                            inputs: col.inputs,
                        })),
                    // List columns extract one cited entry per instance found.
                    list_columns: columns
                        .filter(col => col.kind === 'list')
                        .map(col => col.label),
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

    const handleOpenChartPaper = useCallback((paperId: string, searchTerm?: string) => {
        const paper = papers.find((candidate) => candidate.id === paperId);
        if (paper) openPaper(paper, searchTerm ?? null);
    }, [openPaper, papers]);

    const artifactItems = useMemo<ArtifactListItem[]>(() => {
        const items: ArtifactListItem[] = [
            ...dataTableJobs.map((job) => ({ id: job.id, timestamp: job.updated_at || job.completed_at || job.created_at, type: ArtifactRow.DataTable, job })),
            ...chartJobs.map((job) => ({ id: job.id, timestamp: job.updated_at || job.completed_at || job.created_at || null, type: ArtifactRow.Chart, job })),
            ...audioJobs.map((job) => ({ id: job.id, timestamp: job.updated_at || job.completed_at || job.created_at || null, type: ArtifactRow.AudioJob, job })),
            ...audioOverviews.map((overview) => ({ id: overview.id, timestamp: overview.updated_at || overview.created_at, type: ArtifactRow.AudioOverview, overview })),
            ...chatArtifactGroups.map((group) => ({ id: group.messageId, timestamp: group.timestamp, type: ArtifactRow.Chat, group })),
        ];
        return items.sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
    }, [audioJobs, audioOverviews, chartJobs, chatArtifactGroups, dataTableJobs]);

    const artifactCount = artifactItems.length;

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
                                <CreateTile
                                    icon={<BarChart3 className="h-4 w-4" />}
                                    label="Chart"
                                    sub="Turn cited findings into a visual"
                                    isNew
                                    disabled={papers.length === 0}
                                    onClick={() => setChartComposerOpen(true)}
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
                        {/* Bottom padding lives on the content, not the scroll
                            container — Chromium drops a scroller's own bottom
                            padding from the scrollable overflow area. */}
                        <div className="space-y-3 pb-6">
                            {artifactItems.map((item) => {
                                if (item.type === ArtifactRow.DataTable) {
                                    return <DataTableGenerationJobCard key={item.id} job={item.job} projectId={projectId} />;
                                }
                                if (item.type === ArtifactRow.Chart) {
                                    return <ChartGenerationJobCard key={item.id} job={item.job} onOpenPaper={handleOpenChartPaper} />;
                                }
                                if (item.type === ArtifactRow.AudioJob) {
                                    return <AudioOverviewGenerationJobCard key={item.id} job={item.job} />;
                                }
                                if (item.type === ArtifactRow.AudioOverview) {
                                    const { overview } = item;
                                    return <AudioOverviewCard
                                        key={item.id}
                                        overview={overview}
                                        onOpenTranscript={() => router.push(`/projects/${projectId}/audio/${overview.id}`)}
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
                                    />;
                                }
                                const { group } = item;
                                return <div key={item.id} className="rounded-lg bg-muted/40 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <Link
                                            href={`/projects/${projectId}/conversations/${group.conversationId}`}
                                            className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                                        >
                                            <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                            <span className="truncate">
                                                {group.conversationTitle || "Untitled conversation"}
                                            </span>
                                        </Link>
                                        {group.timestamp && (
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {new Date(group.timestamp).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                    <ChatArtifactCards artifacts={group.artifacts} onOpenPaper={handleOpenChartPaper} chatHref={`/projects/${projectId}/conversations/${group.conversationId}`} chartDetailHrefs={group.chartDetailHrefs} />
                                </div>;
                            })}
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
                projectId={projectId}
                isCreating={isCreatingDataTable}
                atLimit={atDataTableLimit}
            />
            <ChartComposerDialog
                open={isChartComposerOpen}
                onOpenChange={setChartComposerOpen}
                projectId={projectId}
                papers={papers}
                onCreated={async () => {
                    await fetchChartJobs();
                    startPolling();
                }}
            />
        </>
    );
}
