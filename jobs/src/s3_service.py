"""
S3 service for file uploads and management.
"""
import logging
import os
import uuid
from typing import Tuple
from urllib.parse import urlparse

import boto3 # type: ignore
from botocore.exceptions import ClientError # type: ignore

logger = logging.getLogger(__name__)

# Load AWS configuration from environment variables
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
CLOUDFLARE_BUCKET_NAME = os.environ.get("CLOUDFLARE_BUCKET_NAME")
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "uploads")


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

    def upload_any_file_from_bytes(
        self,
        file_bytes: bytes,
        original_filename: str,
        content_type: str,
    ) -> Tuple[str, str]:
        """Upload a file from bytes to S3

        Args:
            file_bytes (bytes): The file content as bytes
            original_filename (str): The original filename
            content_type (str): The MIME type of the file

        Returns:
            tuple[str, str]: The S3 object key and public URL
        """
        object_key = f"{UPLOAD_DIR}/{uuid.uuid4()}-{original_filename}"
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=object_key,
            Body=file_bytes,
            ContentType=content_type,
        )
        file_url = f"https://{self.cloudflare_bucket_name}/{object_key}"
        return object_key, file_url

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

            logger.info(f"Uploading file {original_filename} to S3 with key {object_key}")
            logger.info(f"bucket_name: {self.bucket_name}, cloudflare_bucket_name: {self.cloudflare_bucket_name}")

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


# Create a single instance to use throughout the application
s3_service = S3Service()
