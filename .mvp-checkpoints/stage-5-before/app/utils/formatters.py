from datetime import datetime, timedelta
from typing import Optional
import re

def format_phone_number(phone: str) -> str:
    """Format phone number to readable format"""
    # Remove non-digits
    digits = re.sub(r"\D", "", phone)

    if len(digits) == 11 and digits.startswith("7"):
        return f"+7 ({digits[1:4]}) {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"
    elif len(digits) == 10:
        return f"+7 ({digits[0:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}"
    else:
        return phone

def format_currency(amount: float, currency: str = "RUB") -> str:
    """Format currency with proper spacing"""
    if currency == "RUB":
        return f"{amount:,.2f} ₽".replace(",", " ")
    else:
        return f"{amount:,.2f} {currency}"

def format_datetime(dt: datetime, format: str = "short") -> str:
    """Format datetime in user-friendly format"""
    now = datetime.utcnow()
    delta = now - dt

    if format == "relative":
        if delta.days > 365:
            return f"{delta.days // 365} года назад"
        elif delta.days > 30:
            return f"{delta.days // 30} месяцев назад"
        elif delta.days > 0:
            return f"{delta.days} дней назад"
        elif delta.seconds > 3600:
            return f"{delta.seconds // 3600} часов назад"
        elif delta.seconds > 60:
            return f"{delta.seconds // 60} минут назад"
        else:
            return "только что"
    elif format == "short":
        return dt.strftime("%d.%m.%Y %H:%M")
    else:
        return dt.strftime("%d %B %Y, %H:%M:%S")

def format_file_size(size_bytes: int) -> str:
    """Format file size to human readable"""
    if size_bytes == 0:
        return "0 B"

    size_names = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while size_bytes >= 1024 and i < len(size_names) - 1:
        size_bytes /= 1024
        i += 1

    return f"{size_bytes:.1f} {size_names[i]}"

def truncate_text(text: str, max_length: int = 100, suffix: str = "...") -> str:
    """Truncate text to specified length"""
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix

def mask_email(email: str) -> str:
    """Mask email for privacy"""
    if "@" not in email:
        return email
    local, domain = email.split("@")
    if len(local) <= 2:
        masked_local = "*" * len(local)
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"

def mask_phone(phone: str) -> str:
    """Mask phone number for privacy"""
    digits = re.sub(r"\D", "", phone)
    if len(digits) >= 10:
        return f"+7 *** *** {digits[-4:]}"
    return "*" * len(phone)

def calculate_percentage(part: float, total: float) -> float:
    """Calculate percentage"""
    if total == 0:
        return 0
    return round((part / total) * 100, 2)

def parse_duration(duration_str: str) -> Optional[timedelta]:
    """Parse duration string like '1h30m', '2d', '1w'"""
    import re

    pattern = r"^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$"
    match = re.match(pattern, duration_str.lower())

    if not match:
        return None

    days = int(match.group(1) or 0)
    hours = int(match.group(2) or 0)
    minutes = int(match.group(3) or 0)
    seconds = int(match.group(4) or 0)

    return timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)
