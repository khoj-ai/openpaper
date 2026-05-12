'use client'

import { Info, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { OPOnboarding } from "@/components/OPOnboarding";
import { fetchFromApi } from "@/lib/api";

const REFERRAL_STORAGE_KEY = "op_ref";
const REFERRAL_MANUAL_FLAG_KEY = "op_ref_via_manual";

async function attemptReferralAttribution(via_link: boolean) {
	if (typeof window === "undefined") return;
	const code = localStorage.getItem(REFERRAL_STORAGE_KEY);
	if (!code) return;
	try {
		await fetchFromApi("/api/referral/attribute", {
			method: "POST",
			body: JSON.stringify({ code, via_link }),
		});
	} catch (err) {
		// Server returns success:false for invalid codes / late attempts; we
		// don't surface this to the user. Network errors are silent too —
		// the worst case is a missed attribution, not a broken flow.
		console.debug("Referral attribution skipped:", err);
	} finally {
		localStorage.removeItem(REFERRAL_STORAGE_KEY);
		localStorage.removeItem(REFERRAL_MANUAL_FLAG_KEY);
	}
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
			// Brand-new account — attempt referral attribution. The "via_link"
			// distinction is informational; manual code entry also lands here
			// via the same localStorage pipeline.
			const viaLink = localStorage.getItem(REFERRAL_MANUAL_FLAG_KEY) !== "true";
			void attemptReferralAttribution(viaLink);
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
		return (
			<div className="flex flex-col items-center justify-start min-h-[calc(100vh-64px)] p-4 md:pt-16">
				<div className="container mx-auto flex flex-col items-center justify-start">
					<div className="w-full md:max-w-1/2">
						<h2 className="text-2xl font-bold text-center mb-4">Welcome to Open Paper</h2>
						<p className="text-muted-foreground mb-8 text-left">We want to make it 10x easier for you to read over large sets of documents, without sacrificing quality.</p>
						<p className="text-muted-foreground mb-8 text-left">A couple of questions below will help us craft a better experience for you.</p>
						<OPOnboarding />
					</div>
				</div>
			</div>
		);
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
