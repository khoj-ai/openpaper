import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Optional

import boto3
import requests
from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.models import Paper, User
from app.schemas.user import CurrentUser
from botocore.exceptions import ClientError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Load AWS configuration from environment variables
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
CLOUDFLARE_BUCKET_NAME = os.environ.get("CLOUDFLARE_BUCKET_NAME")

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")


class S3Service:
    """Service for handling S3 operations"""

    def __init__(self):
        """Initialize S3 client"""
        self.s3_client = boto3.client(
            "s3",  # type: ignore
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION,
        )
        self.bucket_name = S3_BUCKET_NAME
        self.cloudflare_bucket_name = CLOUDFLARE_BUCKET_NAME

    def _validate_pdf_url(self, url: str) -> bool:
        """
        Validate if URL points to a PDF file

        Args:
            url: The URL to validate

        Returns:
            bool: True if valid PDF URL
        """
        try:
            response = requests.head(url, allow_redirects=True)
            content_type = response.headers.get("content-type", "")

            # Check content type and URL extension
            is_pdf = content_type == "application/pdf" or url.lower().endswith(".pdf")
            return response.ok and is_pdf
        except requests.RequestException:
            return False

    def upload_any_file(
        self, file_path: str, original_filename: str, content_type: str
    ) -> tuple[str, str]:
        """
        Upload any file to S3
        Args:
            file_path: The path to the file to upload
            original_filename: The original name of the file
            content_type: The MIME type of the file
        Returns:
            tuple: S3 object key and public URL
        """

        try:
            # Generate a unique key for the S3 object
            # Use a UUID prefix to avoid naming conflicts
            object_key = f"{UPLOAD_DIR}/{uuid.uuid4()}-{original_filename}"

            # Upload to S3
            with open(file_path, "rb") as file_obj:
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=object_key,
                    Body=file_obj,
                    ContentType=content_type,
                )

            # Generate the URL for the uploaded file
            file_url = f"https://{self.cloudflare_bucket_name}/{object_key}"

            return object_key, file_url

        except ClientError as e:
            logger.error(f"Error uploading file to S3: {e}")
            raise
        except FileNotFoundError as e:
            logger.error(f"File not found: {file_path}")
            raise ValueError(f"File not found: {file_path}")

    async def upload_file(self, file: BytesIO, filename: str) -> tuple[str, str]:
        """
        Upload a BytesIO file to S3 using streaming

        Args:
            file: The BytesIO object to upload
            filename: The filename for the uploaded file

        Returns:
            tuple: S3 object key and public URL
        """
        try:
            # Sanitize filename
            original_filename = filename.replace(" ", "_")
            file_extension = original_filename.split(".")[-1].lower()
            object_key = f"{UPLOAD_DIR}/{uuid.uuid4()}-{original_filename}"

            # Stream upload directly from BytesIO object
            self.s3_client.upload_fileobj(
                file,  # BytesIO object
                self.bucket_name,
                object_key,
                ExtraArgs={
                    "ContentType": f"application/{file_extension}",
                },
            )

            # Generate the URL for the uploaded file
            file_url = f"https://{self.cloudflare_bucket_name}/{object_key}"

            return object_key, file_url

        except ClientError as e:
            logger.error(f"Error uploading file to S3: {e}")
            raise ValueError("Failed to upload file to S3")

    def delete_file(self, object_key: str) -> bool:
        """
        Delete a file from S3

        Args:
            object_key: The S3 object key to delete

        Returns:
            bool: True if deleted successfully, False otherwise
        """
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=object_key)
            return True
        except ClientError as e:
            logger.error(f"Error deleting file from S3: {e}")
            return False

    def generate_presigned_url(
        self, object_key: str, expiration: int = 28800
    ) -> Optional[str]:
        """
        Generate a presigned URL for a file

        Args:
            object_key: The S3 object key
            expiration: URL expiration time in seconds (default: 8 hours)

        Returns:
            str: Presigned URL or None if error
        """
        try:
            url = self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket_name, "Key": object_key},
                ExpiresIn=expiration,
            )

            # Replace the S3 URL with Cloudflare URL
            if url.startswith(f"https://{self.bucket_name}.s3.amazonaws.com/"):
                url = url.replace(
                    f"https://{self.bucket_name}.s3.amazonaws.com/",
                    f"https://{self.cloudflare_bucket_name}/",
                )
            elif url.startswith(
                f"https://{self.bucket_name}.s3.us-east-1.amazonaws.com/"
            ):
                url = url.replace(
                    f"https://{self.bucket_name}.s3.us-east-1.amazonaws.com/",
                    f"https://{self.cloudflare_bucket_name}/",
                )
            elif url.startswith(
                f"https://{self.bucket_name}.s3.{AWS_REGION}.amazonaws.com/"
            ):
                url = url.replace(
                    f"https://{self.bucket_name}.s3.{AWS_REGION}.amazonaws.com/",
                    f"https://{self.cloudflare_bucket_name}/",
                )

            return url
        except ClientError as e:
            logger.error(f"Error generating presigned URL: {e}")
            return None

    def get_file_size_in_kb(self, object_key: str) -> Optional[int]:
        """
        Get the size of a file in KB from S3

        Args:
            object_key: The S3 object key
            db: Database session
            paper_id: The paper ID to cache the size for
            current_user: Current user for ownership verification

        Returns:
            int: Size in KB or None if error
        """
        try:
            response = self.s3_client.head_object(
                Bucket=self.bucket_name, Key=object_key
            )
            size_in_kb = response.get("ContentLength", 0) // 1024
            return size_in_kb
        except ClientError as e:
            logger.error(f"Error getting file size for {object_key}: {e}")
            return None

    def get_cached_presigned_url(
        self,
        db: Session,
        paper_id: str,
        object_key: str,
        expiration: int = 28800,
        current_user: Optional[CurrentUser] = None,
    ) -> Optional[str]:
        """
        Get a cached presigned URL or generate a new one if expired/missing

        Args:
            db: Database session
            paper_id: The paper ID to cache the URL for
            object_key: The S3 object key
            expiration: URL expiration time in seconds (default: 8 hours)
            current_user: Current user for ownership verification

        Returns:
            str: Presigned URL or None if error
        """
        try:
            # Get the paper using CRUD
            paper = paper_crud.get(db, id=paper_id, user=current_user)
            if not paper:
                return None

            # Check if we have a valid cached URL
            now = datetime.now(timezone.utc)
            if (
                paper.cached_presigned_url
                and paper.presigned_url_expires_at
                and paper.presigned_url_expires_at > now
            ):
                logger.debug(f"Using cached presigned URL for paper {paper_id}")
                return str(paper.cached_presigned_url)

            # Generate new presigned URL
            url = self.generate_presigned_url(object_key, expiration)
            if not url:
                return None

            # Cache the URL with expiration (subtract 5 minutes for safety buffer)
            expires_at = now + timedelta(seconds=expiration - 300)

            # Calculate the size of the file in KB
            current_size = getattr(paper, "size_in_kb", None)
            if current_size is not None:
                size_in_kb: Optional[int] = current_size
            else:
                size_in_kb = self.get_file_size_in_kb(object_key)

            # Update using CRUD
            updated_paper = paper_crud.update(
                db=db,
                db_obj=paper,
                obj_in=PaperUpdate(
                    cached_presigned_url=url,
                    presigned_url_expires_at=expires_at,
                    size_in_kb=size_in_kb,
                ),
                user=current_user,
            )

            if not updated_paper:
                logger.error(f"Failed to update cached URL for paper {paper_id}")
                return None

            logger.debug(f"Generated and cached new presigned URL for paper {paper_id}")
            return url

        except Exception as e:
            logger.error(f"Error getting cached presigned URL: {e}")
            return None

    def invalidate_cached_url(
        self, db: Session, paper_id: str, current_user: Optional[CurrentUser] = None
    ) -> bool:
        """
        Invalidate the cached presigned URL for a paper

        Args:
            db: Database session
            paper_id: The paper ID to invalidate
            current_user: Current user for ownership verification

        Returns:
            bool: True if invalidated successfully
        """

        try:
            paper = paper_crud.get(db, id=paper_id, user=current_user)
            if not paper:
                return False

            # Update using CRUD to clear cached URL
            updated_paper = paper_crud.update(
                db=db,
                db_obj=paper,
                obj_in=PaperUpdate(
                    cached_presigned_url=None, presigned_url_expires_at=None
                ),
                user=current_user,
            )

            return updated_paper is not None

        except Exception as e:
            logger.error(f"Error invalidating cached URL: {e}")
            return False

    def get_cached_presigned_url_by_owner(
        self,
        db: Session,
        paper_id: str,
        object_key: str,
        owner_id: str,
        expiration: int = 28800,
    ) -> Optional[str]:
        """
        Get a cached presigned URL for a paper owned by a specific user (used for shared papers)
        """

        try:
            # Get the owner user object
            owner = db.query(User).filter(User.id == owner_id).first()
            if not owner:
                return None

            # Convert to CurrentUser
            current_user = CurrentUser(
                id=owner.id,
                email=owner.email,
                name=owner.name,
                picture=owner.picture,
                is_admin=owner.is_admin,
            )

            # Use the existing method
            return self.get_cached_presigned_url(
                db=db,
                paper_id=paper_id,
                object_key=object_key,
                current_user=current_user,
                expiration=expiration,
            )

        except Exception as e:
            logger.error(f"Error getting cached presigned URL by owner: {e}")
            return None

    def get_cached_presigned_url_by_project(
        self,
        db: Session,
        paper_id: str,
        object_key: str,
        project_id: str,
        current_user: CurrentUser,
        expiration: int = 28800,
    ) -> Optional[str]:
        """
        Get a cached presigned URL for a paper that's member of a specific project id, verifying that the user has access to the project.
        """
        paper: Paper = project_paper_crud.get_paper_by_project(
            db=db,
            paper_id=uuid.UUID(paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )

        if not paper:
            return None

        # Generate and return the presigned URL
        return self.generate_presigned_url(object_key, expiration)

    def duplicate_file(
        self, source_object_key: str, new_filename: str
    ) -> tuple[str, str]:
        """
        Duplicate a file in S3

        Args:
            source_object_key: The S3 object key of the source file
            new_filename: The filename for the duplicated file

        Returns:
            tuple: New S3 object key and public URL
        """
        try:
            # Generate a unique key for the new S3 object
            new_object_key = f"{UPLOAD_DIR}/{uuid.uuid4()}-{new_filename}"

            # Copy the object within S3
            copy_source = {"Bucket": self.bucket_name, "Key": source_object_key}
            self.s3_client.copy_object(
                CopySource=copy_source,
                Bucket=self.bucket_name,
                Key=new_object_key,
            )

            # Generate the URL for the duplicated file
            file_url = f"https://{self.cloudflare_bucket_name}/{new_object_key}"

            return new_object_key, file_url

        except ClientError as e:
            logger.error(f"Error duplicating file in S3: {e}")
            raise

    def duplicate_file_from_url(self, s3_url: str, new_filename: str):
        """
        Duplicate a file in S3 given its URL

        Args:
            s3_url: The S3 URL of the source file
            new_filename: The filename for the duplicated file

        Returns:
            tuple: New S3 object key and public URL
        """
        try:
            # Extract the object key from the URL
            parsed_url = s3_url.split(f"https://{self.cloudflare_bucket_name}/")
            if len(parsed_url) != 2:
                raise ValueError("Invalid S3 URL format")
            source_object_key = parsed_url[1]

            return self.duplicate_file(source_object_key, new_filename)

        except Exception as e:
            logger.error(f"Error duplicating file from URL in S3: {e}")
            raise


# Create a single instance to use throughout the application
s3_service = S3Service()
