import { api } from "@/services/api-client";
import type {
  ApiListPayload,
  RadiusActionLog,
  RadiusActionResult,
  RadiusSession,
} from "@/types/domain";

export interface RadiusListParams {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
}

export interface RadiusActionListParams {
  page?: number;
  page_size?: number;
  action?: string;
  search?: string;
}

export const radiusService = {
  async sessions(params: RadiusListParams) {
    const { data } = await api.get<ApiListPayload<RadiusSession>>("/radius/sessions", { params });
    return data;
  },
  async subscriberSession(subscriberId: string | number) {
    const { data } = await api.get<RadiusSession>(`/radius/subscribers/${subscriberId}/session`);
    return data;
  },
  async block(subscriberId: string | number) {
    const { data } = await api.post<RadiusActionResult>(`/radius/subscribers/${subscriberId}/block`);
    return data;
  },
  async unblock(subscriberId: string | number) {
    const { data } = await api.post<RadiusActionResult>(`/radius/subscribers/${subscriberId}/unblock`);
    return data;
  },
  async disconnect(subscriberId: string | number) {
    const { data } = await api.post<RadiusActionResult>(`/radius/subscribers/${subscriberId}/disconnect`);
    return data;
  },
  async changeSpeed(subscriberId: string | number, speedDown: number, speedUp: number) {
    const { data } = await api.post<RadiusActionResult>(`/radius/subscribers/${subscriberId}/change-speed`, {
      speed_down: speedDown,
      speed_up: speedUp,
    });
    return data;
  },
  async actions(params: RadiusActionListParams) {
    const { data } = await api.get<ApiListPayload<RadiusActionLog>>("/radius/actions", { params });
    return data;
  },
};
