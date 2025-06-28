"use client";

import React, { useEffect, useState, useRef } from "react";

export default function EnigmaticLoadingExperience() {
    const [scale, setScale] = useState(1);
    const [opacity, setOpacity] = useState(0.8);
    const [rotation, setRotation] = useState(0);
    const animationRef = useRef<number | null>(null);
    const lastTimeRef = useRef(Date.now());

    // Smoother pulsating and rotation animation
    useEffect(() => {
        const animate = () => {
            const currentTime = Date.now();
            const deltaTime = currentTime - lastTimeRef.current;
            lastTimeRef.current = currentTime;

            // Smooth sine wave for pulsating (no random perturbation)
            setScale(() => {
                // Slower, smoother pulse with reduced amplitude
                const newScale = 1 + 0.05 * Math.sin(currentTime / 800);
                return newScale;
            });

            // Smooth opacity changes
            setOpacity(() => {
                // Slower, gentler opacity shift
                const newOpacity = 0.7 + 0.1 * Math.sin(currentTime / 1000);
                return newOpacity;
            });

            // Smooth consistent rotation
            const rotationSpeed = 0.02 * deltaTime; // degrees per millisecond
            setRotation(r => (r + rotationSpeed) % 360);

            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, []);

    // Multiple orbs for a more complex effect
    const orbs = [
        { size: "w-32 h-32", delay: "0", zIndex: "z-30" },
        { size: "w-40 h-40", delay: "500", zIndex: "z-20" },
        { size: "w-48 h-48", delay: "1000", zIndex: "z-10" }
    ];

    return (
        <div className="flex flex-col items-center justify-center h-full w-full p-8">
            <div className="relative h-64 w-64 flex items-center justify-center">
                {orbs.map((orb, index) => (
                    <div
                        key={index}
                        className={`absolute rounded-full ${orb.zIndex} ${orb.size}`}
                        style={{
                            backgroundColor: 'rgba(59, 130, 246, 0.3)',
                            boxShadow: '0 0 40px 10px rgba(59, 130, 246, 0.4)',
                            transform: `scale(${scale}) rotate(${rotation}deg)`,
                            opacity: opacity,
                            filter: 'blur(8px)',
                            transition: 'transform 100ms ease-out, opacity 100ms ease-out'
                        }}
                    />
                ))}

                {/* Center orb with more solid appearance */}
                <div
                    className="absolute rounded-full z-40 w-24 h-24"
                    style={{
                        background: 'radial-gradient(circle, rgba(96, 165, 250, 0.9) 0%, rgba(37, 99, 235, 0.7) 70%)',
                        boxShadow: '0 0 30px 5px rgba(59, 130, 246, 0.6), inset 0 0 15px 5px rgba(219, 234, 254, 0.3)',
                        transform: `scale(${scale * 0.9}) rotate(${-rotation * 0.5}deg)`,
                        opacity: opacity + 0.2,
                        transition: 'transform 100ms ease-out, opacity 100ms ease-out'
                    }}
                />

                {/* Inner glow */}
                <div
                    className="absolute rounded-full z-50 w-12 h-12 bg-blue-200"
                    style={{
                        filter: 'blur(6px)',
                        opacity: 0.7,
                        transform: `scale(${scale * 0.8})`,
                        transition: 'transform 100ms ease-out'
                    }}
                />
            </div>
        </div>
    );
}
