import subprocess
from pathlib import Path


def start():
    """Run the start.sh script to initialize server."""
    script_path = Path(__file__).parent.parent / "start.sh"

    # Change to the server directory to run the script
    server_dir = Path(__file__).parent.parent

    subprocess.run([str(script_path)], cwd=server_dir, check=True)
