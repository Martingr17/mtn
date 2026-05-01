import re
from typing import Optional, Tuple
from datetime import datetime, date
from phonenumbers import parse, is_valid_number, PhoneNumberType, number_type
import phonenumbers

class Validators:
    @staticmethod
    def validate_phone(phone: str) -> Tuple[bool, Optional[str]]:
        """Validate phone number in E.164 format"""
        try:
            raw_phone = re.sub(r"[^\d+]", "", str(phone or "").strip())
            if not raw_phone:
                return False, "Phone number is required"

            if raw_phone.startswith("8") and len(raw_phone) == 11:
                raw_phone = "+7" + raw_phone[1:]
            elif not raw_phone.startswith("+") and len(raw_phone) == 11 and raw_phone.startswith("7"):
                raw_phone = f"+{raw_phone}"

            parsed = parse(raw_phone, "RU" if not raw_phone.startswith("+") else None)
            if is_valid_number(parsed):
                # Check if it's a mobile number
                if number_type(parsed) in [
                    PhoneNumberType.MOBILE,
                    PhoneNumberType.FIXED_LINE_OR_MOBILE
                ]:
                    return True, None
                return False, "Only mobile numbers are allowed"
            return False, "Invalid phone number"
        except Exception:
            return False, "Invalid phone number format"
    
    @staticmethod
    def validate_password(password: str, min_length: int = 8) -> Tuple[bool, Optional[str]]:
        """Validate password strength"""
        if len(password) < min_length:
            return False, f"Password must be at least {min_length} characters"
        
        if not re.search(r'[A-Z]', password):
            return False, "Password must contain at least one uppercase letter"
        
        if not re.search(r'[a-z]', password):
            return False, "Password must contain at least one lowercase letter"
        
        if not re.search(r'\d', password):
            return False, "Password must contain at least one digit"
        
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            return False, "Password must contain at least one special character"
        
        # Check for common patterns
        common_patterns = ['123456', 'password', 'qwerty', 'admin', 'letmein']
        if any(pattern in password.lower() for pattern in common_patterns):
            return False, "Password contains common patterns"
        
        return True, None
    
    @staticmethod
    def validate_email(email: str) -> Tuple[bool, Optional[str]]:
        """Validate email format"""
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if re.match(pattern, email):
            return True, None
        return False, "Invalid email format"
    
    @staticmethod
    def validate_billing_id(billing_id: str) -> Tuple[bool, Optional[str]]:
        """Validate billing account ID format"""
        if not billing_id:
            return False, "Billing ID is required"
        
        if len(billing_id) < 4 or len(billing_id) > 32:
            return False, "Billing ID must be between 4 and 32 characters"
        
        if not re.match(r'^[A-Z0-9]+$', billing_id, re.IGNORECASE):
            return False, "Billing ID must contain only letters and numbers"
        
        return True, None
    
    @staticmethod
    def validate_date_range(
        start_date: date,
        end_date: date,
        max_days: int = 365
    ) -> Tuple[bool, Optional[str]]:
        """Validate date range"""
        if start_date > end_date:
            return False, "Start date must be before end date"
        
        if end_date > date.today():
            return False, "End date cannot be in the future"
        
        delta = (end_date - start_date).days
        if delta > max_days:
            return False, f"Date range cannot exceed {max_days} days"
        
        return True, None
    
    @staticmethod
    def validate_amount(amount: float) -> Tuple[bool, Optional[str]]:
        """Validate payment amount"""
        if amount <= 0:
            return False, "Amount must be greater than 0"
        
        if amount > 100000:
            return False, "Amount cannot exceed 100,000 rubles"
        
        if amount != round(amount, 2):
            return False, "Amount can have at most 2 decimal places"
        
        return True, None
    
    @staticmethod
    def sanitize_html(text: str) -> str:
        """Basic HTML sanitization"""
        import html
        return html.escape(text)
    
    @staticmethod
    def validate_file_extension(filename: str, allowed_extensions: list) -> bool:
        """Validate file extension"""
        ext = filename.lower().split('.')[-1] if '.' in filename else ''
        return f".{ext}" in allowed_extensions
