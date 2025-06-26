FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install uv for faster package management
RUN pip install uv

# Set the UV_SYSTEM_PYTHON environment variable
ENV UV_SYSTEM_PYTHON=true

# Install Python dependencies
RUN uv sync --frozen

# Copy application code and scripts
COPY src/ ./src/
COPY scripts/ ./scripts/

# Make scripts executable
RUN chmod +x scripts/*.sh

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser
RUN chown -R appuser:appuser /app
USER appuser

# Health check for ECS
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Expose port for FastAPI (matching your script's port 8001)
EXPOSE 8001

# Default command - will be overridden in ECS task definitions
CMD ["python", "--version"]
