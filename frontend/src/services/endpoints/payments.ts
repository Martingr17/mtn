import { api } from "@/services/api-client";
import type { EntityId, Payment, PaymentMethod } from "@/types/domain";

type PaymentId = EntityId;

function extractFilename(contentDisposition?: string) {
  if (!contentDisposition) {
    return "payment_statement.pdf";
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  return "payment_statement.pdf";
}

export const paymentsService = {
  async create(amount: number, paymentMethod: string) {
    const { data } = await api.post("/payments/create", {
      amount,
      payment_method: paymentMethod,
    });
    return data as {
      payment_id: PaymentId;
      payment_url?: string;
      redirect_url?: string;
      provider?: string;
      status?: string;
    };
  },
  async history(limit = 20, offset = 0, statusFilter?: string) {
    const { data } = await api.get<Payment[]>("/payments/history", {
      params: {
        limit,
        offset,
        status_filter: statusFilter || undefined,
      },
    });
    return data;
  },
  async methods() {
    const { data } = await api.get<PaymentMethod[]>("/payments/methods");
    return data;
  },
  async statementPdf(params?: { year?: number; month?: number }) {
    const response = await api.get<Blob>("/payments/statement/pdf", {
      params,
      responseType: "blob",
    });

    return {
      blob: response.data,
      filename: extractFilename(response.headers["content-disposition"]),
    };
  },
  async addMethod(payload: Record<string, unknown>) {
    const { data } = await api.post<PaymentMethod>("/payments/methods", payload);
    return data;
  },
  async deleteMethod(methodId: EntityId) {
    const { data } = await api.delete(`/payments/methods/${methodId}`);
    return data;
  },
  async payment(paymentId: PaymentId) {
    const { data } = await api.get<Payment>(`/payments/${paymentId}`);
    return data;
  },
  async retry(paymentId: PaymentId) {
    const { data } = await api.post(`/payments/${paymentId}/retry`);
    return data;
  },
  async refresh(paymentId: PaymentId) {
    const { data } = await api.post<Payment>(`/payments/${paymentId}/refresh`);
    return data;
  },
  async confirmDemo(paymentId: PaymentId) {
    const { data } = await api.post(`/payments/${paymentId}/confirm-demo`);
    return data;
  },
};
