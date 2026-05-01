import { api } from "@/services/api-client";
import type {
  AdminStats,
  AdminStaffRow,
  AdminSystemInfo,
  AdminSystemSettings,
  AdminTicketRow,
  AdminUserRow,
  ApiListPayload,
  Tariff,
} from "@/types/domain";

function normalizeStaffListResponse(payload: AdminStaffRow[] | ApiListPayload<AdminStaffRow>) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload.items) ? payload.items : [];
}

export const adminService = {
  async stats() {
    const { data } = await api.get<AdminStats>("/admin/stats");
    return data;
  },
  async dashboard() {
    const { data } = await api.get<Record<string, unknown>>("/admin/dashboard");
    return data;
  },
  async listUsers(params?: Record<string, unknown>) {
    const { data } = await api.get<ApiListPayload<AdminUserRow>>("/admin/users", { params });
    return data;
  },
  async getUser(userId: string | number) {
    const { data } = await api.get<Record<string, unknown>>(`/admin/users/${userId}`);
    return data;
  },
  async createUser(payload: Record<string, unknown>) {
    const { data } = await api.post("/admin/users", payload);
    return data;
  },
  async updateUser(userId: string | number, payload: Record<string, unknown>) {
    const { data } = await api.patch(`/admin/users/${userId}`, payload);
    return data;
  },
  async manualPayment(userId: string | number, amount: number, comment?: string) {
    const { data } = await api.post(`/admin/users/${userId}/manual-payment`, {
      amount,
      comment,
    });
    return data;
  },
  async blockUser(userId: string | number, reason?: string) {
    const { data } = await api.post(`/admin/users/${userId}/block`, null, {
      params: reason ? { reason } : undefined,
    });
    return data;
  },
  async unblockUser(userId: string | number) {
    const { data } = await api.post(`/admin/users/${userId}/unblock`);
    return data;
  },
  async listTickets(params?: Record<string, unknown>) {
    const { data } = await api.get<ApiListPayload<AdminTicketRow>>("/admin/tickets", { params });
    return data;
  },
  async ticket(ticketId: string | number) {
    const { data } = await api.get<Record<string, unknown>>(`/admin/tickets/${ticketId}`);
    return data;
  },
  async assignTicket(ticketId: string | number, assigneeId: string | number) {
    const { data } = await api.post(`/admin/tickets/${ticketId}/assign`, null, {
      params: { assignee_id: assigneeId },
    });
    return data;
  },
  async replyTicket(ticketId: string | number, body: string) {
    const formData = new FormData();
    formData.append("body", body);
    const { data } = await api.post(`/admin/tickets/${ticketId}/reply`, formData);
    return data;
  },
  async resolveTicket(ticketId: string | number, resolutionSummary: string) {
    const { data } = await api.post(`/admin/tickets/${ticketId}/resolve`, {
      resolution_summary: resolutionSummary,
    });
    return data;
  },
  async staff() {
    const { data } = await api.get<AdminStaffRow[] | ApiListPayload<AdminStaffRow>>("/admin/staff");
    return normalizeStaffListResponse(data);
  },
  async staffDetail(staffId: string | number) {
    const { data } = await api.get<Record<string, unknown>>(`/admin/staff/${staffId}`);
    return data;
  },
  async createStaff(payload: Record<string, unknown>) {
    const { data } = await api.post("/admin/staff", payload);
    return data;
  },
  async updateStaff(staffId: string | number, payload: Record<string, unknown>) {
    const { data } = await api.put(`/admin/staff/${staffId}`, payload);
    return data;
  },
  async logs(page = 1, pageSize = 40, level = "all") {
    const { data } = await api.get<ApiListPayload<Record<string, unknown>>>("/admin/logs", {
      params: { page, page_size: pageSize, level },
    });
    return data;
  },
  async systemInfo() {
    const { data } = await api.get<AdminSystemInfo>("/admin/system/info");
    return data;
  },
  async systemSettings() {
    const { data } = await api.get<AdminSystemSettings>("/admin/system/settings");
    return data;
  },
  async updateSystemSettings(payload: AdminSystemSettings) {
    const { data } = await api.put("/admin/system/settings", payload);
    return data;
  },
  async clearCache() {
    const { data } = await api.post("/admin/cache/clear");
    return data;
  },
  async maintenance(enabled: boolean) {
    const { data } = await api.post("/admin/maintenance", null, {
      params: { enabled },
    });
    return data;
  },
  async tariffs() {
    const { data } = await api.get<Tariff[]>("/tariffs/admin/list");
    return data;
  },
};
