import logging
import os
import uuid
from typing import BinaryIO, Optional

import boto3
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
