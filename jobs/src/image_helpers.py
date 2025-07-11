import hashlib
from io import BytesIO
import logging
from typing import Dict, Tuple, Union
from PIL import Image, ImageStat
import numpy as np

logger = logging.getLogger(__name__)


def calculate_image_hash(image_bytes: bytes) -> str:
    """Calculate MD5 hash of image bytes for duplicate detection"""
    return hashlib.md5(image_bytes).hexdigest()

def is_image_mostly_empty(image_bytes: bytes) -> bool:
    """
    Check if an image is mostly empty (black, white, or single color).

    Args:
        image_bytes: Raw image bytes

    Returns:
        bool: True if image is mostly empty/uniform
    """
    try:
        # Open image with PIL
        img = Image.open(BytesIO(image_bytes))

        # Convert to RGB if not already
        if img.mode != 'RGB':
            img = img.convert('RGB')  # type: ignore

        # Calculate image statistics
        stat = ImageStat.Stat(img)

        # Get the standard deviation for each channel
        stddev = stat.stddev

        # If all channels have very low standard deviation, it's mostly uniform
        avg_stddev = sum(stddev) / len(stddev)

        # Also check for mostly black images
        mean_brightness = sum(stat.mean) / len(stat.mean)

        # Consider image empty if:
        # 1. Very low variation (uniform color) - more lenient for scientific figures
        # 2. Very dark (likely corrupted/empty)
        # 3. Very bright (likely empty white)
        is_uniform = avg_stddev < 3  # Much more lenient for scientific figures with clean backgrounds
        is_very_dark = mean_brightness < 10  # Very dark
        is_very_bright = mean_brightness > 250  # Very bright (near pure white)

        # Additional check: if it's mostly uniform but has reasonable brightness, it might still be valid
        # This helps preserve figures with clean backgrounds
        if is_uniform and 30 < mean_brightness < 220:
            # Check if there's any meaningful variation at all
            max_channel_stddev = max(stddev) if stddev else 0
            if max_channel_stddev > 8:  # At least one channel has some variation
                return False

        return is_uniform or is_very_dark or is_very_bright

    except Exception as e:
        logger.warning(f"Failed to analyze image emptiness: {e}")
        return False

def is_valid_image_size(width: int, height: int, file_size: int) -> bool:
    """
    Check if image dimensions and file size are reasonable.

    Args:
        width: Image width in pixels
        height: Image height in pixels
        file_size: File size in bytes

    Returns:
        bool: True if image size is valid
    """
    # Filter out very small images (likely artifacts)
    if width < 30 or height < 30:  # More lenient for small but meaningful graphics
        return False

    # More intelligent size filtering for academic papers
    # Allow high-resolution figures but filter out obvious full-page scans
    total_pixels = width * height

    # Very large images (> 50 megapixels) are likely full-page scans
    if total_pixels > 50_000_000:
        return False

    # Filter out extremely large single dimensions (likely page scans)
    if width > 15000 or height > 15000:
        return False

    # Filter out images with extreme aspect ratios
    aspect_ratio = max(width, height) / min(width, height)
    if aspect_ratio > 25:  # Even more lenient for wide charts/graphs
        return False

    # Filter out very small file sizes (likely empty/corrupted)
    if file_size < 500:  # More lenient for simple graphics
        return False

    # More intelligent file size validation
    # Allow larger file sizes for high-resolution images
    bytes_per_pixel = file_size / total_pixels

    # Suspiciously large files (> 50 bytes per pixel) are likely corrupted
    if bytes_per_pixel > 50:
        return False

    # Suspiciously small files (< 0.01 bytes per pixel) are likely corrupted
    if bytes_per_pixel < 0.01:
        return False

    return True

