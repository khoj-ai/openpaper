import useSWR, { mutate as globalMutate } from "swr";
import { fetchFromApi } from "@/lib/api";
import { PaperItem } from "@/lib/schema";

export const ACTIVE_PAPERS_KEY = "/api/paper/active";

async function fetchActivePapers(): Promise<PaperItem[]> {
	try {
		const data = await fetchFromApi(ACTIVE_PAPERS_KEY);
		const papers: PaperItem[] = data?.papers ?? [];
		return papers.sort(
			(a, b) =>
				new Date(b.created_at || "").getTime() -
				new Date(a.created_at || "").getTime(),
		);
	} catch (error) {
		if (error instanceof Error && error.message.includes("404")) {
			return [];
		}
		throw error;
	}
}

export function useActivePapers(enabled = true) {
	const { data, error, isLoading, mutate } = useSWR<PaperItem[]>(
		enabled ? ACTIVE_PAPERS_KEY : null,
		fetchActivePapers,
	);

	return {
		papers: data ?? [],
		error,
		isLoading,
		mutate,
	};
}

export function refreshActivePapers() {
	return globalMutate(ACTIVE_PAPERS_KEY);
}
