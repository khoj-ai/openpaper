import { fetchFromApi } from '@/lib/api';
import { Download, Clock, FileAudio, History, ChevronDown, Plus, Mic, HelpCircle, Play, Volume2 } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import React, { useState, useEffect, useCallback } from 'react';
import EnigmaticLoadingExperience from './EnigmaticLoadingExperience';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { JobStatusType } from '@/lib/schema';
import { useSubscription, isAudioOverviewAtLimit, nextMonday } from '@/hooks/useSubscription';
import Link from 'next/link';
import { EnhancedAudioPlayer } from './EnhancedAudioPlayer';
import { AudioOverview } from '@/lib/schema';


interface AudioOverviewProps {
    paper_id: string;
    paper_title?: string;
    setExplicitSearchTerm: (term: string) => void;
}

interface JobStatus {
    job_id: string;
    status: JobStatusType;
    paper_id: string;
}

// Curated voice options - 3 distinct voices to reduce decision fatigue
const VOICE_OPTIONS = [
    { id: 'nova', name: 'Nova', description: 'Warm & friendly', sampleText: 'Hello! I\'m Nova, a warm and friendly voice perfect for engaging summaries.' },
    { id: 'onyx', name: 'Onyx', description: 'Deep & authoritative', sampleText: 'Hello. I\'m Onyx, a deep and authoritative voice ideal for formal content.' },
    { id: 'shimmer', name: 'Shimmer', description: 'Clear & bright', sampleText: 'Hi there! I\'m Shimmer, a clear and bright voice great for detailed explanations.' },
] as const;

// Length options for audio overview
const LENGTH_OPTIONS = [
    { id: 'short', name: 'Short', description: '~2-3 min' },
    { id: 'medium', name: 'Medium', description: '~5-7 min' },
    { id: 'long', name: 'Long', description: '~10-15 min' },
] as const;

type VoiceOption = typeof VOICE_OPTIONS[number]['id'];
type LengthOption = typeof LENGTH_OPTIONS[number]['id'];

interface AudioOverviewCreateRequestBody {
    additional_instructions?: string;
    voice?: VoiceOption;
    length?: LengthOption;
}

// Focus options for different types of audio summaries
const FOCUS_OPTIONS = [
    {
        id: 'summary',
        name: 'Concise Summary',
        description: 'Key points overview',
        instructions: 'Provide a concise summary of this paper, covering the main objectives, methodology, key findings, and conclusions. Make it easy to understand.'
    },
    {
        id: 'critical',
        name: 'Critical Analysis',
        description: 'Limitations & rebuttals',
        instructions: 'Analyze this paper critically. Identify potential weaknesses, limitations, questionable assumptions, and possible counterarguments. Be thorough but fair.'
    },
    {
        id: 'gaps',
        name: 'Research Gaps',
        description: 'Future directions',
        instructions: 'Identify the research gaps in this paper. What questions remain unanswered? What future work do the authors suggest? What opportunities exist for follow-up research?'
    },
    {
        id: 'novelty',
        name: "What's Novel",
        description: 'Key innovations',
        instructions: 'Focus on what is novel and innovative about this paper. How does it differ from prior work? What new contributions does it make to the field?'
    },
] as const;

type FocusOption = typeof FOCUS_OPTIONS[number]['id'];

const audioOverviewLoadingText = [
    'Generating audio overview...',
    'Creating your audio summary...',
    'Summarizing the paper for you...',
    'Crafting your audio overview...',
    'Creating a sublime audio experience...',
    'Transforming text to audio...',
    'Converting paper to audio...',
]

const DEFAULT_INSTRUCTIONS = FOCUS_OPTIONS[0].instructions;

