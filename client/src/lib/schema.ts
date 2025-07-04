import { PaperStatus } from "@/components/utils/PdfStatus";

export interface ReferenceCitation {
    index: number;
    text: string;
}

export interface PaperData {
    filename: string;
    file_url: string;
    authors: string[];
    title: string;
    abstract: string;
    publish_date: string;
    summary: string;
    summary_citations?: ReferenceCitation[];
    institutions: string[];
    keywords: string[];
    starter_questions: string[];
    is_public: boolean;
    share_id: string;
    status: PaperStatus;
    open_alex_id?: string;
    doi?: string;
}

export interface PaperNoteData {
    content: string;
}

export interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    references?: Reference;
}

export interface PaperHighlight {
    id?: string;
    raw_text: string;
    role: 'user' | 'assistant';
    start_offset?: number;
    end_offset?: number;
    page_number?: number;
}

export interface PaperHighlightAnnotation {
    id: string;
    highlight_id: string;
    paper_id: string;
    content: string;
    role: 'user' | 'assistant';
    created_at: string;
}

export interface Reference {
    citations: Citation[];
}

export interface Citation {
    key: string;
    reference: string;
}


export enum ResponseStyle {
    Normal = 'normal',
    Concise = 'concise',
    Detailed = 'detailed',
}

export interface OpenAlexPaper {
    id: string
    title: string
    doi?: string
    publication_year: number
    publication_date: string
    open_access?: {
        is_oa: boolean
        oa_status: string
        oa_url?: string
    }
    keywords?: Array<{
        display_name: string
        score?: number
    }>
    authorships?: Array<{
        author?: {
            id: string
            orcid?: string
            display_name?: string
        }
        institutions?: {
            id: string
            type: string
            display_name: string
            ror?: string
        }[]
    }>
    topics?: Array<{
        display_name: string
        score?: number,
        subfield: {
            display_name: string
        },
        field: {
            display_name: string
        },
        domain: {
            display_name: string
        }
    }>
    cited_by_count?: number
    abstract?: string
}

export interface OpenAlexResponse {
    meta: {
        count: number
        page: number | null
        per_page: number
    },
    results: Array<OpenAlexPaper>
}

export interface OpenAlexMatchResponse {
    center: OpenAlexPaper;
    cites: OpenAlexResponse;
    cited_by: OpenAlexResponse;
}

export type JobStatusType = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
