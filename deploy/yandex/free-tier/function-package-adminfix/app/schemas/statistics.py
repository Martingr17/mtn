from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime

class TrafficStatsResponse(BaseModel):
    total_gb: float
    daily_load: List[Dict]
    hourly_load: List[Dict]
    peak_hour: Optional[str] = None
    average_daily: Optional[float] = None

class PaymentStatsResponse(BaseModel):
    total_amount: float
    average_amount: float
    largest_payment: float
    payment_count: int
    monthly_totals: List[Dict]
    recent_payments: List[Dict]

class TicketStatsResponse(BaseModel):
    total_tickets: int
    open_tickets: int
    resolved_tickets: int
    closed_tickets: int
    average_response_time_hours: float
    average_resolution_time_hours: float
    status_breakdown: Dict
    monthly_trend: List[Dict]

class UserActivityResponse(BaseModel):
    user_id: Optional[int] = None
    action: str
    ip: Optional[str] = None
    created_at: datetime

class DashboardStatsResponse(BaseModel):
    total_users: int
    new_users_today: int
    new_users_week: int
    blocked_users: int
    total_tickets: int
    open_tickets: int
    overdue_tickets: int
    tickets_today: int
    revenue_month: float
    revenue_today: float
    active_users_today: int
    recent_activities: List[Dict]
