# filepath: shell.py
import code
import logging
import sys

# Configure logging to see SQLAlchemy logs if desired
# logging.basicConfig()
# logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

try:
    from app.database import (  # This will make models.User, models.Paper etc. available
        models,
    )
    from app.database.database import SessionLocal

    # You can also import specific models if you prefer direct access:
    # from app.database.models import User, Paper, Session as UserSession, Message, Conversation, PaperNote, Highlight, Annotation
    # If you frequently use CRUD objects, you can import them too:
    # from app.database.crud import paper_crud, user_crud # etc.

except ImportError as e:
    print(f"Error importing application modules: {e}")
    print("Please ensure you are running this script from the project root directory,")
    print("and that your PYTHONPATH is set up correctly if necessary.")
    sys.exit(1)


def start_shell():
    db = None
    try:
        db = SessionLocal()
        print(f"Python {sys.version} on {sys.platform}")
        print("SQLAlchemy Interactive Shell for your application.")
        print("Available variables:")
        print(
            "  db           : SQLAlchemy session instance (e.g., db.query(models.User).all())"
        )
        print(
            "  models       : Module containing your SQLAlchemy models (e.g., models.Paper)"
        )
        # print("  User, Paper  : Specific models (if uncommented their direct imports above)")
        # print("  paper_crud   : CRUD object for Paper (if imported)")
        print("Type `exit()` or `Ctrl-D` (Ctrl-Z on Windows) to exit.")

        # Variables to be available in the shell's local scope
        local_vars = {
            "db": db,
            "models": models,
            "SessionLocal": SessionLocal,  # To create new sessions if needed
            # Could add specific models directly if uncommented:
            # "User": models.User,
            # "Paper": models.Paper,
            # "UserSession": models.Session, # Renamed to avoid conflict with SQLAlchemy Session
            # "Message": models.Message,
            # "Conversation": models.Conversation,
            # "PaperNote": models.PaperNote,
            # "Highlight": models.Highlight,
            # "Annotation": models.Annotation,
            # Add CRUD objects if imported:
            # "paper_crud": paper_crud,
        }

        code.interact(local=local_vars, banner="")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if db:
            print("Closing database session.")
            db.close()


if __name__ == "__main__":
    start_shell()
