"use client"

import { Info, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import confetti from 'canvas-confetti';

function Welcome() {
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const timer = setTimeout(() => setIsLoading(false), 2000); // Simulate loading
		return () => clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (!isLoading) {
			const duration = 1.5 * 1000;
			const animationEnd = Date.now() + duration;
			const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

			const randomInRange = (min: number, max: number) =>
				Math.random() * (max - min) + min;

			const interval = window.setInterval(() => {
				const timeLeft = animationEnd - Date.now();

				if (timeLeft <= 0) {
					return clearInterval(interval);
				}

				const particleCount = 50 * (timeLeft / duration);
				confetti({
					...defaults,
					particleCount,
					origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
				});
				confetti({
					...defaults,
					particleCount,
					origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
				});
			}, 250);
		}
	}, [isLoading]);

	return (
		<div className="relative flex items-center justify-center min-h-[calc(100vh-64px)]">
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-background z-10">
					<div className="text-center">
						<div className="h-full flex flex-col items-center justify-center py-8 space-y-6">
							<Loader2 className="h-12 w-12 animate-spin text-primary" />
						</div>
						<h2 className="text-xl font-medium">Before we get started...</h2>
						<p className="text-muted-foreground">Let&apos;s get you set up with a few quick questions.</p>
					</div>
				</div>
			)}
			<iframe
				src="https://airtable.com/embed/appsoVzfoZWtdO8bA/pagAX3R0B2lBJxuTS/form?backgroundColor=transparent&prefill_source=embed_form"
				width="100%"
				height="100%"
				className="bg-transparent border-none"
				onLoad={() => setIsLoading(false)}
			></iframe>
		</div>
	);
}

function CallbackContent() {

	const router = useRouter();
	const searchParams = useSearchParams();
	const [error, setError] = useState<string | null>(null);
	const [showWelcome, setShowWelcome] = useState(false);

	useEffect(() => {
		// Process the OAuth callback
		const params = new URLSearchParams(window.location.search);
		const success = params.get('success') === 'true';
		const welcome = params.get('welcome') === 'true';
		setShowWelcome(welcome);

		if (welcome) {
			return
		}
		else if (success) {
			const returnTo = localStorage.getItem('returnTo') || '/';
			localStorage.removeItem('returnTo');
			router.push(returnTo);
			return;
		} else {
			setError("Authentication failed. Please try again.");
			setTimeout(() => router.push('/login?error=authentication_error'), 2000);
			return;
		}
	}, [searchParams, router]);

	if (error) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<div className="text-center">
					<div className="mx-auto mb-4 rounded-full bg-red-100 p-3 text-red-600">
						<Info className="h-6 w-6" />
					</div>
					<h2 className="text-xl font-medium">Authentication Failed</h2>
					<p className="text-muted-foreground">{error}</p>
					<p className="mt-4 text-sm text-muted-foreground">Redirecting to login page...</p>
				</div>
			</div>
		);
	}

	if (showWelcome) {
		return <Welcome />;
	}

	return (
		<div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
			<div className="text-center">
				<div className="h-full flex flex-col items-center justify-center py-8 space-y-6">
					<Loader2 className="h-12 w-12 animate-spin text-primary" />
				</div>
				<h2 className="text-xl font-medium">Completing sign in...</h2>
				<p className="text-muted-foreground">Please wait while we finish authenticating your account.</p>
			</div>
		</div>
	);
}

export default function AuthCallback() {
	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center min-h-screen">
					<div className="text-center">
						<div className="h-full flex flex-col items-center justify-center py-8 space-y-6">
							<Loader2 className="h-12 w-12 animate-spin text-primary" />
						</div>
						<h2 className="text-xl font-medium">Loading...</h2>
					</div>
				</div>
			}
		>
			<CallbackContent />
		</Suspense>
	);
}