export function AudioOverviewPanel({ paper_id, paper_title, setExplicitSearchTerm }: AudioOverviewProps) {

    const { subscription, refetch: refetchSubscription } = useSubscription();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [audioOverviewJobId, setAudioOverviewJobId] = useState<string | null>(null);
    const [audioOverview, setAudioOverview] = useState<AudioOverview | null>(null);
    const [allAudioOverviews, setAllAudioOverviews] = useState<AudioOverview[]>([]);
    const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState<string>(audioOverviewLoadingText[Math.floor(Math.random() * audioOverviewLoadingText.length)]);
    const [error, setError] = useState<string | null>(null);
    const [showGenerationForm, setShowGenerationForm] = useState(false);
    const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
    const [selectedFocus, setSelectedFocus] = useState<FocusOption>('summary');
    const [additionalInstructions, setAdditionalInstructions] = useState<string>(DEFAULT_INSTRUCTIONS);
    const [previewingVoice, setPreviewingVoice] = useState<VoiceOption | null>(null);
    const [selectedVoice, setSelectedVoice] = useState<VoiceOption>('nova');
    const [selectedLength, setSelectedLength] = useState<LengthOption>('medium');


    // Audio overview credit usage state
    const [audioCreditUsage, setAudioCreditUsage] = useState<{
        used: number;
        remaining: number;
        total: number;
        usagePercentage: number;
        showWarning: boolean;
        isNearLimit: boolean;
        isCritical: boolean;
    } | null>(null);

    // Check for existing audio overview on component mount
    useEffect(() => {
        checkExistingAudioOverview();
        loadAllAudioOverviews();
    }, [paper_id]);

    // Poll job status when a job is in progress
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (jobStatus && (jobStatus.status === 'pending' || jobStatus.status === 'running')) {
            interval = setInterval(() => {
                pollJobStatus();
                setIsLoading(true);
                setLoadingText(audioOverviewLoadingText[Math.floor(Math.random() * audioOverviewLoadingText.length)]);
            }, 3500); // Poll every 3.5 seconds
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
                setSelectedAudioId(response.id);
            } else {
                setAudioOverview(null);
                setSelectedAudioId(null);
                // Check if there is a pending generation job
                await pollJobStatus(false);
            }
        } catch (err) {
            console.error('Error checking existing audio overview:', err);
            await pollJobStatus(false); // Don't show error if no overview exists
        } finally {
            setIsInitialLoadDone(true);
        }
    };

    const loadAllAudioOverviews = async () => {
        const overviews = await fetchAllAudioOverviews();
        setAllAudioOverviews(overviews);
    };

    // useCallback to calculate audio overview credit usage
    const updateAudioCreditUsage = useCallback(() => {
        if (!subscription) {
            setAudioCreditUsage(null);
            return;
        }

        const { audio_overviews_used, audio_overviews_remaining } = subscription.usage;
        const total = audio_overviews_used + audio_overviews_remaining;
        const usagePercentage = total > 0 ? (audio_overviews_used / total) * 100 : 0;

        setAudioCreditUsage({
            used: audio_overviews_used,
            remaining: audio_overviews_remaining,
            total,
            usagePercentage,
            showWarning: usagePercentage > 75,
            isNearLimit: usagePercentage > 75,
            isCritical: usagePercentage > 95
        });
    }, [subscription]);

    // Update audio credit usage whenever subscription changes
    useEffect(() => {
        updateAudioCreditUsage();
    }, [updateAudioCreditUsage]);

    const createAudioOverview = async (additionalInstructions: string, voice: VoiceOption, length: LengthOption) => {
        // Check if user has remaining audio overview credits
        if (isAudioOverviewAtLimit(subscription)) {
            setError('You have reached your monthly audio overview limit. Please upgrade your plan or wait until next Monday for credits to reset.');
            return;
        }

        setIsLoading(true);
        setError(null);

        const body: AudioOverviewCreateRequestBody = {
            additional_instructions: additionalInstructions,
            voice: voice,
            length: length
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
                setAudioOverview(null);

                // Refetch subscription data to update credit usage
                try {
                    await refetchSubscription();
                } catch (error) {
                    console.error('Error refetching subscription after audio overview creation:', error);
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAudioOverviewSelect = async (audioId: string) => {
        if (audioId === selectedAudioId) return;

        const selectedOverview = await fetchAudioOverviewById(audioId);
        if (selectedOverview) {
            setAudioOverview(selectedOverview);
            setSelectedAudioId(audioId);
        }
    };

    const fetchAudioOverview = useCallback(async () => {
        try {
            const response: AudioOverview = await fetchFromApi(`/api/paper/audio/${paper_id}/file`);
            if (response) {
                setAudioOverview(response);
                setJobStatus(null); // Clear job status since we have the overview now
                setIsLoading(false); // Stop loading state
                setError(null); // Clear any errors since we successfully fetched the overview

                // Use functional update to get the latest value
                setAllAudioOverviews((prevOverviews) => {
                    // Check if overview already exists using the latest state
                    if (!prevOverviews.some(overview => overview.id === response.id)) {
                        return [...prevOverviews, response];
                    }
                    return prevOverviews; // Return unchanged if already exists
                });
            } else {
                setShowGenerationForm(true);
                throw new Error('Failed to fetch audio overview');
            }
        } catch (err) {
            setShowGenerationForm(true);
            console.error('Error fetching audio overview:', err);
            setError('Failed to fetch audio overview');
        } finally {
            setIsInitialLoadDone(true);
        }
    }, [paper_id]);

    const pollJobStatus = useCallback(async (showErrorOnFail: boolean = true) => {
        try {
            const response: JobStatus = await fetchFromApi(`/api/paper/audio/${paper_id}/status`);
            if (response.job_id && response.status) {
                setJobStatus(response);
                // If the job is completed, fetch the audio overview
                if (response.status === 'completed') {
                    await fetchAudioOverview();
                }
            } else {
                throw new Error('Failed to get job status');
            }
        } catch (err) {
            console.error('Error polling job status:', err);
            // Only show error if we don't already have an audio overview
            // This prevents showing errors after the overview has been successfully fetched
            if (showErrorOnFail) {
                // Don't set error if we already have an audio overview
                // This handles the race condition where polling continues after completion
                if (!audioOverview) {
                    setError('Failed to get job status');
                }
            }
        }
    }, [paper_id, fetchAudioOverview, audioOverview]);



    const fetchAllAudioOverviews = async () => {
        try {
            const response: AudioOverview[] = await fetchFromApi(`/api/paper/audio/all/${paper_id}`);
            return response;
        } catch (err) {
            console.error('Error fetching all audio overviews:', err);
            setError('Failed to fetch audio overviews');
            return [];
        }
    };

    const fetchAudioOverviewById = async (audioId: string) => {
        try {
            const response: AudioOverview = await fetchFromApi(`/api/paper/audio/file/${audioId}`);
            return response;
        } catch (err) {
            console.error('Error fetching audio overview by ID:', err);
            setError('Failed to fetch audio overview');
            return null;
        }
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

    // Preview voice using Web Speech API (client-side preview)
    const previewVoice = (voiceId: VoiceOption) => {
        const voice = VOICE_OPTIONS.find(v => v.id === voiceId);
        if (!voice) return;

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        setPreviewingVoice(voiceId);

        const utterance = new SpeechSynthesisUtterance(voice.sampleText);

        // Adjust speech parameters based on voice character
        if (voiceId === 'onyx') {
            utterance.pitch = 0.8;
            utterance.rate = 0.9;
        } else if (voiceId === 'shimmer') {
            utterance.pitch = 1.2;
            utterance.rate = 1.0;
        } else {
            utterance.pitch = 1.0;
            utterance.rate = 1.0;
        }

        utterance.onend = () => setPreviewingVoice(null);
        utterance.onerror = () => setPreviewingVoice(null);

        window.speechSynthesis.speak(utterance);
    };

    const stopPreview = () => {
        window.speechSynthesis.cancel();
        setPreviewingVoice(null);
    };

    return (
        <div className="rounded-lg py-2 h-full w-full px-2 md:px-0">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <FileAudio className="w-5 h-5" />
                    Audio Overview
                </h3>

                {/* Previous Audio Overviews Dropdown */}
                {allAudioOverviews.length > 1 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="flex items-center gap-2">
                                <History className="w-4 h-4" />
                                Previous ({allAudioOverviews.length - 1})
                                <ChevronDown className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80">
                            <DropdownMenuLabel>Select an audio overview to play</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {allAudioOverviews
                                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                .map((overview) => (
                                    <DropdownMenuItem
                                        key={overview.id}
                                        onClick={() => handleAudioOverviewSelect(overview.id)}
                                        className={`p-3 cursor-pointer ${selectedAudioId === overview.id ? 'bg-accent' : ''}`}
                                    >
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium truncate">
                                                    {overview.title || 'Audio Overview'}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    {new Date(overview.created_at).toLocaleDateString('en-US', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </div>
                                            </div>
                                            {selectedAudioId === overview.id && (
                                                <div className="ml-2">
                                                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                                </div>
                                            )}
                                        </div>
                                    </DropdownMenuItem>
                                ))
                            }
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                    {error}
                </div>
            )}

            {/* No audio overview exists or showing generation form */}
            {((!audioOverview && !jobStatus && isInitialLoadDone) || showGenerationForm) && (
                <div className="text-center py-4">
                    <div className="bg-blue-50 dark:bg-blue-950 rounded-xl p-4 md:p-6 max-w-lg mx-auto max-h-[70vh] overflow-y-auto">
                        <Mic className="w-12 h-12 text-blue-500 mx-auto mb-3" />
                        <h3 className="text-lg font-semibold text-foreground mb-1">
                            Audio Overview
                        </h3>
                        <p className="text-muted-foreground text-sm mb-6">
                            Generate a spoken summary of this paper
                        </p>

                        {/* Summary Focus Options */}
                        <div className="mb-5 text-left">
                            <Label className="block text-sm font-medium text-foreground mb-2">
                                Focus
                            </Label>
                            <div className="grid grid-cols-2 gap-2">
                                {FOCUS_OPTIONS.map((focus) => (
                                    <Button
                                        key={focus.id}
                                        variant="outline"
                                        onClick={() => {
                                            setSelectedFocus(focus.id);
                                            setAdditionalInstructions(focus.instructions);
                                        }}
                                        className={`px-3 py-2 text-sm border rounded-lg font-medium transition-colors flex flex-col items-start h-auto ${selectedFocus === focus.id ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                    >
                                        <span className="font-medium text-xs">{focus.name}</span>
                                        <span className="text-xs text-muted-foreground">{focus.description}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {/* Length Selection */}
                        <div className="mb-5 text-left">
                            <Label className="block text-sm font-medium text-foreground mb-2">
                                Length
                            </Label>
                            <div className="grid grid-cols-3 gap-2">
                                {LENGTH_OPTIONS.map((length) => (
                                    <Button
                                        key={length.id}
                                        variant="outline"
                                        onClick={() => setSelectedLength(length.id)}
                                        className={`px-2 py-2 text-sm border rounded-lg font-medium transition-colors flex flex-col items-center ${selectedLength === length.id ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                    >
                                        <span className="font-medium text-xs">{length.name}</span>
                                        <span className="text-xs text-muted-foreground">{length.description}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {/* Voice Selection with Preview */}
                        <div className="mb-5 text-left">
                            <Label className="block text-sm font-medium text-foreground mb-2">
                                Voice
                            </Label>
                            <div className="grid grid-cols-3 gap-2">
                                {VOICE_OPTIONS.map((voice) => (
                                    <div key={voice.id} className="relative">
                                        <Button
                                            variant="outline"
                                            onClick={() => setSelectedVoice(voice.id)}
                                            className={`w-full px-2 py-2 text-sm border rounded-lg font-medium transition-colors flex flex-col items-center h-auto ${selectedVoice === voice.id ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                        >
                                            <span className="font-medium text-xs">{voice.name}</span>
                                            <span className="text-xs text-muted-foreground">{voice.description}</span>
                                        </Button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                previewingVoice === voice.id ? stopPreview() : previewVoice(voice.id);
                                            }}
                                            className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center shadow-sm"
                                            title={previewingVoice === voice.id ? 'Stop preview' : 'Preview voice'}
                                        >
                                            <Volume2 className={`w-3 h-3 ${previewingVoice === voice.id ? 'animate-pulse' : ''}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 text-center">
                                Click the speaker icon to preview
                            </p>
                        </div>

                        {/* Custom Instructions - Collapsible */}
                        <details className="mb-5 text-left">
                            <summary className="cursor-pointer text-sm font-medium text-foreground flex items-center gap-1">
                                <ChevronDown className="w-4 h-4" />
                                Custom Instructions
                            </summary>
                            <textarea
                                value={additionalInstructions}
                                onChange={(e) => setAdditionalInstructions(e.target.value)}
                                placeholder="Add specific guidance for your audio overview"
                                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none mt-2"
                                rows={3}
                            />
                        </details>

                        <div className="flex gap-3 justify-center">
                            {showGenerationForm && audioOverview && (
                                <button
                                    onClick={() => {
                                        setShowGenerationForm(false);
                                        setAdditionalInstructions(DEFAULT_INSTRUCTIONS);
                                        setSelectedVoice('nova');
                                        setSelectedLength('medium');
                                        setSelectedFocus('summary');
                                        stopPreview();
                                    }}
                                    className="px-5 py-2 text-secondary-foreground border border-border rounded-lg font-medium hover:bg-accent transition-colors text-sm"
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    stopPreview();
                                    createAudioOverview(additionalInstructions, selectedVoice, selectedLength);
                                    setShowGenerationForm(false);
                                }}
                                disabled={isLoading || isAudioOverviewAtLimit(subscription)}
                                className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium text-sm shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
                            >
                                <Play className="w-4 h-4" />
                                {isLoading ? 'Generating...' : isAudioOverviewAtLimit(subscription) ? 'Limit Reached' : 'Generate'}
                            </button>
                        </div>

                        {/* Show limit reached message if at 100% */}
                        {isAudioOverviewAtLimit(subscription) && (
                            <div className="text-red-600 dark:text-red-400 text-sm mt-4 p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                                <div className="flex items-center gap-2">
                                    <HelpCircle className="w-4 h-4" />
                                    <span className="font-semibold">Audio Overview Limit Reached</span>
                                </div>
                                <p className="mt-1">You&apos;ve used all your monthly audio overviews. Credits reset every Monday at 12 AM UTC.</p>
                                <Link
                                    href="/pricing"
                                    className="text-blue-500 hover:text-blue-700 font-medium"
                                >
                                    Upgrade for more audio overviews →
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Job in progress */}
            {jobStatus && !audioOverview && (
                <div className="text-center py-8">
                    <div className="bg-blue-50 dark:bg-blue-950 rounded-xl p-4 md:p-8">
                        <div className="inline-flex items-center space-x-2 mb-6">
                            {(jobStatus.status === 'pending' || jobStatus.status === 'running') && (
                                <EnigmaticLoadingExperience />
                            )}
                        </div>
                        <div className="mb-4">
                            <Badge
                                variant="outline"
                                className={`text-sm px-3 py-1 ${getStatusColor(jobStatus.status)}`}
                            >
                                {jobStatus.status.charAt(0).toUpperCase() + jobStatus.status.slice(1)}
                            </Badge>
                        </div>
                        <p className="text-primary text-lg">
                            {jobStatus.status === 'pending' && 'Preparing your audio overview'}
                            {jobStatus.status === 'running' && loadingText}
                            {jobStatus.status === 'failed' && 'Audio overview generation failed. Please try again.'}
                        </p>
                        {jobStatus.status === 'failed' && (
                            <button
                                onClick={() => setShowGenerationForm(true)}
                                className="mt-6 bg-blue-500 text-white px-6 py-2 rounded-lg font-medium"
                            >
                                Try Again
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Enhanced Audio Player */}
            {audioOverview && !showGenerationForm && (
                <div className="space-y-6">
                    {/* Audio Overview Credit Usage Display */}
                    {audioCreditUsage && audioCreditUsage.showWarning && (
                        <div className={`text-xs px-2 py-1 mt-4 ${audioCreditUsage.isCritical ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} justify-between flex`}>
                            <div className="font-semibold">{audioCreditUsage.used} audio overviews used</div>
                            <div className="font-semibold">
                                <HoverCard>
                                    <HoverCardTrigger asChild>
                                        <span>{audioCreditUsage.remaining} remaining</span>
                                    </HoverCardTrigger>
                                    <HoverCardContent side="top" className="w-48">
                                        <p className="text-sm">Resets on {nextMonday.toLocaleDateString()}</p>
                                    </HoverCardContent>
                                </HoverCard>
                                <Link
                                    href="/pricing"
                                    className="text-blue-500 hover:text-blue-700 ml-1"
                                >
                                    Upgrade
                                </Link>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-secondary-foreground flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {new Date(audioOverview.created_at).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </div>
                        <div className="flex gap-2">
                            <a
                                href={audioOverview.audio_url}
                                download
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-500 text-sm font-medium flex items-center gap-1"
                            >
                                <Download className="w-4 h-4" />
                                Download
                            </a>
                            <button
                                onClick={() => {
                                    setShowGenerationForm(true);
                                    setAdditionalInstructions(DEFAULT_INSTRUCTIONS);
                                    setSelectedVoice('nova');
                                    setSelectedLength('medium');
                                    setSelectedFocus('summary');
                                }}
                                disabled={isLoading || isAudioOverviewAtLimit(subscription)}
                                className={`text-sm font-medium flex items-center gap-1 ${isLoading || isAudioOverviewAtLimit(subscription)
                                    ? 'text-gray-400 cursor-not-allowed'
                                    : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-500'
                                    }`}
                                title={isAudioOverviewAtLimit(subscription) ? 'Audio overview limit reached' : 'Create new audio overview'}
                            >
                                <Plus className="w-4 h-4 mr-1" />
                                {isAudioOverviewAtLimit(subscription) ? 'Limit Reached' : 'New'}
                            </button>
                        </div>
                    </div>

                    <EnhancedAudioPlayer
                        audioOverview={audioOverview}
                        paper_title={paper_title}
                        setExplicitSearchTerm={setExplicitSearchTerm}
                    />
                </div>
            )}
        </div>
    );
}
