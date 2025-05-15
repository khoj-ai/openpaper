import { useEffect, useState } from "react";

export function useIsDarkMode() {

    // Start with the class that was added by the script
    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            return document.documentElement.classList.contains('dark');
        }
        return false;
    });

    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        // First check if there's a stored preference in localStorage
        const storedPreference = localStorage.getItem('darkMode');

        if (storedPreference === 'dark') {
            setDarkMode(true);
        } else if (storedPreference === 'light') {
            setDarkMode(false);
        } else {
            // If no stored preference, check system preference
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            setDarkMode(prefersDark);
            // Save system preference as initial setting
            localStorage.setItem('darkMode', prefersDark ? 'dark' : 'light');
        }
        setIsMounted(true);
    }, []);

    useEffect(() => {
        // Only update the class if mounted and if the value actually changed from the script
        if (isMounted) {
            const isDark = document.documentElement.classList.contains('dark');
            if (darkMode && !isDark) {
                document.documentElement.classList.add('dark');
            } else if (!darkMode && isDark) {
                document.documentElement.classList.remove('dark');
            }
        }
    }, [darkMode, isMounted]);

    const toggleDarkMode = () => {
        setDarkMode((prev) => {
            const newMode = !prev;
            localStorage.setItem('darkMode', newMode ? 'dark' : 'light');
            return newMode;
        });
    };

    return { darkMode, toggleDarkMode };
}
