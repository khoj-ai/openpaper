"use client";

import { Loader2, Pause, Play, Volume2, RotateCcw } from "lucide-react";
import { AudioOverview, PaperItem } from "@/lib/schema";
import {
    Dialog,
    DialogContent,
    DialogTrigger,
} from "@/components/ui/dialog";
import { RichAudioOverview } from "./RichAudioOverview";
import { AudioProgress } from "./hooks/useAudioPlayback";

interface AudioOverviewCardProps {
    overview: AudioOverview;
    papers: PaperItem[];
    isPlaying: boolean;
    isLoading: boolean;
    isActivated: boolean;
    progress: AudioProgress | undefined;
    volume: number;
    speed: number;
    progressPercentage: number;
    onPlayPause: () => void;
    onSeek: (percentage: number) => void;
    onVolumeChange: (volume: number) => void;
    onSpeedChange: (speed: number) => void;
    onSkipBackward: () => void;
    onSkipForward: () => void;
    formatTime: (time: number) => string;
}

export default function AudioOverviewCard({
    overview,
    papers,
    isPlaying,
    isLoading,
    isActivated,
    progress,
    volume,
    speed,
    progressPercentage,
    onPlayPause,
    onSeek,
    onVolumeChange,
    onSpeedChange,
    onSkipBackward,
    onSkipForward,
    formatTime,
}: AudioOverviewCardProps) {
    return (
        <div className="w-full p-4 border rounded-lg bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <div className="flex items-start gap-3 mb-3">
                <button
                    onClick={onPlayPause}
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

            {isActivated && (
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
                                onChange={(e) => onSeek(Number(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={onSkipBackward}
                                className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                                title="Skip back 10s"
                            >
                                <RotateCcw className="w-4 h-4" />
                            </button>
                            <button
                                onClick={onSkipForward}
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
                                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                                    className="w-16 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                                />
                            </div>

                            {/* Speed Control */}
                            <div className="flex space-x-1">
                                {[0.75, 1, 1.25, 1.5, 2].map((speedOption) => (
                                    <button
                                        key={speedOption}
                                        onClick={() => onSpeedChange(speedOption)}
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
}
