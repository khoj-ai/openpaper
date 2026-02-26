"use client"

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
	const { user, loading } = useAuth();
	const router = useRouter();
	const [name, setName] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!loading && !user) {
			router.push("/login?returnTo=/settings");
		}
	}, [user, loading, router]);

	useEffect(() => {
		if (user?.name) {
			setName(user.name);
		}
	}, [user?.name]);

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			toast.error("Name cannot be empty.");
			return;
		}

		setIsSaving(true);
		try {
			const data = await fetchFromApi("/api/auth/profile", {
				method: "PATCH",
				body: JSON.stringify({ name: trimmed }),
			});
			if (data.success) {
				toast.success("Profile updated.");
				// Re-fetch auth state to update sidebar etc.
				window.location.reload();
			} else {
				toast.error(data.message || "Failed to update profile.");
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to update profile.");
		} finally {
			setIsSaving(false);
		}
	};

	if (loading || !user) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="max-w-2xl p-6 space-y-6">
			<h1 className="text-2xl font-bold">Settings</h1>
			<div className="space-y-1">
				<h2 className="text-lg font-medium">Profile</h2>
				<p className="text-sm text-muted-foreground">Manage your account details.</p>
			</div>
			<form onSubmit={handleSave} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Your name"
						disabled={isSaving}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						value={user.email}
						disabled
						className="bg-muted"
					/>
				</div>
				<Button type="submit" disabled={isSaving || !name.trim()}>
					{isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
					Save
				</Button>
			</form>
		</div>
	);
}
