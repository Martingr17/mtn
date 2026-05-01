import io
import logging
import mimetypes
import os
import uuid
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

import aiofiles
from fastapi import UploadFile
from PIL import Image

from app.config import settings

try:
    import magic
except ImportError:  # pragma: no cover - depends on runtime image
    magic = None

logger = logging.getLogger(__name__)

ALLOWED_MIME_TYPES = settings.allowed_mime_types
MAX_SIZE = settings.max_upload_size


def _detect_mime_from_buffer(content: bytes, filename: Optional[str] = None) -> str:
    if magic is not None:
        try:
            detected = magic.from_buffer(content, mime=True)
            if detected:
                return detected
        except Exception:
            logger.warning("python-magic buffer detection failed; falling back to mimetypes", exc_info=True)

    guessed, _ = mimetypes.guess_type(filename or "")
    return guessed or "application/octet-stream"


def _detect_mime_from_file(filepath: str, filename: Optional[str] = None) -> str:
    if magic is not None:
        try:
            detected = magic.from_file(filepath, mime=True)
            if detected:
                return detected
        except Exception:
            logger.warning("python-magic file detection failed; falling back to mimetypes", exc_info=True)

    guessed, _ = mimetypes.guess_type(filename or filepath)
    return guessed or "application/octet-stream"

def validate_file(file: UploadFile) -> Tuple[bool, Optional[str]]:
    """Validate file type and size"""
    # Check size
    if file.size > MAX_SIZE:
        return False, f"File too large. Max size: {MAX_SIZE // (1024*1024)}MB"

    # Check MIME type
    try:
        content = file.file.read(1024)
        file.file.seek(0)
        mime = _detect_mime_from_buffer(content, file.filename)

        if mime not in ALLOWED_MIME_TYPES:
            return False, f"File type {mime} not allowed"

        return True, None
    except Exception as e:
        return False, f"Error validating file: {e!s}"

def validate_image(file: UploadFile) -> bool:
    """Validate image file specifically"""
    valid, error = validate_file(file)
    if not valid:
        return False

    try:
        content = file.file.read()
        file.file.seek(0)
        image = Image.open(io.BytesIO(content))
        image.verify()
        return True
    except Exception:
        return False

async def save_attachment(
    file: UploadFile,
    user_id: int,
    ticket_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Save uploaded file attachment"""
    # Create directory structure
    if ticket_id:
        subdir = f"tickets/{ticket_id}"
    else:
        subdir = f"users/{user_id}"

    full_dir = os.path.join(settings.upload_dir, subdir)
    os.makedirs(full_dir, exist_ok=True)

    # Generate safe filename
    original_filename = file.filename
    file_extension = os.path.splitext(original_filename)[1].lower()
    safe_filename = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{file_extension}"
    filepath = os.path.join(full_dir, safe_filename)

    # Save file
    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Get file info
    file_size = os.path.getsize(filepath)
    mime = _detect_mime_from_file(filepath, original_filename)

    return {
        "path": filepath,
        "filename": safe_filename,
        "original_filename": original_filename,
        "size": file_size,
        "mime_type": mime,
    }

async def save_avatar(file: UploadFile, user_id: int) -> str:
    """Save user avatar image"""
    if not validate_image(file):
        raise ValueError("Invalid image file")

    avatar_dir = os.path.join(settings.upload_dir, "avatars")
    os.makedirs(avatar_dir, exist_ok=True)

    # Process image
    content = await file.read()
    image = Image.open(io.BytesIO(content))

    # Resize to 200x200
    image.thumbnail((200, 200), Image.Resampling.LANCZOS)

    # Save as PNG
    filename = f"avatar_{user_id}_{uuid.uuid4().hex[:8]}.png"
    filepath = os.path.join(avatar_dir, filename)

    image.save(filepath, "PNG")

    return filepath

async def delete_file(filepath: str) -> bool:
    """Delete file if exists"""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
    except Exception as e:
        logger.error(f"Failed to delete file {filepath}: {e}")
    return False
