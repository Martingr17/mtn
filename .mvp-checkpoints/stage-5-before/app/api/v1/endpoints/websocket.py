from fastapi import WebSocket, WebSocketDisconnect, Query
from typing import Optional
import json
from datetime import datetime

from app.services.websocket_manager import websocket_manager
from app.core.security import decode_token
from app.models import User, UserRole
from app.database import AsyncSessionLocal
from sqlalchemy import select
from app.services.notification_center import get_unread_count, mark_notification_read

STAFF_ROLE_VALUES = {
    UserRole.OPERATOR.value,
    UserRole.ADMIN.value,
    UserRole.SUPER_ADMIN.value,
}


def _role_value(role: object) -> str:
    return role.value if hasattr(role, "value") else str(role or "")


async def get_user_from_token(token: str) -> Optional[User]:
    """Extract user from WebSocket token"""
    try:
        payload = decode_token(token)
        if not payload or "sub" not in payload:
            return None

        user_id = int(payload["sub"])

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            return user
    except Exception:
        return None

async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
):
    """WebSocket endpoint for real-time notifications"""
    # Authenticate user
    user = await get_user_from_token(token)
    if not user or not user.is_active:
        await websocket.close(code=1008, reason="Authentication failed")
        return

    # Accept connection
    await websocket_manager.connect(websocket, user.id, _role_value(user.role))

    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection_established",
            "user_id": user.id,
            "timestamp": datetime.utcnow().isoformat(),
        })

        # Send unread notifications count
        async with AsyncSessionLocal() as db:
            unread_count = await get_unread_count(db, user.id)
        await websocket.send_json({
            "type": "unread_count",
            "count": unread_count,
        })

        # Listen for messages from client
        while True:
            data = await websocket.receive_text()

            try:
                message = json.loads(data)
                message_type = message.get("type")

                if message_type == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})

                elif message_type == "mark_read":
                    notification_id = message.get("notification_id")
                    if notification_id:
                        async with AsyncSessionLocal() as db:
                            notif = await mark_notification_read(
                                db,
                                user_id=user.id,
                                notification_id=int(notification_id),
                            )
                            if notif is not None:
                                await db.commit()
                                unread_count = await get_unread_count(db, user.id)
                                await websocket.send_json({
                                    "type": "unread_count",
                                    "count": unread_count,
                                })

                elif message_type == "subscribe":
                    room = message.get("room")
                    if room:
                        # Join room (for future features)
                        pass

                elif message_type == "typing":
                    ticket_id = message.get("ticket_id")
                    if ticket_id and _role_value(user.role) in STAFF_ROLE_VALUES:
                        # Notify that operator is typing
                        await websocket_manager.send_personal_message(
                            ticket_id,  # This would need mapping from ticket to user
                            {
                                "type": "operator_typing",
                                "ticket_id": ticket_id,
                                "operator_name": user.display_name,
                            },
                        )

            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON",
                })

    except WebSocketDisconnect:
        await websocket_manager.disconnect(websocket, user.id)
        print(f"User {user.id} disconnected")

    except Exception as e:
        print(f"WebSocket error for user {user.id}: {e}")
        await websocket_manager.disconnect(websocket, user.id)
