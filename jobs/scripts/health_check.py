#!/usr/bin/env python3
"""
Health check script for Celery workers.
Can be used by container orchestrators like ECS/Kubernetes.
"""

import sys
import os
import signal
import time
import traceback
from datetime import datetime

# Add the project root to Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

def log(message):
    """Print with timestamp for better logging"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)

def timeout_handler(signum, frame):
    log('CRITICAL: Health check timed out')
    sys.exit(1)

def main():
    # Set timeout for health check
    TIMEOUT = 45
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(TIMEOUT)

    try:
        # Print environment info for debugging
        log(f"Running in directory: {os.getcwd()}")
        log(f"PYTHONPATH: {os.environ.get('PYTHONPATH', 'Not set')}")
        log(f"Project root: {project_root}")

        log("Importing celery_app...")
        from src.celery_app import celery_app

        # Try to inspect the worker
        log("Inspecting Celery worker...")
        inspect = celery_app.control.inspect()
        stats = inspect.stats()

        if stats:
            log(f"Worker is responsive. Found workers: {list(stats.keys())}")

            # Optional: Run a quick health check task
            try:
                log("Running health check task...")
                from src.tasks import health_check
                result = health_check.delay()
                health_data = result.get(timeout=5)

                if health_data.get('status') == 'healthy':
                    log('Health check task passed')
                    log(f"Memory: {health_data.get('process_metrics', {}).get('memory_mb', 0):.1f}MB")
                    log(f"CPU: {health_data.get('system_metrics', {}).get('cpu_percent', 0):.1f}%")
                    sys.exit(0)
                else:
                    log(f'Health check task failed: {health_data}')
                    sys.exit(1)
            except Exception as e:
                log(f'Health check task failed: {e}')
                log(traceback.format_exc())
                # Still consider worker healthy if basic inspection worked
                log('Worker is responsive (basic check)')
                sys.exit(0)
        else:
            log('CRITICAL: No workers found')
            log(f'Broker URL: {celery_app.conf.broker_url}')
            sys.exit(1)

    except ImportError as e:
        log(f'CRITICAL: Import error: {e}')
        log(traceback.format_exc())
        sys.exit(1)
    except Exception as e:
        log(f'CRITICAL: Health check error: {e}')
        log(traceback.format_exc())
        sys.exit(1)
    finally:
        signal.alarm(0)

if __name__ == "__main__":
    log("Starting Celery worker health check...")
    main()
    log("Health check completed")
