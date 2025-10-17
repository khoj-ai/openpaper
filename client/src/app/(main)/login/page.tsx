"use client"

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { fetchFromApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

function LoginContent() {
	const { user, loading, error: authError, login } = useAuth();
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();
	const searchParams = useSearchParams();
	const returnTo = searchParams.get('returnTo') || '/';
	const errorParam = searchParams.get('error');

	const [email, setEmail] = useState('');
	const [showOtp, setShowOtp] = useState(false);
	const [emailError, setEmailError] = useState<string | null>(null);
	const [isEmailLoading, setIsEmailLoading] = useState(false);
	const [showNameInput, setShowNameInput] = useState(false);
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [lastUsedProvider, setLastUsedProvider] = useState<string | null>(null);

	useEffect(() => {
		const storedProvider = localStorage.getItem('signin-provider');
		if (storedProvider) {
			setLastUsedProvider(storedProvider);
		}
	}, []);


	// Handle error query param
	useEffect(() => {
		if (errorParam) {
			switch (errorParam) {
				case 'callback_failed':
					setError('Login failed. Please try again.');
					break;
				case 'authentication_error':
					setError('Authentication error occurred. Please try again.');
					break;
				case 'missing_code':
					setError('Authentication code missing. Please try again.');
					break;
				default:
					setError('An error occurred during login. Please try again.');
			}
		}
	}, [errorParam]);

	// If user is already logged in, redirect to return path
	useEffect(() => {
		if (user && !loading) {
			router.push(returnTo);
		}
	}, [user, loading, router, returnTo]);

	const handleLogin = async () => {
		setError(null);
		localStorage.setItem('signin-provider', 'google');
		await login();
	};

	const handleBackToStart = () => {
		setShowNameInput(false);
		setShowOtp(false);
		setEmailError(null);
	};

	const handleEmailSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		localStorage.setItem('signin-provider', 'email');
		setIsEmailLoading(true);
		setEmailError(null);
		try {
			const data = await fetchFromApi('/api/auth/email/signin', {
				method: 'POST',
				body: JSON.stringify({ email }),
			});
			if (data.success) {
				if (data.newly_created) {
					setShowNameInput(true);
				} else {
					setShowOtp(true);
				}
			} else {
				setEmailError(data.message || 'Failed to send verification code.');
			}
		} catch (error: any) {
			setEmailError(error.message || 'An unexpected error occurred.');
		} finally {
			setIsEmailLoading(false);
		}
	};

	const handleNameSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!firstName || !lastName) {
			setEmailError("Please enter your full name.");
			return;
		}
		setIsEmailLoading(true);
		setEmailError(null);
		try {
			const name = `${firstName} ${lastName}`;
			const data = await fetchFromApi('/api/auth/email/fullname', {
				method: 'POST',
				body: JSON.stringify({ email, name }),
			});
			if (data.success) {
				setShowNameInput(false);
				setShowOtp(true);
			} else {
				setEmailError(data.message || 'Failed to set name.');
			}
		} catch (error: any) {
			setEmailError(error.message || 'An unexpected error occurred.');
		} finally {
			setIsEmailLoading(false);
		}
	};

	const handleVerifyCode = async (code: string) => {
		setIsEmailLoading(true);
		setEmailError(null);
		try {
			const data = await fetchFromApi('/api/auth/email/verify', {
				method: 'POST',
				body: JSON.stringify({ email, code }),
			});

			if (!data.success) {
				setEmailError(data.message || 'Failed to verify code.');
				setIsEmailLoading(false);
				return;
			}

			if (data.redirectUrl) {
				window.location.href = data.redirectUrl;
				return;
			}

			router.push(returnTo);
		} catch (error) {
			if (error instanceof Error) {
				setEmailError(error.message);
			} else {
				setEmailError('An unexpected error occurred.');
			}
		} finally {
			setIsEmailLoading(false);
		}
	};


	if (loading) {
		return (
			<div className="h-full flex flex-col items-center justify-center py-8 space-y-6">
				<Loader2 className="h-12 w-12 animate-spin text-primary" />
			</div>
		);
	}

	let headerContent = {
		title: "Sign in to Open Paper",
		description: "Connect with an account to access your papers, projects, and annotations."
	};

	if (showNameInput) {
		headerContent = {
			title: "What's your name?",
			description: "This will be displayed on your profile."
		};
	} else if (showOtp) {
		headerContent = {
			title: "Check your email",
			description: `Enter the 6-digit code we sent to ${email}. This will expire in 10 minutes.`,
		};
	}

	return (
		<div className="flex items-center justify-center h-full p-4">
			<Card className="w-full max-w-md relative">
				<CardHeader className="text-center">
					{ (showNameInput || showOtp) && (
						<Button variant="ghost" size="icon" className="absolute top-6 left-5" onClick={handleBackToStart}>
							<ArrowLeft className="h-5 w-5" />
						</Button>
					)}
					<CardTitle className="text-2xl">{headerContent.title}</CardTitle>
					<CardDescription>{headerContent.description}</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{(error || authError) && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>
									{error || authError}
								</AlertDescription>
							</Alert>
						)}

						{!showNameInput && !showOtp && (
							<>
								<Button
									onClick={handleLogin}
									className="w-full"
									size="lg"
								>
									<Image
										src="/logos/g_logo.webp"
										alt="Google"
										width={20}
										height={20}
										className="mr-2"
									/>
									Continue with Google
									{lastUsedProvider === 'google' && <Badge variant="secondary" className="ml-auto">Last Used</Badge>}
								</Button>

								<div className="relative my-4">
									<div className="absolute inset-0 flex items-center">
										<span className="w-full border-t" />
									</div>
									<div className="relative flex justify-center text-xs uppercase">
										<span className="bg-card px-2 text-muted-foreground">
											Or
										</span>
									</div>
								</div>
							</>
						)}

						{showOtp ? (
							<div className="space-y-4 text-center">
								<div className="flex justify-center">
									<InputOTP maxLength={6} onComplete={handleVerifyCode} disabled={isEmailLoading}>
										<InputOTPGroup>
											<InputOTPSlot index={0} />
											<InputOTPSlot index={1} />
											<InputOTPSlot index={2} />
											<InputOTPSlot index={3} />
											<InputOTPSlot index={4} />
											<InputOTPSlot index={5} />
										</InputOTPGroup>
									</InputOTP>
								</div>
								{isEmailLoading && <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
							</div>
						) : showNameInput ? (
							<form onSubmit={handleNameSubmit}>
								<div className="space-y-2">
									<Input
										placeholder="First Name"
										value={firstName}
										onChange={(e) => setFirstName(e.target.value)}
										disabled={isEmailLoading}
										required
									/>
									<Input
										placeholder="Last Name"
										value={lastName}
										onChange={(e) => setLastName(e.target.value)}
										disabled={isEmailLoading}
										required
									/>
									<Button
										type="submit"
										className="w-full"
										disabled={isEmailLoading || !firstName || !lastName}
									>
										{isEmailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
									</Button>
								</div>
							</form>
						) : (
							<form onSubmit={handleEmailSignIn}>
								<div className="space-y-2">
									<Input
										type="email"
										placeholder="m@example.com"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										disabled={isEmailLoading}
										required
									/>
									<Button
										type="submit"
										className="w-full"
										disabled={isEmailLoading || !email}
									>
										{isEmailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue with Email"}
										{!isEmailLoading && lastUsedProvider === 'email' && <Badge variant="secondary" className="ml-auto">Last Used</Badge>}
									</Button>
								</div>
							</form>
						)}

						{emailError && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>
									{emailError}
								</AlertDescription>
							</Alert>
						)}
					</div>
				</CardContent>
				<CardFooter className="text-sm text-muted-foreground text-start">
					<div className="flex flex-wrap gap-1 justify-start">
						<span>By signing in, you agree to our</span>
						<Link href="/tos" className="text-primary hover:underline">Terms of Service</Link>
						<span>and</span>
						<Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
					</div>
				</CardFooter>
			</Card>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense fallback={
			<div className="h-full flex items-center justify-center">
				<Loader2 className="h-12 w-12 animate-spin text-primary" />
			</div>
		}>
			<LoginContent />
		</Suspense>
	)
}
