import useSWR from 'swr';
import { fetchFromApi } from '@/lib/api';
import { PaperItem } from '@/lib/schema';

const fetcher = (url: string) => fetchFromApi(url).then(data => data.papers || data);

export function usePapers() {
	const { data, error, isLoading, mutate } = useSWR<PaperItem[]>('/api/paper/all', fetcher);

	const setPapers = (paperId: string, updatedPaper: PaperItem) => {
		if (data) {
			const updatedPapers = data.map(p => (p.id === paperId ? updatedPaper : p));
			mutate(updatedPapers, false); // Update local data without revalidating
		}
	};

	return {
		papers: data,
		error,
		isLoading,
		setPapers,
		mutate,
	};
}
