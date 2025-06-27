#!/usr/bin/env python3
"""
Health check script for Celery workers.
Can be used by container orchestrators like ECS/Kubernetes.
"""

import sys
import os
import signal
import time

# Add the project root to Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

def timeout_handler(signum, frame):
    print('Health check timed out')
    sys.exit(1)

def main():
    # Set timeout for health check
    TIMEOUT = 300
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(TIMEOUT)

    try:
        from src.celery_app import celery_app

        # Try to inspect the worker
        inspect = celery_app.control.inspect()
        stats = inspect.stats()

        if stats:
            print('Worker is responsive')

            # Optional: Run a quick health check task
            try:
                from src.tasks import health_check
                result = health_check.delay()
                health_data = result.get(timeout=5)

                if health_data.get('status') == 'healthy':
                    print('Health check passed')
                    print(f"Memory: {health_data.get('process_metrics', {}).get('memory_mb', 0):.1f}MB")
                    print(f"CPU: {health_data.get('system_metrics', {}).get('cpu_percent', 0):.1f}%")
                    sys.exit(0)
                else:
                    print(f'Health check failed: {health_data}')
                    sys.exit(1)
            except Exception as e:
                print(f'Health check task failed: {e}')
                # Still consider worker healthy if basic inspection worked
                print('Worker is responsive (basic check)')
                sys.exit(0)
        else:
            print('No workers found')
            sys.exit(1)

    except Exception as e:
        print(f'Health check error: {e}')
        sys.exit(1)
    finally:
        signal.alarm(0)

if __name__ == "__main__":
    print("Checking Celery worker health...")
    main()
    print("Health check completed")
