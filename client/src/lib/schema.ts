import { PaperStatus } from "@/components/utils/PdfStatus";
import { BasicUser } from "./auth";

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
    journal?: string;
    doi?: string;
    publisher?: string;
}

export interface SharedPaper {
    paper: PaperData;
    highlights: PaperHighlight[];
    annotations: PaperHighlightAnnotation[];
    owner: BasicUser;
}

export interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    references?: Reference;
}

// Position types for react-pdf-highlighter-extended
export interface ScaledRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
    pageNumber: number;
}

export interface ScaledPosition {
    boundingRect: ScaledRect;
    rects: ScaledRect[];
    usePdfCoordinates?: boolean;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface PaperHighlight {
    id?: string;
    raw_text: string;
    role: 'user' | 'assistant';
    start_offset?: number;
    end_offset?: number;
    page_number?: number;
    type?: HighlightType;
    position?: ScaledPosition;
    color?: HighlightColor;
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
    primary_location?: {
        is_oa: boolean
        landing_page_url: string
        pdf_url?: string
        source?: {
            id: string
            display_name: string
            type?: string
            host_organization?: string
        }
    }
    biblio?: {
        volume?: string
        issue?: string
        first_page?: string
        last_page?: string
    }
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

export enum JobStatus {
    PENDING = 'pending',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled'
}

export type JobStatusType = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export const SubscriptionStatus = {
    ACTIVE: 'active',
    CANCELED: 'canceled',
    PAST_DUE: 'past_due',
    INCOMPLETE: 'incomplete',
    TRIALING: 'trialing',
    UNPAID: 'unpaid',
} as const;

export type SubscriptionStatusType = typeof SubscriptionStatus[keyof typeof SubscriptionStatus];

export interface UserSubscription {
    has_subscription: boolean;
    had_subscription: boolean;
    requires_payment_update: boolean;
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
    title: string | null;
    started_at: string;
    created_at: string;
    completed_at: string | null;
}

export interface PaperUploadJobStatusResponse extends JobStatusResponse {
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
    journal?: string
    doi?: string
    publisher?: string
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

export interface AudioOverviewJob extends JobStatusResponse {
    id: string;
    conversable_id: string;
    conversable_type: string;
}

export interface Project {
    id: string;
    title: string;
    description: string;
    num_papers?: number;
    num_conversations?: number;
    num_audio_overviews?: number;
    num_data_tables?: number;
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

export interface DataTableJob {
    id: string;
    project_id: string | null;
    columns: string[] | null;
    task_id: string | null;
    title: string | null;
    status: JobStatusType;
    started_at: string | null;
    completed_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    error_message: string | null;
    result_id: string | null;
}

// Response from /api/projects/tables/{job_id} status endpoint
export interface DataTableJobStatusResponse extends JobStatusResponse {
    columns: string[] | null;
    task_id: string | null;
    error_message: string | null;
    celery_status: string | null;
    celery_progress_message: string | null;
    celery_error: string | null;
}

export interface DataTableCellValue {
    value: string;
    citations: ReferenceCitation[];
}

export interface DataTableRow {
    id: string;
    paper_id: string;
    values: {
        [columnName: string]: DataTableCellValue;
    };
}

export interface DataTableResult {
    success: boolean;
    title: string;
    columns: string[];
    rows: DataTableRow[];
    row_failures: string[] | null;
    created_at: string | null;
}

export interface SubscriptionLimits {
    paper_uploads: number;
    knowledge_base_size: number;
    chat_credits_weekly: number;
    audio_overviews_weekly: number;
    data_tables_weekly: number;
    projects: number;
    model: string[];
}

export interface SubscriptionUsage {
    paper_uploads: number;
    paper_uploads_remaining: number;
    knowledge_base_size: number;
    knowledge_base_size_remaining: number;
    chat_credits_used: number;
    chat_credits_remaining: number;
    audio_overviews_used: number;
    audio_overviews_remaining: number;
    projects: number;
    projects_remaining: number;
    data_tables_used: number;
    data_tables_remaining: number;
}

export interface SubscriptionData {
    plan: 'basic' | 'researcher';
    limits: SubscriptionLimits;
    usage: SubscriptionUsage;
}

export interface UseSubscriptionReturn {
    subscription: SubscriptionData | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}
