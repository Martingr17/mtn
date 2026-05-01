import { api } from "@/services/api-client";
import type { EntityId, Tariff } from "@/types/domain";

export const tariffsService = {
  async list() {
    const { data } = await api.get<Tariff[]>("/tariffs");
    return data;
  },
  async compare() {
    const { data } = await api.get<Tariff[]>("/tariffs/compare");
    return data;
  },
  async history() {
    const { data } = await api.get<Array<Record<string, unknown>>>("/tariffs/history");
    return data;
  },
  async changeTariff(tariffId: EntityId, effectiveFrom: "today" | "next_month") {
    const { data } = await api.post("/tariffs/change", {
      tariff_id: tariffId,
      effective_from: effectiveFrom,
    });
    return data;
  },
  async adminList() {
    const { data } = await api.get<Tariff[]>("/tariffs/admin/list");
    return data;
  },
  async create(payload: Partial<Tariff>) {
    const { data } = await api.post<Tariff>("/tariffs/admin", payload);
    return data;
  },
  async update(tariffId: EntityId, payload: Partial<Tariff>) {
    const { data } = await api.put<Tariff>(`/tariffs/admin/${tariffId}`, payload);
    return data;
  },
  async remove(tariffId: EntityId) {
    const { data } = await api.delete(`/tariffs/admin/${tariffId}`);
    return data;
  },
};
