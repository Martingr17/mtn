import { api } from "@/services/api-client";
import type {
  AdminStats,
  AdminStaffRow,
  AdminSystemInfo,
  AdminSystemSettings,
  AdminTicketRow,
  AdminUserRow,
  ApiListPayload,
  EntityId,
  Tariff,
} from "@/types/domain";

function normalizeStaffListResponse(payload: AdminStaffRow[] | ApiListPayload<AdminStaffRow>) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload.items) ? payload.items : [];
}

function normalizeLogsResponse(payload: ApiListPayload<Record<string, unknown>> & { logs?: Record<string, unknown>[] }) {
  return {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : Array.isArray(payload.logs) ? payload.logs : [],
  };
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
  async getUser(userId: EntityId) {
    const { data } = await api.get<Record<string, unknown>>(`/admin/users/${userId}`);
    return data;
  },
  async createUser(payload: Record<string, unknown>) {
    const { data } = await api.post("/admin/users", payload);
    return data;
  },
  async updateUser(userId: EntityId, payload: Record<string, unknown>) {
    const { data } = await api.patch(`/admin/users/${userId}`, payload);
    return data;
  },
  async manualPayment(userId: EntityId, amount: number, comment?: string) {
    const { data } = await api.post(`/admin/users/${userId}/manual-payment`, {
      amount,
      comment,
    });
    return data;
  },
  async blockUser(userId: EntityId, reason?: string) {
    const { data } = await api.post(`/admin/users/${userId}/block`, null, {
      params: reason ? { reason } : undefined,
    });
    return data;
  },
  async unblockUser(userId: EntityId) {
    const { data } = await api.post(`/admin/users/${userId}/unblock`);
    return data;
  },
  async listTickets(params?: Record<string, unknown>) {
    const { data } = await api.get<ApiListPayload<AdminTicketRow>>("/admin/tickets", { params });
    return data;
  },
  async ticket(ticketId: EntityId) {
    const { data } = await api.get<Record<string, unknown>>(`/admin/tickets/${ticketId}`);
    return data;
  },
  async assignTicket(ticketId: EntityId, assigneeId: EntityId) {
    const { data } = await api.post(`/admin/tickets/${ticketId}/assign`, null, {
      params: { assignee_id: assigneeId },
    });
    return data;
  },
  async replyTicket(ticketId: EntityId, body: string) {
    const formData = new FormData();
    formData.append("body", body);
    const { data } = await api.post(`/admin/tickets/${ticketId}/reply`, formData);
    return data;
  },
  async resolveTicket(ticketId: EntityId, resolutionSummary: string) {
    const { data } = await api.post(`/admin/tickets/${ticketId}/resolve`, {
      resolution_summary: resolutionSummary,
    });
    return data;
  },
  async staff() {
    const { data } = await api.get<AdminStaffRow[] | ApiListPayload<AdminStaffRow>>("/admin/staff");
    return normalizeStaffListResponse(data);
  },
  async staffDetail(staffId: EntityId) {
    const { data } = await api.get<Record<string, unknown>>(`/admin/staff/${staffId}`);
    return data;
  },
  async createStaff(payload: Record<string, unknown>) {
    const { data } = await api.post("/admin/staff", payload);
    return data;
  },
  async updateStaff(staffId: EntityId, payload: Record<string, unknown>) {
    const { data } = await api.put(`/admin/staff/${staffId}`, payload);
    return data;
  },
  async logs(page = 1, pageSize = 40, level = "all") {
    const { data } = await api.get<ApiListPayload<Record<string, unknown>> & { logs?: Record<string, unknown>[] }>("/admin/logs", {
      params: { page, page_size: pageSize, level },
    });
    return normalizeLogsResponse(data);
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
