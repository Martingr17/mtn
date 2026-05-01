import { api } from "@/services/api-client";
import type {
  ApiListPayload,
  SubscriberBalance,
  SubscriberDetail,
  SubscriberPayment,
  SubscriberSummary,
  SubscriberTicket,
} from "@/types/domain";

export interface SubscriberListParams {
  page?: number;
  page_size?: number;
  contract?: string;
  search?: string;
  address?: string;
  status?: string;
}

export const subscribersService = {
  async list(params: SubscriberListParams) {
    const { data } = await api.get<ApiListPayload<SubscriberSummary>>("/subscribers", { params });
    return data;
  },
  async detail(subscriberId: string | number) {
    const { data } = await api.get<SubscriberDetail>(`/subscribers/${subscriberId}`);
    return data;
  },
  async balance(subscriberId: string | number) {
    const { data } = await api.get<SubscriberBalance>(`/subscribers/${subscriberId}/balance`);
    return data;
  },
  async payments(subscriberId: string | number, limit = 20, offset = 0, status = "all") {
    const { data } = await api.get<ApiListPayload<SubscriberPayment>>(`/subscribers/${subscriberId}/payments`, {
      params: { limit, offset, status },
    });
    return data;
  },
  async tickets(subscriberId: string | number, page = 1, pageSize = 20, status = "all") {
    const { data } = await api.get<ApiListPayload<SubscriberTicket>>(`/subscribers/${subscriberId}/tickets`, {
      params: { page, page_size: pageSize, status },
    });
    return data;
  },
};
