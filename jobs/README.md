# Jobs Service

The Jobs Service is a Celery-based asynchronous task processing service that handles heavy-duty, long-running jobs for the Annotated Paper application. The first and primary job is PDF processing, which involves parsing uploaded PDF documents, extracting metadata, and preparing them for use in the main application.

## Architecture

The Jobs Service is designed to be a scalable and robust backend component that offloads intensive processing from the main web server. It communicates with the `server` service via a message broker (Redis) and webhooks.

### High-Level Flow

Here's a high-level overview of the PDF processing workflow:

```
                               +------------------+
                               |                  |
      +----------------------> |   Server (API)   | <-----------------+
      |                        |                  |                   |
      |                        +--------+---------+                   |
      |                                 | 1. Client uploads PDF       |
      |                                 |                             |
+-----v-----+                           |                             |
|           |                           |                             |
|  Client   | <-------------------------)-----------------------------+
|           |   Polling for status      |
+-----------+                           |
      ^                                 |
      |                                 |
      | 6. PDF is ready                 v
      |                        +--------+---------+
      |                        |                  |
      +------------------------+ RabbitMQ (Broker)|
                               |                  |
                               +--------+---------+
                                        | 2. Task is sent to queue
                                        |
                                        v
                               +--------+---------+
                               |                  | <-----------------+
+----------------------------> |  Celery Workers  | ----------------->|
| 5. Webhook notification      | (Jobs Service)   |   Status polling  |
|    (via Server API)          |                  |                   | 3. LLM extracts
|                              +--------+---------+                   |    metadata
|                                       |                             |
|                                       | 4. PDF and assets           |
|                                       |    are uploaded to S3       |
|                                       |                             |
|   +----------------+                  v                             |
|   |                |         +--------+---------+                   |
+---+  LLM Service   |         |                  |                   |
    |                | <-----> |       S3         | <-----------------+
    +----------------+         |                  |
                               +------------------+
```

Within the Jobs Service, the PDF processing task is broken down into several subtasks that run concurrently. Each subtask is responsible for a specific aspect of the PDF processing, such as extracting text, generating preview images, and calling an LLM service for metadata extraction.


```
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|  Incoming Request with PDF Content                                                              |
|  (paper_content: str)                                                                           |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+
      |
      |
      v
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|  Orchestrate end-to-end metadata extraction                                                     |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+
      |
      |
      v
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|  Cache the paper content to optimize performance                                                |
|  (Caches the PDF content for 3600 seconds)                                                      |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+
      |
      |
      v
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|  Fan-out Subtasks                                                                               |
|  (All subtasks run concurrently using the same cache_key)                                       |
|                                                                                                 |
+-------+-----------------------------------------------------------------------------------------+
        |
        |
+-------+-----------------------------------------------------------------------------------------+
|                                                                                                 |
|   +--------------------------+   +---------------------------+   +---------------------------+  |
|   | Get Title, Authors,      |   | Find Institutions and     |   | Generate Summary and      |  |
|   | and Abstract             |   | Keywords                  |   | Find Citations            |  |
|   +--------------------------+   +---------------------------+   +---------------------------+  |
|                                                                                                 |
|   +--------------------------+   +---------------------------+   +---------------------------+
|   | Create Starter Questions |   | Identify Key Highlights   |   | Extract Images and        |
|   | for Discussion           |   | and Takeaways             |   | Generate Captions         |
|   +--------------------------+   +---------------------------+   +---------------------------+
|                                                                                                 |
+-------+-----------------------------------------------------------------------------------------+
        |
        |
        v
+-------+-----------------------------------------------------------------------------------------+
|                                                                                                 |
|  Rejoin Results                                                                                 |
|  (Results from all subtasks are gathered)                                                       |
|                                                                                                 |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+
      |
      |
      v
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|  Final Result                                                                                   |
|  (PaperMetadataExtraction object)                                                               |
|                                                                                                 |
+-------------------------------------------------------------------------------------------------+

```


