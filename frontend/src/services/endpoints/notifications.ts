import { api } from "@/services/api-client";
import type {
  ApiListPayload,
  NotificationEventType,
  NotificationItem,
  NotificationSettings,
} from "@/types/domain";

export const notificationsService = {
  async list(page = 1, limit = 20, filters?: Record<string, unknown>) {
    const { data } = await api.get<ApiListPayload<NotificationItem>>("/notifications", {
      params: {
        page,
        limit,
        ...filters,
      },
    });
    return data;
  },
  async unreadCount() {
    const { data } = await api.get<{ unread_count: number }>("/notifications/unread/count");
    return data;
  },
  async markRead(notificationId: number) {
    const { data } = await api.post<NotificationItem>(`/notifications/${notificationId}/read`);
    return data;
  },
  async markAllRead() {
    const { data } = await api.post("/notifications/mark-all-read");
    return data;
  },
  async archive(notificationId: number) {
    const { data } = await api.post<NotificationItem>(`/notifications/${notificationId}/archive`);
    return data;
  },
  async remove(notificationId: number) {
    const { data } = await api.delete(`/notifications/${notificationId}`);
    return data;
  },
  async settings() {
    const { data } = await api.get<NotificationSettings>("/notifications/settings");
    return data;
  },
  async updateSettings(payload: NotificationSettings) {
    const { data } = await api.put<NotificationSettings>("/notifications/settings", payload);
    return data;
  },
  async eventTypes() {
    const { data } = await api.get<NotificationEventType[]>("/notifications/events/types");
    return data;
  },
};
