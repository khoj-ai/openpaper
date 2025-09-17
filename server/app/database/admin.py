import os

from app.auth.dependencies import SESSION_COOKIE_NAME
from app.database.crud.user_crud import user as user_crud
from app.database.database import aget_db, engine
from app.database.models import (
    Annotation,
    Conversation,
    Highlight,
    Message,
    Paper,
    PaperNote,
    Project,
    ProjectPaper,
    ProjectRole,
    User,
)
from fastapi import FastAPI, Request
from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend


class UserAdmin(ModelView, model=User):
    column_list = [
        User.id,
        User.email,
        User.name,
        User.picture,
        User.is_active,
        User.is_admin,
    ]
    column_searchable_list = [User.email, User.name]


class ProjectAdmin(ModelView, model=Project):
    column_list = [
        Project.id,
        Project.title,
        Project.description,
    ]

    column_searchable_list = [Project.title]


class ProjectRoleAdmin(ModelView, model=ProjectRole):
    column_list = [
        ProjectRole.id,
        ProjectRole.project_id,
        ProjectRole.user_id,
        ProjectRole.role,
    ]
    column_searchable_list = [
        ProjectRole.role,
        ProjectRole.project_id,
        ProjectRole.user_id,
    ]
    column_sortable_list = [ProjectRole.role]


class ProjectPaperAdmin(ModelView, model=ProjectPaper):
    column_list = [
        ProjectPaper.id,
        ProjectPaper.project_id,
        ProjectPaper.paper_id,
    ]
    column_searchable_list = [ProjectPaper.project_id, ProjectPaper.paper_id]


class HighlightAdmin(ModelView, model=Highlight):
    column_list = [
        Highlight.id,
        Highlight.user_id,
        Highlight.paper_id,
        Highlight.raw_text,
    ]
    column_searchable_list = [Highlight.raw_text]


class PaperAdmin(ModelView, model=Paper):
    column_list = [Paper.id, Paper.title, Paper.user_id]
    column_searchable_list = [Paper.title]


class AnnotationAdmin(ModelView, model=Annotation):
    column_list = [
        Annotation.id,
        Annotation.user_id,
        Annotation.paper_id,
        Annotation.content,
    ]
    column_searchable_list = [Annotation.content]


class PaperNoteAdmin(ModelView, model=PaperNote):
    column_list = [
        PaperNote.id,
        PaperNote.user_id,
        PaperNote.paper_id,
        PaperNote.content,
    ]
    column_searchable_list = [PaperNote.content]


class ConversationAdmin(ModelView, model=Conversation):
    column_list = [
        Conversation.id,
        Conversation.user_id,
        Conversation.conversable_id,
        Conversation.title,
    ]
    column_searchable_list = [Conversation.title]


class MessageAdmin(ModelView, model=Message):
    column_list = [
        Message.id,
        Message.user_id,
        Message.conversation_id,
        Message.content,
        Message.role,
    ]
    column_searchable_list = [Message.content]


class AdminAuthenticationBackend(AuthenticationBackend):
    super_password = os.getenv("SUPER_PASSWORD", "admin")
    root_email = os.getenv("ROOT_EMAIL", None)

    async def login(self, request: Request) -> bool:
        form = await request.form()
        username, password = form.get("username"), form.get("password")

        # Use async with to handle the database session
        async with aget_db() as database:
            # Validate username/password
            db_user = user_crud.get_by_email(db=database, email=username)

            if not db_user:
                return False

            if not db_user.is_admin:
                if self.root_email and db_user.email != self.root_email:
                    return False
                if not self.root_email:
                    return False

            # Check password
            if password != self.super_password:
                return False

            # If everything is ok, set the session
            user_agent = request.headers.get("user-agent")
            client_host = request.client.host if request.client else "unknown"

            session = user_crud.create_session(
                db=database,
                user_id=db_user.id,
                user_agent=user_agent,
                ip_address=client_host,
            )

            # Set the session token in the request session
            request.session[SESSION_COOKIE_NAME] = session.token

            print(f"User {username} logged in to admin page.")

            return True

    async def logout(self, request: Request) -> bool:
        # Clear the session cookie
        token = request.session.get(SESSION_COOKIE_NAME)
        if token:
            async with aget_db() as database:
                user_crud.revoke_session(db=database, token=token)

        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        token = request.session.get(SESSION_COOKIE_NAME)

        async with aget_db() as database:

            db_session = user_crud.get_by_token(db=database, token=token)
            if not db_session:
                return False

            if not db_session.user.is_admin:
                if self.root_email and db_session.user.email != self.root_email:
                    return False
                if not self.root_email:
                    return False

            return True

        return False


def setup_admin(app: FastAPI):
    secret_key = os.getenv("ADMIN_SECRET_KEY", "")
    admin = Admin(
        app,
        engine,
        authentication_backend=AdminAuthenticationBackend(secret_key=secret_key),
    )

    admin.add_view(UserAdmin)
    admin.add_view(HighlightAdmin)
    admin.add_view(PaperAdmin)
    admin.add_view(AnnotationAdmin)
    admin.add_view(PaperNoteAdmin)
    admin.add_view(ConversationAdmin)
    admin.add_view(MessageAdmin)
    admin.add_view(ProjectAdmin)
    admin.add_view(ProjectRoleAdmin)
    admin.add_view(ProjectPaperAdmin)
