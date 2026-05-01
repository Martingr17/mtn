#!/usr/bin/env python
"""
Seed database with test data
Run: python scripts/seed_data.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from app.database import AsyncSessionLocal
from app.models import User, Tariff, Ticket, PaymentLog, Notification
from app.core.security import get_password_hash
from datetime import datetime, timedelta
import random

async def seed_users():
    """Create test users"""
    users = [
        {
            "billing_id": f"USER{i:05d}",
            "phone": f"+7999{i:07d}",
            "email": f"user{i}@example.com",
            "first_name": f"Иван{i}",
            "last_name": "Тестов",
            "role": "user",
            "is_active": True
        }
        for i in range(1, 101)  # 100 users
    ]
    
    # Add admin user
    users.append({
        "billing_id": "ADMIN001",
        "phone": "+79990000001",
        "email": "admin@operator.ru",
        "first_name": "Admin",
        "last_name": "Adminov",
        "role": "admin",
        "is_active": True,
        "password_hash": get_password_hash("Admin123!")
    })
    
    async with AsyncSessionLocal() as db:
        for user_data in users:
            user = User(**user_data)
            db.add(user)
        await db.commit()
        print(f"Created {len(users)} users")

async def seed_tariffs():
    """Create tariffs"""
    tariffs = [
        {
            "billing_tariff_id": "TAR_100",
            "name": "Стартовый",
            "speed_mbps": 100,
            "price": 450.00,
            "is_unlimited": True,
            "is_active": True,
            "sort_order": 1
        },
        {
            "billing_tariff_id": "TAR_200",
            "name": "Оптимальный",
            "speed_mbps": 200,
            "price": 650.00,
            "is_unlimited": True,
            "is_active": True,
            "is_popular": True,
            "sort_order": 2
        },
        {
            "billing_tariff_id": "TAR_500",
            "name": "Премиум",
            "speed_mbps": 500,
            "price": 950.00,
            "is_unlimited": True,
            "is_active": True,
            "sort_order": 3
        },
        {
            "billing_tariff_id": "TAR_1000",
            "name": "Гигабитный",
            "speed_mbps": 1000,
            "price": 1450.00,
            "setup_fee": 500,
            "is_unlimited": False,
            "traffic_limit_gb": 5000,
            "is_active": True,
            "sort_order": 4
        }
    ]
    
    async with AsyncSessionLocal() as db:
        for tariff_data in tariffs:
            tariff = Tariff(**tariff_data)
            db.add(tariff)
        await db.commit()
        print(f"Created {len(tariffs)} tariffs")

async def seed_tickets():
    """Create test tickets"""
    async with AsyncSessionLocal() as db:
        # Get users
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.role == "user").limit(20))
        users = result.scalars().all()
        
        subjects = [
            "Проблема с интернетом",
            "Медленная скорость",
            "Вопрос по оплате",
            "Смена тарифа",
            "Техническая поддержка"
        ]
        
        statuses = ["new", "in_progress", "resolved", "closed"]
        
        tickets = []
        for user in users:
            for _ in range(random.randint(1, 5)):
                ticket = Ticket(
                    user_id=user.id,
                    subject=random.choice(subjects),
                    status=random.choice(statuses),
                    priority=random.choice(["low", "medium", "high"]),
                    created_at=datetime.utcnow() - timedelta(days=random.randint(0, 60))
                )
                tickets.append(ticket)
        
        for ticket in tickets:
            db.add(ticket)
        await db.commit()
        print(f"Created {len(tickets)} tickets")

async def seed_payments():
    """Create test payments"""
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.role == "user"))
        users = result.scalars().all()
        
        payments = []
        for user in users:
            for _ in range(random.randint(0, 10)):
                payment = PaymentLog(
                    user_id=user.id,
                    amount=random.choice([100, 200, 500, 1000, 2000, 5000]),
                    status=random.choice(["succeeded", "pending", "failed"]),
                    payment_method=random.choice(["bank_card", "sbp", "apple_pay"]),
                    created_at=datetime.utcnow() - timedelta(days=random.randint(0, 180))
                )
                payments.append(payment)
        
        for payment in payments:
            db.add(payment)
        await db.commit()
        print(f"Created {len(payments)} payments")

async def main():
    """Main seeding function"""
    print("Starting database seeding...")
    
    await seed_tariffs()
    await seed_users()
    await seed_tickets()
    await seed_payments()
    
    print("Seeding completed!")

if __name__ == "__main__":
    asyncio.run(main())