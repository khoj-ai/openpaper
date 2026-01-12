import subprocess
from pathlib import Path


def start():
    """Run the start.sh script to initialize services."""
    script_path = Path(__file__).parent.parent / "scripts" / "start.sh"

    # Change to the jobs directory to run the script
    jobs_dir = Path(__file__).parent.parent

    subprocess.run([str(script_path)], cwd=jobs_dir, check=True)


if __name__ == "__main__":
    start()
