import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import BinaryIO, Optional
from urllib.parse import urlparse

import boto3
import requests
from app.database.crud.paper_crud import paper_crud
from app.schemas.user import CurrentUser
from botocore.exceptions import ClientError
from fastapi import UploadFile
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Load AWS configuration from environment variables
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
CLOUDFLARE_BUCKET_NAME = os.environ.get("CLOUDFLARE_BUCKET_NAME")


class S3Service:
    """Service for handling S3 operations"""

    def __init__(self):
        """Initialize S3 client"""
        self.s3_client = boto3.client(
            "s3",
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

    async def read_and_upload_file_from_url(
        self, url: str, temp_filepath: str
    ) -> tuple[str, str]:
        """
        Download file from URL and upload to S3

        Args:
            url: The URL of the file to upload

        Returns:
            tuple: S3 object key and public URL

        Raises:
            ValueError: If URL is invalid or file is not a PDF
        """
        if not self._validate_pdf_url(url):
            raise ValueError("Invalid URL or not a PDF file")

        try:
            # Download file
            response = requests.get(url, stream=True)
            response.raise_for_status()

            # Extract filename from URL or generate one
            parsed_url = urlparse(url)
            original_filename = os.path.basename(parsed_url.path)
            if not original_filename:
                original_filename = f"document-{uuid.uuid4()}.pdf"

            # Generate S3 object key
            object_key = f"uploads/{uuid.uuid4()}-{original_filename}"

            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=object_key,
                Body=response.content,
                ContentType="application/pdf",
            )

            # Write the file to a temporary location
            with open(temp_filepath, "wb") as temp_file:
                temp_file.write(response.content)
                temp_file.flush()
                os.fsync(temp_file.fileno())

            # Generate the URL for the uploaded file
            file_url = f"https://{self.cloudflare_bucket_name}/{object_key}"

            return object_key, file_url

        except requests.RequestException as e:
            logger.error(f"Error downloading file from URL: {e}")
            raise ValueError("Failed to download file from URL")
        except ClientError as e:
            logger.error(f"Error uploading file to S3: {e}")
            raise

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
            object_key = f"uploads/{uuid.uuid4()}-{original_filename}"

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

    async def upload_file(self, file: UploadFile) -> tuple[str, str]:
        """
        Upload a file to S3

        Args:
            file: The file to upload

        Returns:
            tuple: S3 object key and public URL
        """
        try:
            # Generate a unique key for the S3 object
            # Use a UUID prefix to avoid naming conflicts
            original_filename = (
                file.filename.replace(" ", "_")
                if file.filename
                else f"document-{uuid.uuid4()}.pdf"
            )
            file_extension = original_filename.split(".")[-1].lower()
            object_key = f"uploads/{uuid.uuid4()}-{original_filename}"

            # Read file content
            contents = await file.read()

            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=object_key,
                Body=contents,
                ContentType=f"application/{file_extension}",
            )

            # Generate the URL for the uploaded file
            file_url = f"https://{self.cloudflare_bucket_name}/{object_key}"

            # Rewind the file so it can be read again if needed
            await file.seek(0)

            return object_key, file_url

        except ClientError as e:
            logger.error(f"Error uploading file to S3: {e}")
            raise

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
        from app.database.crud.paper_crud import PaperUpdate, paper_crud

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

            # Update using CRUD
            updated_paper = paper_crud.update(
                db=db,
                db_obj=paper,
                obj_in=PaperUpdate(
                    cached_presigned_url=url, presigned_url_expires_at=expires_at
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
        from app.database.crud.paper_crud import PaperUpdate, paper_crud

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
        from app.database.crud.paper_crud import PaperUpdate, paper_crud
        from app.database.models import User

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


# Create a single instance to use throughout the application
s3_service = S3Service()
