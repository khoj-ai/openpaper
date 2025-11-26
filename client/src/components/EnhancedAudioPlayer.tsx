"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { AudioOverview, Reference } from '@/lib/schema';
import CustomCitationLink from '@/components/utils/CustomCitationLink';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import Markdown from 'react-markdown';

interface EnhancedAudioPlayerProps {
    audioOverview: AudioOverview;
    paper_title?: string;
    setExplicitSearchTerm: (term: string) => void;
}

export function EnhancedAudioPlayer({ audioOverview, paper_title, setExplicitSearchTerm }: EnhancedAudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isLoaded, setIsLoaded] = useState(false);
    const [waveformData, setWaveformData] = useState<number[]>([]);
    const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);

    const generateWaveformData = useCallback(async () => {
        if (!audioOverview?.audio_url) return;

        try {
            const response = await fetch(audioOverview.audio_url);
            const arrayBuffer = await response.arrayBuffer();
            const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const channelData = audioBuffer.getChannelData(0);
            const samples = 200;
            const blockSize = Math.floor(channelData.length / samples);
            const filteredData = [];

            for (let i = 0; i < samples; i++) {
                const blockStart = blockSize * i;
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.pow(channelData[blockStart + j], 2);
                }
                const rms = Math.sqrt(sum / blockSize);
                filteredData.push(rms);
            }

            const maxValue = Math.max(...filteredData);
            const normalizedData = filteredData.map(value => value / maxValue);

            setWaveformData(normalizedData);
        } catch (error) {
            console.error('Error generating waveform data:', error);
            generateMockWaveformDataFallback();
        }
    }, [audioOverview?.audio_url]);

    const generateMockWaveformDataFallback = useCallback(() => {
        const points = 200;
        const data = [];
        for (let i = 0; i < points; i++) {
            const base = Math.sin(i * 0.1) * 0.5;
            const noise = (Math.random() - 0.5) * 0.3;
            const envelope = Math.sin((i / points) * Math.PI) * 0.8;
            data.push(Math.abs((base + noise) * envelope));
        }
        setWaveformData(data);
    }, []);

    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || waveformData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        const progress = duration > 0 ? currentTime / duration : 0;

        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);

        const barWidth = width / waveformData.length;
        const centerY = height / 2;

        waveformData.forEach((value, index) => {
            const barHeight = Math.abs(value) * (height * 0.8);
            const x = index * barWidth;
            const isPlayed = (index / waveformData.length) <= progress;

            ctx.fillStyle = isPlayed ? '#3b82f6' : '#e5e7eb';
            ctx.fillRect(x, centerY - barHeight / 2, barWidth - 1, barHeight);
        });

        const progressX = progress * width;
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(progressX, 0);
        ctx.lineTo(progressX, height);
        ctx.stroke();
    }, [waveformData, currentTime, duration]);

    useEffect(() => {
        if (audioOverview?.audio_url) {
            generateWaveformData();
        }
    }, [generateWaveformData]);

    useEffect(() => {
        drawWaveform();
    }, [drawWaveform]);

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


    const matchesCurrentCitation = useCallback((key: string) => {
        return activeCitationKey === key;
    }, [activeCitationKey]);

    const handleCitationClick = (citationKey: string, messageIndex: number) => {
        const citationIndex = parseInt(citationKey);
        console.debug(`Index: ${citationIndex}, Message Index: ${messageIndex}`);
        // Look up the citations terms from the citationKey
        const citationMatch = audioOverview?.citations.find(c => c.index === citationIndex);
        setExplicitSearchTerm(citationMatch ? citationMatch.text : citationKey);
        setActiveCitationKey(citationKey);
        setTimeout(() => setActiveCitationKey(null), 3000);
    };

    const handleCitationClickFromTranscript = (citationKey: string, messageIndex: number) => {
        const citationIndex = parseInt(citationKey);
        console.debug(`Index: ${citationIndex}, Message Index: ${messageIndex}`);
        // Look up the citations terms from the citationKey
        const citationMatch = audioOverview?.citations.find(c => c.index === citationIndex);
        setExplicitSearchTerm(citationMatch ? citationMatch.text : citationKey);
        setActiveCitationKey(citationKey);
        setTimeout(() => setActiveCitationKey(null), 3000);
    };


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


            {/* Transcript */}
            {audioOverview.transcript && (
                <Markdown
                    components={{
                        // Apply the custom component to text nodes
                        p: (props) => <CustomCitationLink
                            {...props}
                            handleCitationClick={handleCitationClickFromTranscript}
                            messageIndex={0}
                            citations={audioOverview.citations.map(c => ({ key: String(c.index), reference: c.text }))}
                        />,
                        li: (props) => <CustomCitationLink
                            {...props}
                            handleCitationClick={handleCitationClickFromTranscript}
                            messageIndex={0}
                            citations={audioOverview.citations.map(c => ({ key: String(c.index), reference: c.text }))}
                        />,
                        div: (props) => <CustomCitationLink
                            {...props}
                            handleCitationClick={handleCitationClickFromTranscript}
                            messageIndex={0}
                            citations={audioOverview.citations.map(c => ({ key: String(c.index), reference: c.text }))}
                        />,
                        td: (props) => <CustomCitationLink
                            {...props}
                            handleCitationClick={handleCitationClickFromTranscript}
                            messageIndex={0}
                            citations={audioOverview.citations.map(c => ({ key: String(c.index), reference: c.text }))}
                        />,
                        table: (props) => (
                            <div className="w-full overflow-x-auto">
                                <table {...props} className="min-w-full border-collapse" />
                            </div>
                        ),
                    }}
                >
                    {audioOverview.transcript}
                </Markdown>
            )}

            {/* Citations */}
            {audioOverview.citations && audioOverview.citations.length > 0 ? (
                <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-700" id="references-section">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold mb-2">References</h4>
                        <ChatMessageActions
                            message={audioOverview.transcript}
                            references={{
                                citations: audioOverview.citations.map(c => ({ key: String(c.index), reference: c.text }))
                            }}
                        />
                    </div>
                    <ul className="list-none p-0">
                        {audioOverview.citations.map((citation) => (
                            <div
                                key={citation.index}
                                className={`flex flex-row gap-2 animate-fade-in ${matchesCurrentCitation(String(citation.index)) ? 'bg-blue-100 dark:bg-blue-900 rounded p-1 transition-colors duration-300' : ''}`}
                                onClick={() => handleCitationClick(String(citation.index), 0)}
                            >
                                <div className={`text-xs text-secondary-foreground`}>
                                    <a href={`#citation-ref-${citation.index}`}>{citation.index}</a>
                                </div>
                                <div
                                    id={`citation-ref-${citation.index}`}
                                    className={`text-xs text-secondary-foreground`}
                                >
                                    {citation.text}
                                </div>
                            </div>
                        ))}
                    </ul>
                </div>
            ) : (
                <ChatMessageActions
                    message={audioOverview.transcript}
                    references={{
                        citations: audioOverview.citations?.map(c => ({ key: String(c.index), reference: c.text })) || []
                    }}
                />
            )}
        </div>
    );
}