def analyze_image_quality(image_bytes: bytes) -> Dict[str, Union[bool, float, int]]:
    """
    Comprehensive image quality analysis.

    Args:
        image_bytes: Raw image bytes

    Returns:
        Dict with quality metrics
    """
    try:
        img = Image.open(BytesIO(image_bytes))

        # Convert to RGB for consistent analysis
        if img.mode != 'RGB':
            img = img.convert('RGB')  # type: ignore

        # Convert to numpy array for analysis
        img_array = np.array(img)

        # Calculate various quality metrics
        width, height = img.size
        file_size = len(image_bytes)

        # Color analysis
        stat = ImageStat.Stat(img)
        avg_brightness = sum(stat.mean) / len(stat.mean)
        color_variance = sum(stat.stddev) / len(stat.stddev)

        # Edge detection (simplified - count high-contrast pixels)
        gray = img.convert('L')
        gray_array = np.array(gray)

        # Calculate edge density using simple gradient method (avoid scipy dependency)
        # Calculate horizontal and vertical gradients
        grad_x = np.abs(np.diff(gray_array, axis=1))
        grad_y = np.abs(np.diff(gray_array, axis=0))

        # Count significant edges
        edge_pixels = np.sum(grad_x > 15) + np.sum(grad_y > 15)  # More sensitive edge detection
        edge_density = edge_pixels / (width * height)

        # Entropy (measure of information content)
        histogram = gray.histogram()
        total_pixels = width * height
        entropy = -sum([(count/total_pixels) * np.log2(count/total_pixels + 1e-10)
                       for count in histogram if count > 0])

        # More sophisticated content detection for scientific figures
        # Check for text-like patterns (high frequency components)
        text_like_edges = np.sum(grad_x > 30) + np.sum(grad_y > 30)
        text_density = text_like_edges / (width * height)

        # Check for structured content (charts, graphs, diagrams)
        # Look for both horizontal and vertical structures
        horizontal_structure = np.sum(grad_y > 25) / (width * height)
        vertical_structure = np.sum(grad_x > 25) / (width * height)
        has_structure = horizontal_structure > 0.001 or vertical_structure > 0.001

        # Determine if image has meaningful content
        has_meaningful_content = (
            (edge_density > 0.005 and entropy > 2.0) or  # Lower thresholds for scientific figures
            (text_density > 0.002) or  # Has text-like content
            (has_structure and entropy > 1.5) or  # Has structural elements
            (color_variance > 15 and entropy > 2.5)  # Has reasonable color variation
        )

        return {
            'width': width,
            'height': height,
            'file_size': file_size,
            'avg_brightness': float(avg_brightness),
            'color_variance': float(color_variance),
            'edge_density': float(edge_density),
            'entropy': float(entropy),
            'text_density': float(text_density),
            'horizontal_structure': float(horizontal_structure),
            'vertical_structure': float(vertical_structure),
            'is_valid_size': is_valid_image_size(width, height, file_size),
            'is_mostly_empty': is_image_mostly_empty(image_bytes),
            'has_meaningful_content': bool(has_meaningful_content)
        }

    except Exception as e:
        logger.warning(f"Failed to analyze image quality: {e}")
        return {
            'width': 0,
            'height': 0,
            'file_size': len(image_bytes),
            'is_valid_size': False,
            'is_mostly_empty': True,
            'has_meaningful_content': False
        }

def should_include_image(image_bytes: bytes, quality_metrics: Union[Dict[str, Union[bool, float, int]], None] = None) -> Tuple[bool, str]:
    """
    Determine if an image should be included based on quality analysis.

    Args:
        image_bytes: Raw image bytes
        quality_metrics: Pre-computed quality metrics (optional)

    Returns:
        Tuple[bool, str]: (should_include, reason)
    """
    if quality_metrics is None:
        quality_metrics = analyze_image_quality(image_bytes)

    # Check size validity
    if not quality_metrics.get('is_valid_size', False):
        width = quality_metrics.get('width', 0)
        height = quality_metrics.get('height', 0)
        file_size = quality_metrics.get('file_size', 0)
        total_pixels = width * height
        bytes_per_pixel = file_size / total_pixels if total_pixels > 0 else 0
        aspect_ratio = max(width, height) / min(width, height) if min(width, height) > 0 else 0

        return False, f"Invalid dimensions: {width}x{height} (pixels: {total_pixels:,}, bytes/pixel: {bytes_per_pixel:.3f}, aspect: {aspect_ratio:.1f})"

    # Check if mostly empty
    if quality_metrics.get('is_mostly_empty', True):
        return False, f"Mostly empty/uniform image (brightness: {quality_metrics.get('avg_brightness', 0):.1f}, variance: {quality_metrics.get('color_variance', 0):.1f})"

    # Check for meaningful content
    if not quality_metrics.get('has_meaningful_content', False):
        return False, f"No meaningful content detected (entropy: {quality_metrics.get('entropy', 0):.2f}, edge_density: {quality_metrics.get('edge_density', 0):.4f}, text_density: {quality_metrics.get('text_density', 0):.4f})"

    # Check minimum file size
    if quality_metrics.get('file_size', 0) < 500:  # Updated threshold
        return False, f"File too small: {quality_metrics.get('file_size', 0)} bytes"

    return True, f"Image quality acceptable (entropy: {quality_metrics.get('entropy', 0):.2f}, edge_density: {quality_metrics.get('edge_density', 0):.4f}, size: {quality_metrics.get('width', 0)}x{quality_metrics.get('height', 0)})"
