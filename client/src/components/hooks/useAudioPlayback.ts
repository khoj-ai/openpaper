"use client";

import { useState, useRef, useCallback } from "react";
import { fetchFromApi } from "@/lib/api";

export interface AudioProgress {
    currentTime: number;
    duration: number;
}

export interface UseAudioPlaybackReturn {
    // State
    playingAudioId: string | null;
    loadingAudioId: string | null;
    activatedAudioIds: string[];
    audioProgress: { [key: string]: AudioProgress };
    audioVolume: { [key: string]: number };
    audioSpeed: { [key: string]: number };

    // Actions
    handlePlayAudio: (audioOverviewId: string) => Promise<void>;
    handleSeek: (audioOverviewId: string, percentage: number) => void;
    handleVolumeChange: (audioOverviewId: string, volume: number) => void;
    handleSpeedChange: (audioOverviewId: string, speed: number) => void;
    skipBackward: (audioOverviewId: string) => void;
    skipForward: (audioOverviewId: string) => void;

    // Utilities
    formatTime: (time: number) => string;
    getProgressPercentage: (audioOverviewId: string) => number;
}

export function useAudioPlayback(projectId: string): UseAudioPlaybackReturn {
    const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
    const [activatedAudioIds, setActivatedAudioIds] = useState<string[]>([]);
    const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
    const [audioProgress, setAudioProgress] = useState<{ [key: string]: AudioProgress }>({});
    const [audioVolume, setAudioVolume] = useState<{ [key: string]: number }>({});
    const [audioSpeed, setAudioSpeed] = useState<{ [key: string]: number }>({});
    const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

    const handlePlayAudio = useCallback(async (audioOverviewId: string) => {
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
    }, [projectId, playingAudioId, activatedAudioIds]);

    const handleSeek = useCallback((audioOverviewId: string, percentage: number) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio && !isNaN(audio.duration)) {
            audio.currentTime = (percentage / 100) * audio.duration;
        }
    }, []);

    const handleVolumeChange = useCallback((audioOverviewId: string, volume: number) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.volume = volume;
            setAudioVolume(prev => ({ ...prev, [audioOverviewId]: volume }));
        }
    }, []);

    const handleSpeedChange = useCallback((audioOverviewId: string, speed: number) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.playbackRate = speed;
            setAudioSpeed(prev => ({ ...prev, [audioOverviewId]: speed }));
        }
    }, []);

    const skipBackward = useCallback((audioOverviewId: string) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
        }
    }, []);

    const skipForward = useCallback((audioOverviewId: string) => {
        const audio = audioRefs.current[audioOverviewId];
        if (audio) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
        }
    }, []);

    const formatTime = useCallback((time: number) => {
        if (!isFinite(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, []);

    const getProgressPercentage = useCallback((audioOverviewId: string) => {
        const progress = audioProgress[audioOverviewId];
        return progress && progress.duration ? (progress.currentTime / progress.duration) * 100 : 0;
    }, [audioProgress]);

    return {
        // State
        playingAudioId,
        loadingAudioId,
        activatedAudioIds,
        audioProgress,
        audioVolume,
        audioSpeed,

        // Actions
        handlePlayAudio,
        handleSeek,
        handleVolumeChange,
        handleSpeedChange,
        skipBackward,
        skipForward,

        // Utilities
        formatTime,
        getProgressPercentage,
    };
}
