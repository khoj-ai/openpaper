import { fetchFromApi } from '@/lib/api';
import { Pause, Play, RotateCcw, Volume2, Download, Clock, FileAudio, History, ChevronDown, Plus, Mic } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import EnigmaticLoadingExperience from './EnigmaticLoadingExperience';
import { Badge } from '@/components/ui/badge';
import Markdown from 'react-markdown';
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { JobStatusType, ReferenceCitation } from '@/lib/schema';

interface AudioOverviewProps {
    paper_id: string;
    paper_title?: string;
    setExplicitSearchTerm: (term: string) => void;
}

interface AudioOverview {
    id: string;
    paper_id: string;
    audio_url: string;
    transcript: string;
    title: string;
    citations: ReferenceCitation[];
    created_at: string;
    updated_at: string;
    job_id: string;
}

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

const DEFAULT_INSTRUCTIONS = 'Please summarize the key points of this paper, focusing on the methodology and results. Make it concise and easy to understand.';

export function AudioOverview({ paper_id, paper_title, setExplicitSearchTerm }: AudioOverviewProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const [selectedFocus, setSelectedFocus] = useState<string | null>(null);

    const [additionalInstructions, setAdditionalInstructions] = useState(DEFAULT_INSTRUCTIONS);

    // Enhanced audio states
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isLoaded, setIsLoaded] = useState(false);
    const [waveformData, setWaveformData] = useState<number[]>([]);

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

    // Audio event listeners
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
            setIsLoaded(true);
        };

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

        const handleLoadStart = () => {
            setIsLoaded(false);
        };

        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('loadstart', handleLoadStart);

        return () => {
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('loadstart', handleLoadStart);
        };
    }, [audioOverview]);


    // Generate mock waveform data
    const generateWaveformData = useCallback(async () => {
        if (!audioOverview?.audio_url) return;

        try {
            // Fetch the audio file
            const response = await fetch(audioOverview.audio_url);
            const arrayBuffer = await response.arrayBuffer();

            // Create audio context
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Get audio data from the first channel
            const channelData = audioBuffer.getChannelData(0);
            const samples = 200; // Number of bars in waveform
            const blockSize = Math.floor(channelData.length / samples);
            const filteredData = [];

            // Process audio data into waveform points
            for (let i = 0; i < samples; i++) {
                const blockStart = blockSize * i;
                let sum = 0;

                // Calculate RMS (Root Mean Square) for each block
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.pow(channelData[blockStart + j], 2);
                }

                // Normalize the value
                const rms = Math.sqrt(sum / blockSize);
                filteredData.push(rms);
            }

            // Normalize to 0-1 range
            const maxValue = Math.max(...filteredData);
            const normalizedData = filteredData.map(value => value / maxValue);

            setWaveformData(normalizedData);
        } catch (error) {
            console.error('Error generating waveform data:', error);
            // Fallback to mock data if audio processing fails
            generateMockWaveformDataFallback();
        }
    }, [audioOverview?.audio_url]);

    // Keep the mock data generation as a fallback
    const generateMockWaveformDataFallback = useCallback(() => {
        const points = 200;
        const data = [];
        for (let i = 0; i < points; i++) {
            // Create a more realistic waveform pattern
            const base = Math.sin(i * 0.1) * 0.5;
            const noise = (Math.random() - 0.5) * 0.3;
            const envelope = Math.sin((i / points) * Math.PI) * 0.8;
            data.push(Math.abs((base + noise) * envelope));
        }
        setWaveformData(data);
    }, []);

    // Draw waveform on canvas
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || waveformData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        const progress = duration > 0 ? currentTime / duration : 0;

        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw waveform
        const barWidth = width / waveformData.length;
        const centerY = height / 2;

        waveformData.forEach((value, index) => {
            const barHeight = Math.abs(value) * (height * 0.8);
            const x = index * barWidth;
            const isPlayed = (index / waveformData.length) <= progress;

            // Set color based on whether this part has been played
            ctx.fillStyle = isPlayed ? '#3b82f6' : '#e5e7eb';

            // Draw the bar
            ctx.fillRect(x, centerY - barHeight / 2, barWidth - 1, barHeight);
        });

        // Draw progress line
        const progressX = progress * width;
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(progressX, 0);
        ctx.lineTo(progressX, height);
        ctx.stroke();
    }, [waveformData, currentTime, duration]);

    // Generate waveform data on component mount
    useEffect(() => {
        if (audioOverview?.audio_url) {
            generateWaveformData();
        }
    }, [generateWaveformData]);

    // Redraw waveform when data or time changes
    useEffect(() => {
        drawWaveform();
    }, [drawWaveform]);

    const checkExistingAudioOverview = async () => {
        try {
            console.debug(`Job ID: ${audioOverviewJobId}, Paper ID: ${paper_id}`);
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
            console.log('Error checking existing audio overview:', err);
            await pollJobStatus(false); // Don't show error if no overview exists
        } finally {
            setIsInitialLoadDone(true);
        }
    };

    const loadAllAudioOverviews = async () => {
        const overviews = await fetchAllAudioOverviews();
        setAllAudioOverviews(overviews);
    };

    const createAudioOverview = async (additionalInstructions: string) => {
        setIsLoading(true);
        setError(null);

        const body: AudioOverviewCreateRequestBody = {
            additional_instructions: additionalInstructions,
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
                setAudioOverview(null);
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
            // Reset audio states
            setIsPlaying(false);
            setCurrentTime(0);
            setIsLoaded(false);
        }
    };

    const fetchAudioOverview = useCallback(async () => {
        try {
            const response: AudioOverview = await fetchFromApi(`/api/paper/audio/${paper_id}/file`);
            if (response) {
                setAudioOverview(response);
                setJobStatus(null); // Clear job status since we have the overview now

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
            if (showErrorOnFail) {
                setError('Failed to get job status');
            }
        }
    }, [paper_id, fetchAudioOverview]);

    const handleCitationClick = (citationKey: string, messageIndex: number) => {
        const citationIndex = parseInt(citationKey);
        console.debug(`Index: ${citationIndex}, Message Index: ${messageIndex}`);
        // Look up the citations terms from the citationKey
        const citationMatch = audioOverview?.citations.find(c => c.index === citationIndex);
        setExplicitSearchTerm(citationMatch ? citationMatch.text : citationKey);
    };

    const handleCitationClickFromTranscript = (citationKey: string, messageIndex: number) => {
        const citationIndex = parseInt(citationKey);
        console.debug(`Index: ${citationIndex}, Message Index: ${messageIndex}`);
        // Look up the citations terms from the citationKey
        const citationMatch = audioOverview?.citations.find(c => c.index === citationIndex);
        setExplicitSearchTerm(citationMatch ? citationMatch.text : citationKey);
    };

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

    const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        const audio = audioRef.current;
        if (!canvas || !audio || !isLoaded) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const progress = x / canvas.width;
        const newTime = progress * duration;

        audio.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const togglePlayback = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        } else {
            audio.play();
            setIsPlaying(true);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const audio = audioRef.current;
        if (!audio) return;

        const newVolume = parseFloat(e.target.value);
        audio.volume = newVolume;
        setVolume(newVolume);
    };

    const handleSpeedChange = (speed: number) => {
        const audio = audioRef.current;
        if (!audio) return;

        audio.playbackRate = speed;
        setPlaybackRate(speed);
    };

    const skipBackward = () => {
        const audio = audioRef.current;
        if (!audio) return;

        audio.currentTime = Math.max(0, audio.currentTime - 10);
    };

    const skipForward = () => {
        const audio = audioRef.current;
        if (!audio) return;

        audio.currentTime = Math.min(duration, audio.currentTime + 10);
    };

    const formatTime = (time: number) => {
        if (!isFinite(time)) return '0:00';

        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
        <div className="rounded-lg py-2 h-full w-full">
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
                <div className="text-center py-8">
                    <div className="bg-blue-50 dark:bg-blue-950 rounded-xl p-8 max-w-lg mx-auto">
                        <Mic className="w-16 h-16 text-blue-500 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">
                            Audio Overview
                        </h3>
                        <p className="text-muted-foreground mb-8">
                            Generate a spoken summary of this paper
                        </p>

                        {/* Summary Focus Options */}
                        <div className="mb-6 text-left">
                            <Label className="block text-sm font-medium text-foreground mb-3">
                                Summary Focus
                            </Label>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    variant={'outline'}
                                    onClick={() => {
                                        setAdditionalInstructions(`${DEFAULT_INSTRUCTIONS} Focus on the key results and findings of this paper.`);
                                        setSelectedFocus('key-results');
                                    }}
                                    className={`px-4 py-3 text-sm border rounded-lg font-medium transition-colors ${selectedFocus === 'key-results' ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                >
                                    Key Results
                                </Button>
                                <Button
                                    variant={'outline'}
                                    onClick={() => {
                                        setAdditionalInstructions(`${DEFAULT_INSTRUCTIONS} Focus on the methodology and approach used in this paper.`);
                                        setSelectedFocus('methodology');
                                    }}
                                    className={`px-4 py-3 text-sm border rounded-lg font-medium transition-colors ${selectedFocus === 'methodology' ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                >
                                    Methodology
                                </Button>
                                <Button
                                    variant={'outline'}
                                    onClick={() => {
                                        setAdditionalInstructions(`${DEFAULT_INSTRUCTIONS} Provide a comprehensive summary of the entire paper.`);
                                        setSelectedFocus('full-paper');
                                    }}
                                    className={`px-4 py-3 text-sm border rounded-lg font-medium transition-colors ${selectedFocus === 'full-paper' ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                >
                                    Full Paper
                                </Button>
                                <Button
                                    variant={'outline'}
                                    onClick={() => {
                                        setAdditionalInstructions(`${DEFAULT_INSTRUCTIONS} Focus only on the abstract and main conclusions.`);
                                        setSelectedFocus('abstract-only');
                                    }}
                                    className={`px-4 py-3 text-sm border rounded-lg font-medium transition-colors ${selectedFocus === 'abstract-only' ? 'border-blue-300 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800' : 'border-border hover:bg-accent'}`}
                                >
                                    Abstract Only
                                </Button>
                            </div>
                        </div>

                        {/* Custom Instructions - Collapsible */}
                        <details className="mb-6 text-left">
                            <summary className="cursor-pointer text-sm font-medium text-foreground mb-3 flex items-center justify-between">
                                Custom Instructions
                                <ChevronDown className="w-4 h-4" />
                            </summary>
                            <textarea
                                value={additionalInstructions}
                                onChange={(e) => setAdditionalInstructions(e.target.value)}
                                placeholder="Add specific guidance for your audio overview (optional)"
                                className="w-full px-3 py-3 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none mt-2"
                                rows={4}
                            />
                        </details>

                        <div className="flex gap-3 justify-center">
                            {showGenerationForm && audioOverview && (
                                <button
                                    onClick={() => {
                                        setShowGenerationForm(false);
                                        setAdditionalInstructions(DEFAULT_INSTRUCTIONS);
                                    }}
                                    className="px-6 py-3 text-secondary-foreground border border-border rounded-lg font-medium hover:bg-accent transition-colors"
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    createAudioOverview(additionalInstructions);
                                    setShowGenerationForm(false);
                                }}
                                disabled={isLoading}
                                className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white px-8 py-3 rounded-lg font-medium text-base shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
                            >
                                <Play className="w-4 h-4" />
                                {isLoading ? 'Generating...' : 'Generate Audio Overview'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Job in progress */}
            {jobStatus && !audioOverview && (
                <div className="text-center py-8">
                    <div className="bg-blue-50 dark:bg-blue-950 rounded-xl p-8">
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
                            {jobStatus.status === 'pending' && 'Your audio overview is queued for processing...'}
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
                                }}
                                disabled={isLoading}
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-500 text-sm font-medium flex items-center gap-1"
                            >
                                <Plus className="w-4 h-4 mr-1" />
                                New
                            </button>
                        </div>
                    </div>

                    {/* Enhanced Audio Player */}
                    <div className="bg-secondary rounded-xl p-6 shadow-sm">
                        <audio
                            ref={audioRef}
                            src={audioOverview.audio_url}
                            preload="metadata"
                        />


                        {/* Main Controls */}
                        <div className="flex items-center space-x-4 mb-4">
                            <button
                                onClick={togglePlayback}
                                disabled={!isLoaded}
                                className="bg-blue-500 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
                            >
                                {isPlaying ? (
                                    <Pause className="w-6 h-6" fill="currentColor" />
                                ) : (
                                    <Play className="w-6 h-6" fill="currentColor" />
                                )}
                            </button>

                            <div className="flex-1">
                                <div className="text-lg font-semibold text-secondary-foreground mb-1">
                                    {audioOverview.title || paper_title || 'Audio Overview'}
                                </div>
                                <div className="text-sm text-secondary-foreground">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </div>
                            </div>

                            <div className="flex items-center space-x-2">
                                <Volume2 className="w-4 h-4 text-secondary-foreground" />
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>

                        {/* Waveform Visualization */}
                        <div className="relative">
                            <canvas
                                ref={canvasRef}
                                width={800}
                                height={120}
                                className="w-full h-24 bg-white dark:bg-gray-700 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-600"
                                onClick={handleWaveformClick}
                                style={{ maxWidth: '100%', height: '96px' }}
                            />
                            <div className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                                Click on the waveform to seek
                            </div>
                        </div>

                        {/* Secondary Controls */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={skipBackward}
                                    className="text-accent-foreground p-2 rounded-lg hover:bg-gray-200 transition-colors"
                                    title="Skip back 10s"
                                >
                                    <span className="text-xs">10s</span>
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={skipForward}
                                    className="text-accent-foreground p-2 rounded-lg hover:bg-gray-200 transition-colors"
                                    title="Skip forward 10s"
                                >
                                    <span className="text-xs">10s</span>
                                    <RotateCcw className="w-4 h-4 scale-x-[-1]" />
                                </button>
                            </div>

                            <div className="flex items-center space-x-1">
                                <span className="text-sm text-accent-foreground mr-2">Speed:</span>
                                {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                                    <button
                                        key={speed}
                                        onClick={() => handleSpeedChange(speed)}
                                        className={`px-2 py-1 text-xs rounded ${playbackRate === speed
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            } transition-colors`}
                                    >
                                        {speed}x
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Transcript */}
                    {audioOverview.transcript && (
                        <Markdown
                            components={{
                                // Apply the custom component to text nodes
                                p: (props) => <CustomCitationLink
                                    {...props}
                                    handleCitationClick={handleCitationClickFromTranscript}
                                    messageIndex={0}
                                />,
                                li: (props) => <CustomCitationLink
                                    {...props}
                                    handleCitationClick={handleCitationClickFromTranscript}
                                    messageIndex={0}
                                />,
                                div: (props) => <CustomCitationLink
                                    {...props}
                                    handleCitationClick={handleCitationClickFromTranscript}
                                    messageIndex={0}
                                />,
                                td: (props) => <CustomCitationLink
                                    {...props}
                                    handleCitationClick={handleCitationClickFromTranscript}
                                    messageIndex={0}
                                />,
                            }}
                        >
                            {audioOverview.transcript}
                        </Markdown>
                    )}

                    {/* Citations */}
                    {audioOverview.citations && audioOverview.citations.length > 0 && (
                        <div className="mt-6">
                            <h4 className="text-md font-semibold mb-2">Citations</h4>
                            <div className="space-y-1">
                                {audioOverview.citations.map((citation) => (
                                    <div key={citation.index} className="flex items-center gap-1">
                                        <span className="text-muted-foreground text-xs cursor-pointer"
                                            onClick={() => handleCitationClick(citation.text, 0)}
                                        >
                                            {citation.text}
                                        </span>
                                        <span className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-500">
                                            [{citation.index}]
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
