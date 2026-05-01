import { api } from "@/services/api-client";
import type { ApiListPayload, EntityId, TelegramAlertActionResult, TelegramAlertLog } from "@/types/domain";

export interface TelegramAlertListParams {
  page?: number;
  page_size?: number;
  entity_type?: string;
  status?: string;
}

export const telegramAlertsService = {
  async list(params: TelegramAlertListParams = {}) {
    const { data } = await api.get<ApiListPayload<TelegramAlertLog>>("/telegram-alerts", { params });
    return data;
  },
  async sendZabbix(alarmId: EntityId) {
    const { data } = await api.post<TelegramAlertActionResult>(`/telegram-alerts/zabbix/${alarmId}/send`);
    return data;
  },
  async sendIncident(incidentId: EntityId) {
    const { data } = await api.post<TelegramAlertActionResult>(`/telegram-alerts/incidents/${incidentId}/send`);
    return data;
  },
};
