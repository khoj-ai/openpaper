"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { AudioOverview } from '@/lib/schema';
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import Markdown from 'react-markdown';
import { CopyableTable } from '@/components/AnimatedMarkdown';

interface EnhancedAudioPlayerProps {
    audioOverview: AudioOverview;
    paper_title?: string;
    setExplicitSearchTerm: (term: string) => void;
}

// Memoized transcript component to prevent re-renders during audio playback
interface TranscriptSectionProps {
    transcript: string;
    citations: AudioOverview['citations'];
    handleCitationClick: (citationKey: string, messageIndex: number) => void;
}

const TranscriptSection = React.memo(function TranscriptSection({
    transcript,
    citations,
    handleCitationClick,
}: TranscriptSectionProps) {
    const citationsForMarkdown = useMemo(
        () => citations.map(c => ({ key: String(c.index), reference: c.text })),
        [citations]
    );

    const markdownComponents = useMemo(() => ({
        p: (props: React.ComponentProps<'p'>) => <CustomCitationLink
            {...props}
            handleCitationClick={handleCitationClick}
            messageIndex={0}
            citations={citationsForMarkdown}
        />,
        li: (props: React.ComponentProps<'li'>) => <CustomCitationLink
            {...props}
            handleCitationClick={handleCitationClick}
            messageIndex={0}
            citations={citationsForMarkdown}
        />,
        div: (props: React.ComponentProps<'div'>) => <CustomCitationLink
            {...props}
            handleCitationClick={handleCitationClick}
            messageIndex={0}
            citations={citationsForMarkdown}
        />,
        td: (props: React.ComponentProps<'td'>) => <CustomCitationLink
            {...props}
            handleCitationClick={handleCitationClick}
            messageIndex={0}
            citations={citationsForMarkdown}
        />,
        table: CopyableTable,
    }), [citationsForMarkdown, handleCitationClick]);

    return (
        <Markdown components={markdownComponents}>
            {transcript}
        </Markdown>
    );
});

// Memoized references section to prevent re-renders during audio playback
interface ReferencesSectionProps {
    transcript: string;
    citations: AudioOverview['citations'];
    activeCitationKey: string | null;
    handleCitationClick: (citationKey: string, messageIndex: number) => void;
}

const ReferencesSection = React.memo(function ReferencesSection({
    transcript,
    citations,
    activeCitationKey,
    handleCitationClick,
}: ReferencesSectionProps) {
    const citationsForActions = useMemo(
        () => citations.map(c => ({ key: String(c.index), reference: c.text })),
        [citations]
    );

    if (!citations || citations.length === 0) {
        return (
            <ChatMessageActions
                message={transcript}
                references={{ citations: citationsForActions }}
            />
        );
    }

    return (
        <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-700" id="references-section">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold mb-2">References</h4>
                <ChatMessageActions
                    message={transcript}
                    references={{ citations: citationsForActions }}
                />
            </div>
            <ul className="list-none p-0">
                {citations.map((citation) => (
                    <div
                        key={citation.index}
                        className={`flex flex-row gap-2 animate-fade-in ${activeCitationKey === String(citation.index) ? 'bg-blue-100 dark:bg-blue-900 rounded p-1 transition-colors duration-300' : ''}`}
                        onClick={() => handleCitationClick(String(citation.index), 0)}
                    >
                        <div className="text-xs text-secondary-foreground">
                            <a href={`#citation-ref-${citation.index}`}>{citation.index}</a>
                        </div>
                        <div
                            id={`citation-ref-${citation.index}`}
                            className="text-xs text-secondary-foreground"
                        >
                            {citation.text}
                        </div>
                    </div>
                ))}
            </ul>
        </div>
    );
});

export function EnhancedAudioPlayer({ audioOverview, paper_title, setExplicitSearchTerm }: EnhancedAudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isLoaded, setIsLoaded] = useState(false);
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const progressBar = progressRef.current;
        const audio = audioRef.current;
        if (!progressBar || !audio || !isLoaded) return;

        const rect = progressBar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        const newTime = percentage * duration;

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


    const handleCitationClick = useCallback((citationKey: string, messageIndex: number) => {
        const citationIndex = parseInt(citationKey);
        console.debug(`Index: ${citationIndex}, Message Index: ${messageIndex}`);
        // Look up the citations terms from the citationKey
        const citationMatch = audioOverview?.citations.find(c => c.index === citationIndex);
        setExplicitSearchTerm(citationMatch ? citationMatch.text : citationKey);
        setActiveCitationKey(citationKey);
        setTimeout(() => setActiveCitationKey(null), 3000);
    }, [audioOverview?.citations, setExplicitSearchTerm]);


    return (
        <div className="border-t border-gray-200 dark:border-gray-700 p-2">
            <audio
                ref={audioRef}
                src={audioOverview.audio_url}
                preload="metadata"
            />

            <div className="flex items-center space-x-2 md:space-x-4 mb-4">
                <button
                    onClick={togglePlayback}
                    disabled={!isLoaded}
                    className="bg-blue-500 text-white p-3 md:p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
                >
                    {isPlaying ? (
                        <Pause className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" />
                    ) : (
                        <Play className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" />
                    )}
                </button>

                <div className="flex-1 min-w-0">
                    <div className="text-base md:text-lg font-semibold text-secondary-foreground mb-1 truncate">
                        {audioOverview.title || paper_title || 'Audio Overview'}
                    </div>
                    <div className="text-xs md:text-sm text-secondary-foreground">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                </div>

                <div className="hidden md:flex items-center space-x-2">
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

            {/* Progress bar - Spotify style */}
            <div
                ref={progressRef}
                className="relative h-1 bg-gray-300 dark:bg-gray-600 rounded-full cursor-pointer group"
                onClick={handleProgressClick}
            >
                {/* Played portion */}
                <div
                    className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
                    style={{ width: `${progress}%` }}
                />
                {/* Playhead dot */}
                <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `calc(${progress}% - 6px)` }}
                />
            </div>

            <div className="flex flex-col md:flex-row items-center justify-center md:justify-between gap-4 mt-4">
                <div className="flex items-center space-x-2">
                    <button
                        onClick={skipBackward}
                        className="text-accent-foreground p-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1"
                        title="Skip back 10s"
                    >
                        <RotateCcw className="w-4 h-4" />
                        <span className="text-xs font-medium">10s</span>
                    </button>
                    <button
                        onClick={skipForward}
                        className="text-accent-foreground p-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1"
                        title="Skip forward 10s"
                    >
                        <RotateCcw className="w-4 h-4 scale-x-[-1]" />
                        <span className="text-xs font-medium">10s</span>
                    </button>
                </div>

                <div className="flex items-center space-x-1 flex-wrap justify-center">
                    {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                        <button
                            key={speed}
                            onClick={() => handleSpeedChange(speed)}
                            className={`px-3 py-1 text-xs rounded-full ${playbackRate === speed
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                } transition-colors`}
                        >
                            {speed}x
                        </button>
                    ))}
                </div>
            </div>


            {/* Transcript - memoized to prevent re-renders during playback */}
            {audioOverview.transcript && (
                <TranscriptSection
                    transcript={audioOverview.transcript}
                    citations={audioOverview.citations}
                    handleCitationClick={handleCitationClick}
                />
            )}

            {/* Citations - memoized to prevent re-renders during playback */}
            <ReferencesSection
                transcript={audioOverview.transcript}
                citations={audioOverview.citations}
                activeCitationKey={activeCitationKey}
                handleCitationClick={handleCitationClick}
            />
        </div>
    );
}
