import { api } from "@/services/api-client";
import type { ApiListPayload, AuditLogItem, EntityId } from "@/types/domain";

export interface AuditListParams {
  page?: number;
  page_size?: number;
  entity_type?: string;
  action?: string;
  actor?: string;
  actor_id?: EntityId;
  date_from?: string;
  date_to?: string;
}

export const auditService = {
  async list(params: AuditListParams = {}) {
    const { data } = await api.get<ApiListPayload<AuditLogItem>>("/audit", { params });
    return data;
  },
};
