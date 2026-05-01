import { api } from "@/services/api-client";
import type {
  ApiListPayload,
  ZabbixAlarm,
  ZabbixAlarmActionResult,
  ZabbixRefreshResult,
  ZabbixSummary,
} from "@/types/domain";

export interface ZabbixAlarmListParams {
  page?: number;
  page_size?: number;
  severity?: string;
  status?: string;
  alarm_type?: string;
  source_type?: string;
  source_id?: number;
  search?: string;
}

export const zabbixService = {
  async alarms(params: ZabbixAlarmListParams = {}) {
    const { data } = await api.get<ApiListPayload<ZabbixAlarm>>("/zabbix/alarms", { params });
    return data;
  },
  async alarm(alarmId: string | number) {
    const { data } = await api.get<ZabbixAlarm>(`/zabbix/alarms/${alarmId}`);
    return data;
  },
  async summary() {
    const { data } = await api.get<ZabbixSummary>("/zabbix/summary");
    return data;
  },
  async acknowledge(alarmId: string | number) {
    const { data } = await api.post<ZabbixAlarmActionResult>(`/zabbix/alarms/${alarmId}/ack`);
    return data;
  },
  async resolve(alarmId: string | number) {
    const { data } = await api.post<ZabbixAlarmActionResult>(`/zabbix/alarms/${alarmId}/resolve`);
    return data;
  },
  async refresh() {
    const { data } = await api.post<ZabbixRefreshResult>("/zabbix/refresh");
    return data;
  },
};
