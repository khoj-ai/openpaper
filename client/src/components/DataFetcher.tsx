// Example component using the API
"use client";

import { useState } from "react";
import { fetchFromApi } from "@/lib/api";

export function DataFetcher() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    async function fetchData() {
        setLoading(true);
        try {
            const result = await fetchFromApi('/api/health', { method: 'GET' })
            setData(result);
        } catch (error) {
            console.error("Failed to fetch data:", error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <button onClick={fetchData} disabled={loading}>
                {loading ? "Loading..." : "Fetch Data"}
            </button>
            {data && <pre className="mt-4 p-4 bg-gray-100 rounded">{JSON.stringify(data, null, 2)}</pre>}
        </div>
    );
}
