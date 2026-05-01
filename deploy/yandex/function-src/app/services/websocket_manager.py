from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Set, List, Optional, Any
import asyncio
import json
import logging
from datetime import datetime
from app.services.cache import redis_cache
from app.core.constants import NotificationType, NotificationPriority

logger = logging.getLogger(__name__)

class ConnectionManager:
    """WebSocket connection manager for real-time notifications"""
    
    def __init__(self):
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        self.user_rooms: Dict[int, Set[str]] = {}
        self.user_roles: Dict[int, str] = {}
        self._lock = asyncio.Lock()
    
    async def connect(self, websocket: WebSocket, user_id: int, role: Optional[str] = None) -> None:
        """Accept WebSocket connection and store it"""
        await websocket.accept()
        async with self._lock:
            if user_id not in self.active_connections:
                self.active_connections[user_id] = set()
            self.active_connections[user_id].add(websocket)
            if role:
                self.user_roles[user_id] = str(role)
        
        logger.info(f"WebSocket connected for user {user_id}")
        
        # Send pending notifications
        await self._send_pending_notifications(websocket, user_id)
    
    async def disconnect(self, websocket: WebSocket, user_id: int) -> None:
        """Remove disconnected WebSocket"""
        async with self._lock:
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
                    self.user_roles.pop(user_id, None)
        
        logger.info(f"WebSocket disconnected for user {user_id}")
    
    async def send_personal_message(self, user_id: int, message: Dict[str, Any]) -> int:
        """Send message to specific user's all connections"""
        sent_count = 0
        if user_id in self.active_connections:
            dead_connections = []
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_json(message)
                    sent_count += 1
                except WebSocketDisconnect:
                    dead_connections.append(websocket)
                except Exception as e:
                    logger.error(f"Error sending to user {user_id}: {e}")
                    dead_connections.append(websocket)
            
            # Clean up dead connections
            for dead in dead_connections:
                await self.disconnect(dead, user_id)
        
        return sent_count
    
    async def broadcast(self, message: Dict[str, Any], roles: List[str] = None) -> int:
        """Broadcast message to all connected users or specific roles"""
        sent_count = 0
        allowed_roles = {str(role) for role in roles or []}
        async with self._lock:
            for user_id, connections in self.active_connections.items():
                if allowed_roles:
                    user_role = self.user_roles.get(user_id)
                    if user_role not in allowed_roles:
                        continue
                for websocket in connections:
                    try:
                        await websocket.send_json(message)
                        sent_count += 1
                    except Exception:
                        pass
        return sent_count
    
    async def notify_ticket_update(self, user_id: int, ticket_id: int, action: str, data: Dict[str, Any]) -> None:
        """Send ticket update notification"""
        message = {
            "type": "ticket_update",
            "ticket_id": ticket_id,
            "action": action,
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.send_personal_message(user_id, message)
    
    async def notify_balance_change(self, user_id: int, new_balance: float, old_balance: float) -> None:
        """Send balance change notification"""
        message = {
            "type": "balance_update",
            "new_balance": new_balance,
            "old_balance": old_balance,
            "change": new_balance - old_balance,
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.send_personal_message(user_id, message)
    
    async def notify_payment_status(self, user_id: int, payment_id: int, status: str, amount: float) -> None:
        """Send payment status notification"""
        message = {
            "type": "payment_status",
            "payment_id": payment_id,
            "status": status,
            "amount": amount,
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.send_personal_message(user_id, message)
    
    async def _send_pending_notifications(self, websocket: WebSocket, user_id: int) -> None:
        """Send pending notifications from Redis"""
        try:
            # Get pending notifications from Redis
            pending_key = f"pending_notifications:{user_id}"
            notifications = await redis_cache.get(pending_key, [])
            
            for notif in notifications:
                await websocket.send_json(notif)
            
            # Clear pending after sending
            await redis_cache.delete(pending_key)
        except Exception as e:
            logger.error(f"Error sending pending notifications: {e}")
    
    async def store_pending_notification(self, user_id: int, notification: Dict[str, Any]) -> None:
        """Store notification for offline users"""
        pending_key = f"pending_notifications:{user_id}"
        existing = await redis_cache.get(pending_key, [])
        existing.append(notification)
        # Keep last 50 notifications
        if len(existing) > 50:
            existing = existing[-50:]
        await redis_cache.set(pending_key, existing, expire=86400)  # 24 hours
    
    async def get_connection_count(self) -> int:
        """Get total number of active connections"""
        total = 0
        async with self._lock:
            for connections in self.active_connections.values():
                total += len(connections)
        return total
    
    async def is_user_online(self, user_id: int) -> bool:
        """Check if user has active WebSocket connection"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

# Global instance
websocket_manager = ConnectionManager()
