# filepath: annotated-paper/server/gunicorn.conf.py
import multiprocessing
import os

# Bind address and port
# Use environment variable PORT if available, otherwise default to 8000
port = os.getenv("PORT", "8000")
bind = f"0.0.0.0:{port}"

# Number of worker processes
# Recommended: (2 * number of CPU cores) + 1
workers = (multiprocessing.cpu_count() * 2) + 1

# Worker class for ASGI applications (FastAPI)
worker_class = "uvicorn.workers.UvicornWorker"

# Logging
# Use '-' for stdout/stderr
accesslog = "-"
errorlog = "-"
loglevel = os.getenv(
    "GUNICORN_LOG_LEVEL", "info"
)  # e.g., debug, info, warning, error, critical

# Reload workers when code changes (useful for development, disable in production)
# reload = True

# Other settings (optional)
# timeout = 30  # Workers silent for more than this many seconds are killed and restarted
# keepalive = 2 # The number of seconds to wait for requests on a Keep-Alive connection
# worker_connections = 1000 # Max number of simultaneous clients per worker
# threads = 1 # Number of threads per worker (Uvicorn handles concurrency well, often 1 is fine)

# Environment variables to pass to workers (if needed)
# raw_env = ["VAR1=value1", "VAR2=value2"]

# Forwarded headers (if behind a proxy like Nginx)
forwarded_allow_ips = "*"  # Trust all proxies, adjust if needed
proxy_headers = True  # Enable reading proxy headers (X-Forwarded-For, etc.)
