import useSWR from 'swr';
import { fetchFromApi } from '@/lib/api';
import { PaperItem } from '@/lib/schema';

const fetcher = (url: string) => fetchFromApi(url).then(data => data.papers || data);

interface UserPapersProps {
	detailed?: boolean;
}

export function usePapers({ detailed = false }: UserPapersProps = {}) {
	const url = detailed ? '/api/paper/all?detailed=true' : '/api/paper/all';
	const { data, error, isLoading, mutate } = useSWR<PaperItem[]>(url, fetcher);

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
