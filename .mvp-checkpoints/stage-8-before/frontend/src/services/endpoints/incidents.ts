import { api } from "@/services/api-client";
import type { ApiListPayload, IncidentActionResult, IncidentCreatePayload, NocIncident } from "@/types/domain";

export interface IncidentListParams {
  page?: number;
  page_size?: number;
  status?: string;
  severity?: string;
  affected_service?: string;
  source?: string;
  search?: string;
}

export const incidentsService = {
  async list(params: IncidentListParams = {}) {
    const { data } = await api.get<ApiListPayload<NocIncident>>("/incidents", { params });
    return data;
  },
  async detail(incidentId: string | number) {
    const { data } = await api.get<NocIncident>(`/incidents/${incidentId}`);
    return data;
  },
  async create(payload: IncidentCreatePayload) {
    const { data } = await api.post<IncidentActionResult>("/incidents", payload);
    return data;
  },
  async createFromAlarm(alarmId: string | number) {
    const { data } = await api.post<IncidentActionResult>(`/incidents/from-alarm/${alarmId}`);
    return data;
  },
  async acknowledge(incidentId: string | number) {
    const { data } = await api.post<IncidentActionResult>(`/incidents/${incidentId}/ack`);
    return data;
  },
  async start(incidentId: string | number) {
    const { data } = await api.post<IncidentActionResult>(`/incidents/${incidentId}/start`);
    return data;
  },
  async resolve(incidentId: string | number) {
    const { data } = await api.post<IncidentActionResult>(`/incidents/${incidentId}/resolve`);
    return data;
  },
  async close(incidentId: string | number) {
    const { data } = await api.post<IncidentActionResult>(`/incidents/${incidentId}/close`);
    return data;
  },
  async assign(incidentId: string | number, userId: number) {
    const { data } = await api.post<IncidentActionResult>(`/incidents/${incidentId}/assign`, { user_id: userId });
    return data;
  },
};
