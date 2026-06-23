export interface OpenAlexTypeAheadAuthor {
    id: string
    display_name: string
    cited_by_count?: number
    works_count?: number
    external_id?: string
    hint?: string
}

export const getOpenAlexTypeAheadAuthors = async (searchTerm: string): Promise<OpenAlexTypeAheadAuthor[]> => {
    if (!searchTerm) return []

    const response = await fetch(`https://api.openalex.org/autocomplete/authors?q=${encodeURIComponent(searchTerm)}`, {
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch authors: ${response.statusText}`);
    }
    const data = await response.json();

    return data.results;
};


export interface OpenAlexTypeAheadInstitution {
    id: string
    display_name: string
    works_count?: number
    cited_by_count?: number
    external_id?: string
    hint?: string
    entity_type?: string
}

export const getOpenAlexTypeAheadInstitutions = async (searchTerm: string): Promise<OpenAlexTypeAheadInstitution[]> => {
    if (!searchTerm) return []

    const response = await fetch(`https://api.openalex.org/autocomplete/institutions?q=${encodeURIComponent(searchTerm)}`, {
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch institutions: ${response.statusText}`);
    }
    const data = await response.json();

    return data.results;
};
