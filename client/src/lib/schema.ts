import { PaperStatus } from "@/components/utils/PdfStatus";

export interface PaperData {
    filename: string;
    file_url: string;
    authors: string[];
    title: string;
    abstract: string;
    publish_date: string;
    summary: string;
    institutions: string[];
    keywords: string[];
    starter_questions: string[];
    is_public: boolean;
    share_id: string;
    status: PaperStatus;
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
    start_offset: number;
    end_offset: number;
}

export interface PaperHighlightAnnotation {
    id: string;
    highlight_id: string;
    paper_id: string;
    content: string;
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
