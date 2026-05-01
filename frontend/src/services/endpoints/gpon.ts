import { api } from "@/services/api-client";
import type { ApiListPayload, EntityId, GponOlt, GponOltListPayload, GponOnt, GponOntActionResult } from "@/types/domain";

export interface GponOntListParams {
  page?: number;
  page_size?: number;
  olt_id?: EntityId;
  status?: string;
  vlan_id?: number;
  pon_port?: number;
  rx_power_min?: number;
  rx_power_max?: number;
  search?: string;
}

export const gponService = {
  async olts() {
    const { data } = await api.get<GponOltListPayload>("/gpon/olts");
    return data;
  },
  async olt(oltId: EntityId) {
    const { data } = await api.get<GponOlt>(`/gpon/olts/${oltId}`);
    return data;
  },
  async onts(params: GponOntListParams) {
    const { data } = await api.get<ApiListPayload<GponOnt>>("/gpon/onts", { params });
    return data;
  },
  async ont(ontId: EntityId) {
    const { data } = await api.get<GponOnt>(`/gpon/onts/${ontId}`);
    return data;
  },
  async subscriberOnt(subscriberId: EntityId) {
    const { data } = await api.get<GponOnt>(`/gpon/subscribers/${subscriberId}/ont`);
    return data;
  },
  async reboot(ontId: EntityId) {
    const { data } = await api.post<GponOntActionResult>(`/gpon/onts/${ontId}/reboot`);
    return data;
  },
  async block(ontId: EntityId) {
    const { data } = await api.post<GponOntActionResult>(`/gpon/onts/${ontId}/block`);
    return data;
  },
  async unblock(ontId: EntityId) {
    const { data } = await api.post<GponOntActionResult>(`/gpon/onts/${ontId}/unblock`);
    return data;
  },
  async markRogueSuspected(ontId: EntityId) {
    const { data } = await api.post<GponOntActionResult>(`/gpon/onts/${ontId}/mark-rogue-suspected`);
    return data;
  },
  async refreshStatus(ontId: EntityId) {
    const { data } = await api.post<GponOntActionResult>(`/gpon/onts/${ontId}/refresh-status`);
    return data;
  },
};
