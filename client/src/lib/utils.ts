import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function groupConsecutiveNumbers(numbers: number[]): string {
	if (numbers.length === 0) return "";

	const sorted = [...new Set(numbers)].sort((a, b) => a - b);
	const ranges = [];
	let start = sorted[0];
	let end = sorted[0];

	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === end + 1) {
			end = sorted[i];
		} else {
			ranges.push(start === end ? `${start}` : `${start}-${end}`);
			start = sorted[i];
			end = sorted[i];
		}
	}

	ranges.push(start === end ? `${start}` : `${start}-${end}`);
	return ranges.join(", ");
}

export const isDateValid = (dateString: string) => {
	const date = new Date(dateString);
	return !isNaN(date.getTime());
};

// Format date more elegantly
export const formatDate = (dateString: string) => {
	const date = new Date(dateString);
	const now = new Date();
	const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

	if (diffInHours < 24) {
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	} else if (diffInHours < 168) { // 7 days
		return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
	} else {
		return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}
};

export function getAlphaHashToBackgroundColor(input: string): string {
	// Given a string, return a color from a predefined set based on a hash of the string, using tailwind bg-color-500 variants.
	const colors = [
		"bg-red-500",
		"bg-green-500",
		"bg-blue-500",
		"bg-yellow-500",
		"bg-purple-500",
		"bg-pink-500",
		"bg-indigo-500",
		"bg-teal-500",
		"bg-orange-500",
		"bg-cyan-500",
	];

	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = input.charCodeAt(i) + ((hash << 5) - hash);
	}

	const index = Math.abs(hash) % colors.length;
	return colors[index] + " text-white";
}

export function getInitials(name: string): string {
	const names = name.split(" ");
	let initials = names[0].charAt(0).toUpperCase();

	if (names.length > 1) {
		initials += names[names.length - 1].charAt(0).toUpperCase();
	}

	return initials;
}
