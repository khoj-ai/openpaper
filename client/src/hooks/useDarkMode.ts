import { useEffect, useState } from "react";

export function useIsDarkMode() {
    const [darkMode, setDarkMode] = useState(false);
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
        // Update the class on the document element based on darkMode state
        if (isMounted) {
            if (darkMode) {
                document.documentElement.classList.add('dark');
            } else {
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
