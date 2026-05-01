from math import ceil
from typing import TypeVar, Generic, List, Optional
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")

class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool

    class Config:
        arbitrary_types_allowed = True

class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 20
    sort_by: Optional[str] = None
    sort_order: str = "desc"

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

async def paginate(
    session: AsyncSession,
    query,
    params: PaginationParams,
    count_query = None,
) -> Page:
    """Generic pagination helper"""
    # Get total count
    if count_query is None:
        count_query = select(func.count()).select_from(query.subquery())
    total_result = await session.execute(count_query)
    total = total_result.scalar()

    # Apply pagination
    if params.sort_by:
        from sqlalchemy import desc, asc
        order_func = desc if params.sort_order == "desc" else asc
        query = query.order_by(order_func(params.sort_by))

    query = query.offset(params.offset).limit(params.limit)
    result = await session.execute(query)
    items = result.scalars().all()

    return Page(
        items=list(items),
        total=total,
        page=params.page,
        page_size=params.limit,
        total_pages=ceil(total / params.limit) if total > 0 else 1,
        has_next=params.page < ceil(total / params.limit),
        has_prev=params.page > 1,
    )