1.  **PDF Upload**: A client uploads a PDF file to the `server` via the web application.
2.  **Task Queuing**: The `server` creates a new paper record in the database with a `processing` status, then dispatches a task to the Celery message broker (Redis) with the PDF data and a webhook URL.
3.  **Task Consumption**: A Celery worker from the `jobs` service picks up the task from the queue.
4.  **PDF Processing**: The worker processes the PDF:
    *   It extracts the full text content.
    *   It extracts all images from the PDF.
    *   For each extracted image, it generates a caption using an LLM service.
    *   It generates a preview image of the first page.
    *   It calls an LLM service to extract metadata like title, authors, abstract, and keywords.
5.  **S3 Storage**: The original PDF, the generated preview image, the extracted text, and all extracted images and their captions are uploaded to an S3 bucket.
6.  **Webhook Notification**: Once processing is complete, the `jobs` service sends a webhook notification to the `server` with the results, including the S3 URLs and the extracted metadata.
7.  **Database Update**: The `server` receives the webhook, updates the paper record in the database with the new information, and marks the status as `complete`. The paper is now available to the client.
8.  **Status Polling**: The client can poll the `server` for status updates, and the `server` can query the `jobs` service for real-time task progress information.

### System Dependencies

The Jobs Service relies on the following external services:

*   **RabbitMQ**: Used as the message broker for Celery to queue and distribute tasks.
*   **Redis**: Used as the result backend for Celery to store task results.
*   **PostgreSQL**: The primary database, managed by the `server` service. The `jobs` service does not directly access the database.
*   **S3-compatible Object Storage**: Used for storing the uploaded PDFs, preview images, and other assets.
*   **LLM Service**: An external or internal service for extracting metadata from the PDF content.

## Setup and Configuration

### Environment Variables

The following environment variables are required to run the Jobs Service:

| Variable                | Description                                      | Required |
| ----------------------- | ------------------------------------------------ | -------- |
| `AWS_ACCESS_KEY_ID`     | AWS access key for S3.                           | Yes      |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3.                           | Yes      |
| `AWS_REGION`            | The AWS region for the S3 bucket.                | No       |
| `S3_BUCKET_NAME`        | The name of the S3 bucket for file storage.      | Yes      |
| `CLOUDFLARE_BUCKET_NAME`| The name of the Cloudflare R2 bucket (if used).  | Yes      |
| `CELERY_BROKER_URL`     | The URL for the Celery message broker (RabbitMQ).   | Yes      |
| `CELERY_RESULT_BACKEND` | The URL for the Celery result backend (Redis).   | Yes      |
| `LLM_API_KEY`           | The API key for the LLM service.                 | Yes      |

### Running Locally

1.  **Install Dependencies**:
    ```bash
    uv install
    ```

2.  **Start RabbitMQ and Redis**:
    Make sure you have RabbitMQ and Redis servers running. You can use Docker to easily start them:
    ```bash
    docker run -d -p 5672:5672 rabbitmq
    docker run -d -p 6379:6379 redis
    ```

3.  **Start the Celery Worker**:
    ```bash
    ./scripts/start_worker.sh
    ```

4.  **Start Flower (Optional)**:
    Flower is a web-based tool for monitoring Celery jobs.
    ```bash
    ./scripts/start_flower.sh
    ```
    You can access the Flower dashboard at `http://localhost:5555`.

## Future Development

The Jobs Service is designed to be extensible. In the future, we plan to add more asynchronous tasks, such as:

*   **Bulk imports**: Processing large batches of papers at once.
*   **Scheduled tasks**: Periodically fetching new papers from sources like arXiv.
*   **Data enrichment**: Running additional analysis on papers after they've been uploaded.

By separating these tasks into a dedicated service, we can ensure the main application remains responsive and scalable as we add more features.
