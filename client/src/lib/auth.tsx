"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ShieldX } from 'lucide-react';
import { fetchFromApi } from './api';

export interface BasicUser {
	name: string;
	picture: string;
	id?: string;
}

export interface User extends BasicUser {
	id: string;
	email: string;
	is_active: boolean;
	is_blocked: boolean;
}

interface AuthContextType {
	user: User | null;
	loading: boolean;
	error: string | null;
	login: () => Promise<void>;
	logout: (allDevices?: boolean) => Promise<void>;
}

const AUTH_STORAGE_KEY = 'auth_user';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	// Always initialize to null to match server render and avoid hydration mismatch.
	// localStorage is read in the effect below for fast optimistic state.
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Sync user state with localStorage whenever it changes
	useEffect(() => {
		if (user) {
			localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
		} else {
			localStorage.removeItem(AUTH_STORAGE_KEY);
		}
	}, [user]);

	// Check if user is logged in
	useEffect(() => {
		// Immediately restore cached user for fast UI update
		const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);
		if (storedUser) {
			try {
				setUser(JSON.parse(storedUser));
			} catch {
				localStorage.removeItem(AUTH_STORAGE_KEY);
			}
		}

		async function checkAuth() {
			try {
				const response = await fetchFromApi('/api/auth/me');
				if (response.success && response.user) {
					setUser(response.user);
				} else {
					// Auth check failed, clear the user
					setUser(null);
				}
			} catch (err) {
				console.error('Auth check failed:', err);
				setError('Failed to check authentication status');
				// Also clear the user on error
				setUser(null);
			} finally {
				setLoading(false);
			}
		}

		checkAuth();
	}, []);

	// Start Google login flow
	const login = async () => {
		try {
			setLoading(true);
			const response = await fetchFromApi('/api/auth/google/login');
			if (response.auth_url) {
				// Store the current URL as the return location after login
				localStorage.setItem('returnTo', window.location.pathname);
				// Redirect to Google OAuth
				window.location.href = response.auth_url;
			}
		} catch (err) {
			console.error('Login failed:', err);
			setError('Failed to start login process');
		} finally {
			setLoading(false);
		}
	};

	// Logout user
	const logout = async (allDevices = false) => {
		try {
			setLoading(true);
			await fetchFromApi(`/api/auth/logout?all_devices=${allDevices}`);
			setUser(null);
		} catch (err) {
			console.error('Logout failed:', err);
			setError('Failed to logout');
		} finally {
			setLoading(false);
		}
	};

	if (!loading && user?.is_blocked) {
		return (
			<AuthContext.Provider value={{ user, loading, error, login, logout }}>
				<div className="flex items-center justify-center h-screen p-4">
					<div className="w-full max-w-lg text-center space-y-4">
						<div className="mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 p-4 w-fit">
							<ShieldX className="h-8 w-8 text-red-600 dark:text-red-400" />
						</div>
						<h1 className="text-2xl font-bold">Account Suspended</h1>
						<p className="text-muted-foreground">
							Your account has been flagged and suspended for suspected misconduct
							of the platform.
						</p>
						<p className="text-muted-foreground">
							If you believe this is an error, please contact us at{" "}
							<a href="mailto:team@khoj.dev" className="text-primary hover:underline font-medium">
								team@khoj.dev
							</a>{" "}
							and we will review your account.
						</p>
						<button
							onClick={() => logout()}
							className="mt-4 inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
						>
							Sign out
						</button>
					</div>
				</div>
			</AuthContext.Provider>
		);
	}

	return (
		<AuthContext.Provider value={{ user, loading, error, login, logout }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error('useAuth must be used within an AuthProvider');
	}
	return context;
}
