# PDF Processing Jobs Service

This service provides asynchronous PDF processing capabilities using Celery. It extracts metadata from academic papers, generates preview images, and uploads files to S3.

## Features

- **PDF Text Extraction**: Extracts full text content from PDF files
- **Metadata Extraction**: Uses LLM to extract title, authors, abstract, summary, and other metadata
- **Preview Generation**: Creates preview images from the first page of PDFs
- **S3 Upload**: Uploads original PDFs and preview images to S3
- **Webhook Notifications**: Sends processing results to specified webhook URLs

## Setup

1. Install dependencies:
```bash
uv install
```

2. Set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1
export S3_BUCKET_NAME=your-s3-bucket
export CLOUDFLARE_BUCKET_NAME=your-cloudflare-bucket
export CELERY_BROKER_URL=redis://localhost:6379/0
export CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

3. Start Redis (for Celery broker):
```bash
redis-server
```

4. Start Celery worker:
```bash
./scripts/start_worker.sh
```

5. Start Flower (optional, for monitoring):
```bash
./scripts/start_flower.sh
```

## Usage

### Basic Task Submission

```python
import base64
from src.tasks import upload_and_process_file

# Read PDF file as bytes
with open("document.pdf", "rb") as f:
    pdf_bytes = f.read()
# Encode PDF bytes to base64
pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')

# Submit processing task
task = upload_and_process_file.delay(
    pdf_base64=pdf_base64,
    filename="document.pdf",
    webhook_url="https://your-app.com/webhooks/pdf-processing"
)

print(f"Task ID: {task.id}")
```

### Task Response Format

The task sends a webhook with the following structure:

```json
{
  "task_id": "abc-123-def",
  "status": "completed",
  "filename": "document.pdf",
  "result": {
    "success": true,
    "metadata": {
      "title": "Paper Title",
      "authors": ["Author 1", "Author 2"],
      "abstract": "Paper abstract...",
      "summary": "AI-generated summary...",
      "keywords": ["keyword1", "keyword2"],
      "highlights": [
        {
          "text": "Important finding...",
          "annotation": "Why this is significant..."
        }
      ],
      "starter_questions": ["Question 1?", "Question 2?"]
    },
    "s3_object_key": "uploads/uuid-document.pdf",
    "file_url": "https://your-cdn.com/uploads/uuid-document.pdf",
    "preview_url": "https://your-cdn.com/uploads/uuid-preview.png",
    "filename": "document.pdf"
  },
  "error": null
}
```

### Webhook Handler Example

```python
from fastapi import FastAPI

app = FastAPI()

@app.post("/webhooks/pdf-processing")
async def handle_pdf_processing(data: dict):
    if data["status"] == "completed" and data["result"]["success"]:
        # Process successful result
        metadata = data["result"]["metadata"]
        file_url = data["result"]["file_url"]
        # Save to database, notify user, etc.
    else:
        # Handle failure
        error = data["result"]["error"]
        # Log error, notify user of failure, etc.

    return {"received": True}
```

## Architecture

- **Celery**: Distributed task queue for async processing
- **Redis**: Message broker and result backend
- **S3**: File storage for PDFs and preview images
- **PyMuPDF**: PDF text extraction and preview generation
- **LLM Integration**: Metadata extraction (placeholder implementation)

## Development

### LLM Integration

The current LLM client (`src/llm_client.py`) is a placeholder. Replace it with your actual LLM provider:

```python
# Example with OpenAI
import openai

class LLMClient:
    def extract_paper_metadata(self, paper_content: str) -> PaperMetadataExtraction:
        response = openai.chat.completions.create(
            model="gpt-4",
            messages=[{
                "role": "user",
                "content": formatted_prompt
            }]
        )
        # Parse response and return metadata
```

### Testing

Monitor tasks with Flower:
```bash
# Access at http://localhost:5555
flower --app=src.celery_app:celery_app
```

Check task status programmatically:
```python
from src.celery_app import celery_app

result = celery_app.AsyncResult(task_id)
print(f"Status: {result.status}")
print(f"Result: {result.result}")
```

Check if celery running:
```bash
celery -A src.celery_app worker --loglevel=info
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AWS_ACCESS_KEY_ID` | AWS access key | Yes |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Yes |
| `AWS_REGION` | AWS region | No (default: us-east-1) |
| `S3_BUCKET_NAME` | S3 bucket for file storage | Yes |
| `CLOUDFLARE_BUCKET_NAME` | CDN bucket name | Yes |
| `CELERY_BROKER_URL` | Redis URL for Celery | Yes |
| `CELERY_RESULT_BACKEND` | Redis URL for results | Yes |
