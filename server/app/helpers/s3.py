import logging
import os
import uuid
from typing import BinaryIO, Optional
from urllib.parse import urlparse

import boto3
import requests
from botocore.exceptions import ClientError
from fastapi import UploadFile

logger = logging.getLogger(__name__)

# Load AWS configuration from environment variables
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")


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
            file_url = f"https://{self.bucket_name}.s3.amazonaws.com/{object_key}"

            return object_key, file_url

        except requests.RequestException as e:
            logger.error(f"Error downloading file from URL: {e}")
            raise ValueError("Failed to download file from URL")
        except ClientError as e:
            logger.error(f"Error uploading file to S3: {e}")
            raise

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
            original_filename = file.filename.replace(" ", "_")
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
            file_url = f"https://{self.bucket_name}.s3.amazonaws.com/{object_key}"

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
            return url
        except ClientError as e:
            logger.error(f"Error generating presigned URL: {e}")
            return None


# Create a single instance to use throughout the application
s3_service = S3Service()
