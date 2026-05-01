from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import List, Optional

from app.database import get_db
from app.models import User, Ticket, Tariff
from app.dependencies import get_current_user
from app.schemas.user import UserResponse
from app.schemas.ticket import TicketResponse
from app.schemas.tariff import TariffResponse

router = APIRouter(prefix="/search", tags=["search"])


def _role_value(role) -> str:
    return role.value if hasattr(role, "value") else str(role)

@router.get("/global")
async def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(20, le=50),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Global search across users, tickets, tariffs"""
    
    results = {
        "users": [],
        "tickets": [],
        "tariffs": []
    }
    
    # Search users (only for admin)
    if _role_value(current_user.role) in ["admin", "operator", "super_admin"]:
        user_result = await db.execute(
            select(User)
            .where(
                or_(
                    User.phone.contains(q),
                    User.email.contains(q),
                    User.billing_id.contains(q),
                    User.first_name.contains(q),
                    User.last_name.contains(q)
                )
            )
            .limit(limit)
        )
        results["users"] = [UserResponse.model_validate(u).model_dump() for u in user_result.scalars().all()]
    
    # Search tickets (user sees own, admin sees all)
    ticket_query = select(Ticket)
    if _role_value(current_user.role) not in ["admin", "operator", "super_admin"]:
        ticket_query = ticket_query.where(Ticket.user_id == current_user.id)
    
    ticket_query = ticket_query.where(
        or_(
            Ticket.subject.contains(q),
            Ticket.id == (int(q) if q.isdigit() else -1)
        )
    ).limit(limit)
    
    ticket_result = await db.execute(ticket_query)
    results["tickets"] = [TicketResponse.model_validate(t).model_dump() for t in ticket_result.scalars().all()]
    
    # Search tariffs
    tariff_result = await db.execute(
        select(Tariff)
        .where(
            or_(
                Tariff.name.contains(q),
                Tariff.description.contains(q)
            )
        )
        .limit(limit)
    )
    results["tariffs"] = [TariffResponse.model_validate(t).model_dump() for t in tariff_result.scalars().all()]
    
    return results

@router.get("/users")
async def search_users(
    q: str = Query(..., min_length=2),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Search users (admin only)"""
    
    if _role_value(current_user.role) not in ["admin", "operator", "super_admin"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    result = await db.execute(
        select(User)
        .where(
            or_(
                User.phone.contains(q),
                User.email.contains(q),
                User.billing_id.contains(q),
                User.first_name.contains(q),
                User.last_name.contains(q),
            )
        )
        .limit(limit)
    )
    
    return [UserResponse.model_validate(u) for u in result.scalars().all()]
