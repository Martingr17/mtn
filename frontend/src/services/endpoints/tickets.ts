import { api } from "@/services/api-client";
import type { ApiListPayload, Ticket, TicketDetail, TicketMessage } from "@/types/domain";

type TicketId = string | number;

export const ticketsService = {
  async list(page = 1, pageSize = 20) {
    const { data } = await api.get<ApiListPayload<Ticket>>("/tickets/", {
      params: {
        page,
        page_size: pageSize,
      },
    });
    return data;
  },
  async detail(ticketId: TicketId) {
    const { data } = await api.get<TicketDetail>(`/tickets/${ticketId}`);
    return data;
  },
  async create(payload: {
    subject: string;
    body: string;
    category?: string;
    priority?: string;
  }) {
    const formData = new FormData();
    formData.append("subject", payload.subject);
    formData.append("body", payload.body);
    if (payload.category) {
      formData.append("category", payload.category);
    }
    if (payload.priority) {
      formData.append("priority", payload.priority);
    }

    const { data } = await api.post<Ticket>("/tickets/", formData);
    return data;
  },
  async reply(ticketId: TicketId, body: string) {
    const formData = new FormData();
    formData.append("body", body);
    const { data } = await api.post<TicketMessage>(`/tickets/${ticketId}/reply`, formData);
    return data;
  },
  async resolve(ticketId: TicketId, resolutionSummary: string) {
    const { data } = await api.post(`/tickets/${ticketId}/resolve`, {
      resolution_summary: resolutionSummary,
    });
    return data;
  },
  async close(ticketId: TicketId) {
    const { data } = await api.post(`/tickets/${ticketId}/close`);
    return data;
  },
  async rate(ticketId: TicketId, rating: number) {
    const { data } = await api.post(`/tickets/${ticketId}/rate`, { rating });
    return data;
  },
};
