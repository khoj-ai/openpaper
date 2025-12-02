import { fetchFromApi } from "@/lib/api"
import { MinimalJob, PdfUploadResponse } from "@/lib/schema"

export const uploadFiles = async (files: File[]): Promise<MinimalJob[]> => {
    const newJobs: MinimalJob[] = []
    for (const file of files) {
        const formData = new FormData()
        formData.append("file", file)
        try {
            const res: PdfUploadResponse = await fetchFromApi("/api/paper/upload", {
                method: "POST",
                body: formData,
            })
            newJobs.push({ jobId: res.job_id, fileName: file.name })
        } catch (error) {
            console.error("Failed to start upload for", file.name, error)
        }
    }
    return newJobs
}

export const uploadFromUrl = async (url: string): Promise<MinimalJob> => {
    const res: PdfUploadResponse = await fetchFromApi("/api/paper/upload/from-url", {
        method: "POST",
        body: JSON.stringify({ url }),
        headers: {
            "Content-Type": "application/json",
        },
    })
    const fileName = res.file_name || url
    return { jobId: res.job_id, fileName: fileName }
}

export const uploadFromUrlWithFallback = async (url: string): Promise<MinimalJob> => {
    try {
        // First try client-side fetch
        const response = await fetch(url, {
            method: 'GET',
        });

        // Check if the response is OK
        if (!response.ok) throw new Error('Failed to fetch PDF');

        const contentDisposition = response.headers.get('content-disposition');
        const randomFilename = Math.random().toString(36).substring(2, 15) + '.pdf';
        let filename = randomFilename;

        if (contentDisposition && contentDisposition.includes('attachment')) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(contentDisposition);
            if (matches != null && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
            }
        } else {
            const urlParts = url.split('/');
            const urlFilename = urlParts[urlParts.length - 1];
            if (urlFilename && urlFilename.toLowerCase().endsWith('.pdf')) {
                filename = urlFilename;
            }
        }

        const blob = await response.blob();
        const file = new File([blob], filename, { type: 'application/pdf' });

        // Use the regular file upload function
        const jobs = await uploadFiles([file]);
        return jobs[0];
    } catch (error) {
        console.log('Client-side fetch failed, trying server-side fetch...', error);

        // Fallback to server-side fetch
        return await uploadFromUrl(url);
    }
}

export const uploadFromUrlForProject = async (url: string, projectId: string): Promise<MinimalJob> => {
    const res: PdfUploadResponse = await fetchFromApi("/api/paper/upload/from-url", {
        method: "POST",
        body: JSON.stringify({ url, project_id: projectId }),
        headers: {
            "Content-Type": "application/json",
        },
    })
    return { jobId: res.job_id, fileName: url }
}
