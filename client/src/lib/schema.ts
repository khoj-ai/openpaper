import { PaperStatus } from "@/components/utils/PdfStatus";

export type HighlightType = 'topic' | 'motivation' | 'method' | 'evidence' | 'result' | 'impact' | 'general';

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
    type?: HighlightType;
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

export type SubscriptionStatusType = 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing' | 'unpaid';

export interface UserSubscription {
    has_subscription: boolean;
    subscription: {
        status: SubscriptionStatusType;
        interval: "month" | "year";
        current_period_end: string;
        current_period_start: string;
        cancel_at_period_end: boolean;
    };
}

export interface HighlightResult {
    id: string;
    raw_text: string;
    start_offset: number | null;
    end_offset: number | null;
    page_number: number | null;
    role: string;
    created_at: string;
    type?: HighlightType;
}

export interface AnnotationResult {
    id: string;
    content: string;
    role: string;
    created_at: string;
    highlight: HighlightResult;
}

export interface PaperResult {
    id: string;
    title: string | null;
    authors: string[] | null;
    abstract: string | null;
    status: string;
    publish_date: string | null;
    created_at: string;
    last_accessed_at: string;
    highlights: HighlightResult[];
    annotations: AnnotationResult[];
    preview_url: string | null;
}

export interface SearchResults {
    papers: PaperResult[];
    total_papers: number;
    total_highlights: number;
    total_annotations: number;
}

export interface PaperImage {
    paper_id: string;
    s3_object_key: string;
    image_url: string;
    format: string;
    size_bytes: number;
    width: number;
    height: number;
    page_number: number;
    image_index: number;
    caption: string | null;
}
