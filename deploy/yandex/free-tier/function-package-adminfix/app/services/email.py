import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from jinja2 import Template
from app.config import settings
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path

logger = logging.getLogger(__name__)

class EmailService:
    def __init__(self):
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.user = settings.smtp_user
        self.password = settings.smtp_password
        self.from_email = settings.smtp_from
        self.use_tls = settings.smtp_use_tls
        self.use_ssl = settings.smtp_use_ssl

    async def send_email(
        self,
        to_email: str,
        subject: str,
        body: str,
        html_body: Optional[str] = None,
        attachments: List[Dict[str, Any]] = None,
        cc: List[str] = None,
        bcc: List[str] = None,
    ) -> bool:
        """Send email with optional HTML and attachments"""
        try:
            if settings.environment != "production":
                logger.info(f"[MOCK EMAIL] To={to_email}, Subject={subject}")
                return True

            if self.use_ssl:
                server = smtplib.SMTP_SSL(self.host, self.port)
            else:
                server = smtplib.SMTP(self.host, self.port)

            if self.use_tls and not self.use_ssl:
                server.starttls()

            if self.user and self.password:
                server.login(self.user, self.password)

            msg = MIMEMultipart("alternative")
            msg["From"] = self.from_email
            msg["To"] = to_email
            msg["Subject"] = subject

            if cc:
                msg["Cc"] = ", ".join(cc)
            if bcc:
                msg["Bcc"] = ", ".join(bcc)

            # Attach plain text version
            msg.attach(MIMEText(body, "plain"))

            # Attach HTML version if provided
            if html_body:
                msg.attach(MIMEText(html_body, "html"))

            # Attach files
            if attachments:
                for attachment in attachments:
                    part = MIMEApplication(attachment["content"])
                    part.add_header(
                        "Content-Disposition",
                        "attachment",
                        filename=attachment.get("filename", "attachment"),
                    )
                    msg.attach(part)

            recipients = [to_email]
            if cc:
                recipients.extend(cc)
            if bcc:
                recipients.extend(bcc)

            server.sendmail(self.from_email, recipients, msg.as_string())
            server.quit()

            logger.info(f"Email sent to {to_email}: {subject}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    async def send_template_email(
        self,
        to_email: str,
        template_name: str,
        context: Dict[str, Any],
        subject: str = None,
    ) -> bool:
        """Send email using template"""
        # Load template from file
        template_path = Path(f"app/templates/emails/{template_name}.html")
        if template_path.exists():
            with open(template_path, encoding="utf-8") as f:
                html_template = Template(f.read())
            html_body = html_template.render(**context)
        else:
            html_body = None

        # Plain text fallback
        text_template_path = Path(f"app/templates/emails/{template_name}.txt")
        if text_template_path.exists():
            with open(text_template_path, encoding="utf-8") as f:
                text_template = Template(f.read())
            body = text_template.render(**context)
        else:
            body = str(context)

        if not subject:
            subject = "Notification from Operator"

        return await self.send_email(to_email, subject, body, html_body)

email_service = EmailService()

async def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
) -> bool:
    """Convenience function to send email"""
    return await email_service.send_email(to_email, subject, body, html_body)

async def send_welcome_email(to_email: str, name: str) -> bool:
    """Send welcome email to new user"""
    return await email_service.send_template_email(
        to_email,
        "welcome",
        {"name": name, "year": 2026},
        "Welcome to Operator!",
    )

async def send_ticket_reply_email(to_email: str, ticket_id: int, message_preview: str) -> bool:
    """Send notification about ticket reply"""
    return await email_service.send_template_email(
        to_email,
        "ticket_reply",
        {"ticket_id": ticket_id, "message": message_preview},
        f"New reply to ticket #{ticket_id}",
    )


async def send_verification_code_email(
    to_email: str,
    code: str,
    expires_in_minutes: int,
) -> bool:
    """Send account verification code email."""
    return await email_service.send_template_email(
        to_email,
        "account_verification_code",
        {
            "code": code,
            "expires_in_minutes": expires_in_minutes,
        },
        "Код подтверждения аккаунта",
    )
