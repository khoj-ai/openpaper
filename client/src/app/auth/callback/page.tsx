"use client"

import { Info, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function CallbackContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [error, setError] = useState<string | null>(null);


	useEffect(() => {
		// Process the OAuth callback
		const params = new URLSearchParams(window.location.search);
		const success = params.get('success') === 'true';

		if (success) {
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

	return (
		<div className="flex items-center justify-center min-h-screen">
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
