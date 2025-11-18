import { PaperStatus } from "@/components/utils/PdfStatus";

export type HighlightType = 'topic' | 'motivation' | 'method' | 'evidence' | 'result' | 'impact' | 'general';

export interface ReferenceCitation {
    index: number;
    text: string;
    paper_id?: string;
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
    paper_id?: string;
    reference: string;
}

export interface Conversation {
    id: string;
    title: string;
    updated_at: string;
    is_owner?: boolean;
    owner_picture?: string;
    owner_name?: string;
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

export interface JobStatusResponse {
    job_id: string;
    status: JobStatusType;
    started_at: string;
    completed_at: string | null;
    paper_id: string | null;
    has_file_url: boolean;
    has_metadata: boolean;
    celery_progress_message: string | null;
}

export interface PaperTag {
    id: string;
    name: string;
    color: string;
}

export interface PaperItem {
    id: string
    title: string
    abstract?: string
    authors?: string[]
    keywords?: string[]
    institutions?: string[]
    summary?: string
    created_at?: string
    publish_date?: string
    status?: PaperStatus
    preview_url?: string
    file_url?: string
    size_in_kb?: number
    tags?: PaperTag[]
    is_owner?: boolean
}

export interface CreditUsage {
    used: number;
    remaining: number;
    total: number;
    usagePercentage: number;
    showWarning: boolean;
    isNearLimit: boolean;
    isCritical: boolean;
}

export interface AudioOverview {
    id: string;
    conversable_id: string;
    conversable_type: string;
    audio_url: string;
    transcript: string;
    title: string;
    citations: ReferenceCitation[];
    created_at: string;
    updated_at: string;
    job_id: string;
}

export interface AudioOverviewJob {
    id: string;
    status: JobStatusType;
    conversable_id: string;
    conversable_type: string;
    started_at: string;
    completed_at: string | null;
}

export interface Project {
    id: string;
    title: string;
    description: string;
    num_papers?: number;
    num_conversations?: number;
    created_at: string;
    updated_at: string;
    role?: ProjectRole;
    num_roles?: number;
}

export interface PdfUploadResponse {
    message: string;
    job_id: string;
    file_name?: string;
}

export interface MinimalJob {
    jobId: string;
    fileName: string;
}

export enum ProjectRole {
    Admin = 'admin',
    Editor = 'editor',
    Viewer = 'viewer',
}

export interface Collaborator {
    id: string;
    name: string;
    picture: string;
    email: string;
    role: ProjectRole;
}

export interface PendingInvite {
    id?: string;
    email: string;
    role: ProjectRole;
    invited_at: string;
}

export interface ProjectInvitation {
	id: string;
	project_id: string;
	project_name: string;
	invited_by: string;
	email: string;
	role: string;
	accepted_at?: string;
	invited_at: string;
}
