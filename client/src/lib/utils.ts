import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export const isDateValid = (dateString: string) => {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
};
