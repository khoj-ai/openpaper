"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { fetchFromApi } from './api';

export interface User {
	id: string;
	email: string;
	name: string;
	is_admin: boolean;
	picture?: string;
}

interface AuthContextType {
	user: User | null;
	loading: boolean;
	error: string | null;
	login: () => Promise<void>;
	logout: (allDevices?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Check if user is logged in
	useEffect(() => {
		async function checkAuth() {
			try {
				const response = await fetchFromApi('/api/auth/me');
				if (response.success && response.user) {
					setUser(response.user);
				}
			} catch (err) {
				console.error('Auth check failed:', err);
				setError('Failed to check authentication status');
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
