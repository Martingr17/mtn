import { api } from "@/services/api-client";
import type {
  ApiListPayload,
  DashboardStats,
  EntityId,
  MonitoringAlert,
  MonitoringMetrics,
  MonitoringSubscription,
  MonitoringSummary,
  PaymentStats,
  SpeedtestResult,
  SpeedtestSession,
  SpeedtestStats,
  TicketStats,
  TrafficStats,
} from "@/types/domain";

export const statisticsService = {
  async traffic() {
    const { data } = await api.get<TrafficStats>("/statistics/traffic");
    return data;
  },
  async payments() {
    const { data } = await api.get<PaymentStats>("/statistics/payments");
    return data;
  },
  async tickets() {
    const { data } = await api.get<TicketStats>("/statistics/tickets");
    return data;
  },
  async dashboard() {
    const { data } = await api.get<DashboardStats>("/statistics/admin/dashboard");
    return data;
  },
};

export const speedtestService = {
  async createSession() {
    const { data } = await api.post<SpeedtestSession>("/speedtest/session");
    return data;
  },
  async run(payload: { session_id: string; download_mbps: number; upload_mbps: number; ping_ms: number }) {
    const { data } = await api.post<SpeedtestResult>("/speedtest/run", payload);
    return data;
  },
  async history() {
    const { data } = await api.get<SpeedtestResult[]>("/speedtest/history");
    return data;
  },
  async stats() {
    const { data } = await api.get<SpeedtestStats>("/speedtest/stats");
    return data;
  },
};

export const monitoringService = {
  async metrics(params?: Record<string, unknown>) {
    const { data } = await api.get<MonitoringMetrics>("/monitoring/metrics", { params });
    return data;
  },
  async alerts(page = 1, pageSize = 20, filters?: Record<string, unknown>) {
    const { data } = await api.get<ApiListPayload<MonitoringAlert>>("/monitoring/alerts", {
      params: {
        page,
        page_size: pageSize,
        ...filters,
      },
    });
    return data;
  },
  async markAlertRead(alertId: EntityId) {
    const { data } = await api.post<MonitoringAlert>(`/monitoring/alerts/${alertId}/read`);
    return data;
  },
  async summary() {
    const { data } = await api.get<MonitoringSummary>("/monitoring/summary");
    return data;
  },
  async subscription() {
    const { data } = await api.get<MonitoringSubscription>("/monitoring/subscribe");
    return data;
  },
  async updateSubscription(payload: MonitoringSubscription) {
    const { data } = await api.post<MonitoringSubscription>("/monitoring/subscribe", payload);
    return data;
  },
};
