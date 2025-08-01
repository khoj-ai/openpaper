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
