from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


DEFAULT_FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("C:/Windows/Fonts/calibri.ttf"),
)


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in DEFAULT_FONT_CANDIDATES:
        if candidate.exists():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def build_statement_pdf(title: str, lines: Iterable[str]) -> bytes:
    """Render a simple multi-line PDF statement via Pillow."""
    title_font = _load_font(28)
    body_font = _load_font(18)

    content_lines = [title, "", *list(lines)]
    page_width = 1240
    page_height = 1754
    margin_x = 72
    margin_y = 88
    line_height = 32

    pages: list[Image.Image] = []
    image = Image.new("RGB", (page_width, page_height), "white")
    draw = ImageDraw.Draw(image)
    cursor_y = margin_y

    for index, line in enumerate(content_lines):
        if cursor_y > page_height - margin_y - line_height:
            pages.append(image)
            image = Image.new("RGB", (page_width, page_height), "white")
            draw = ImageDraw.Draw(image)
            cursor_y = margin_y

        font = title_font if index == 0 else body_font
        fill = "#0f172a" if index == 0 else "#334155"
        draw.text((margin_x, cursor_y), line, font=font, fill=fill)
        cursor_y += 44 if index == 0 else line_height

    pages.append(image)

    buffer = BytesIO()
    first_page, *rest = pages
    first_page.save(buffer, format="PDF", save_all=True, append_images=rest)
    return buffer.getvalue()
