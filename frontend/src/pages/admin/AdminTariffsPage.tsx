import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { RadioTower } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { tariffsService } from "@/services/endpoints/tariffs";
import type { EntityId, Tariff } from "@/types/domain";
import { formatCurrency } from "@/utils/format";

const EMPTY_FORM = {
  id: "",
  name: "",
  billing_tariff_id: "",
  speed_mbps: 100,
  upload_speed_mbps: 100,
  price: 0,
  description: "",
  is_active: true,
  is_popular: false,
  is_unlimited: true,
  traffic_limit_gb: 0,
  contract_term_months: 0,
};

function AdminTariffsPage() {
  const tariffsQuery = useQuery({
    queryKey: ["admin-tariffs", "list"],
    queryFn: tariffsService.adminList,
  });

  const [formState, setFormState] = useState({ ...EMPTY_FORM });

  const createMutation = useMutation({
    mutationFn: () => tariffsService.create(formState),
    onSuccess: () => {
      toast.success("Тариф создан.");
      setFormState({ ...EMPTY_FORM });
      queryClient.invalidateQueries({ queryKey: ["admin-tariffs", "list"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-page", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] });
    },
    onError: () => toast.error("Не удалось создать тариф."),
  });

  const updateMutation = useMutation({
    mutationFn: () => tariffsService.update(formState.id, formState),
    onSuccess: () => {
      toast.success("Тариф обновлён.");
      queryClient.invalidateQueries({ queryKey: ["admin-tariffs", "list"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-page", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] });
    },
    onError: () => toast.error("Не удалось обновить тариф."),
  });

  const removeMutation = useMutation({
    mutationFn: (tariffId: EntityId) => tariffsService.remove(tariffId),
    onSuccess: () => {
      toast.success("Тариф удалён.");
      setFormState({ ...EMPTY_FORM });
      queryClient.invalidateQueries({ queryKey: ["admin-tariffs", "list"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-page", "list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] });
    },
    onError: () => toast.error("Не удалось удалить тариф."),
  });

  const applyTariff = (tariff: Tariff) => {
    setFormState({
      id: tariff.id,
      name: tariff.name,
      billing_tariff_id: tariff.billing_tariff_id,
      speed_mbps: tariff.speed_mbps,
      upload_speed_mbps: tariff.upload_speed_mbps ?? tariff.speed_mbps,
      price: tariff.price,
      description: tariff.description ?? "",
      is_active: Boolean(tariff.is_active),
      is_popular: Boolean(tariff.is_popular),
      is_unlimited: Boolean(tariff.is_unlimited),
      traffic_limit_gb: tariff.traffic_limit_gb ?? 0,
      contract_term_months: tariff.contract_term_months ?? 0,
    });
  };

  return (
    <div className="stack-lg">
      <Card className="hero-card">
        <SectionHeading
          eyebrow="Админ-панель / Тарифы"
          title="Управление тарифной линейкой"
          description="Создавайте и редактируйте тарифы из одной админ-панели без расхождения интерфейса и бизнес-логики."
        />
      </Card>

      <div className="cards-grid">
        <Card className="span-7 stack-md">
          <div className="toolbar-row">
            <div className="inline-actions">
              <RadioTower size={18} />
              <strong>Текущие тарифы</strong>
            </div>
            <Button variant="secondary" onClick={() => setFormState({ ...EMPTY_FORM })}>
              Новый тариф
            </Button>
          </div>

          {(tariffsQuery.data ?? []).map((tariff) => (
            <div key={tariff.id} className="list-item">
              <div>
                <strong>{tariff.name}</strong>
                <p className="muted">
                  {tariff.speed_mbps} / {tariff.upload_speed_mbps ?? tariff.speed_mbps} Мбит/с
                </p>
              </div>
              <div className="inline-actions">
                <strong>{formatCurrency(tariff.price)}</strong>
                <Button size="sm" variant="secondary" onClick={() => applyTariff(tariff)}>
                  Редактировать
                </Button>
                <Button size="sm" variant="danger" onClick={() => removeMutation.mutate(tariff.id)}>
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </Card>

        <Card className="span-5 stack-md">
          <strong>{formState.id ? "Редактирование тарифа" : "Создание тарифа"}</strong>

          <div className="field">
            <label htmlFor="name">Название</label>
            <input
              id="name"
              value={formState.name}
              onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <div className="field">
            <label htmlFor="billingId">ID тарифа в биллинге</label>
            <input
              id="billingId"
              value={formState.billing_tariff_id}
              onChange={(event) =>
                setFormState((current) => ({ ...current, billing_tariff_id: event.target.value }))
              }
            />
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="speed">Скорость загрузки</label>
              <input
                id="speed"
                type="number"
                value={formState.speed_mbps}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, speed_mbps: Number(event.target.value) || 0 }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="upload">Скорость отдачи</label>
              <input
                id="upload"
                type="number"
                value={formState.upload_speed_mbps}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    upload_speed_mbps: Number(event.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="price">Цена</label>
              <input
                id="price"
                type="number"
                value={formState.price}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, price: Number(event.target.value) || 0 }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="traffic">Лимит трафика, ГБ</label>
              <input
                id="traffic"
                type="number"
                value={formState.traffic_limit_gb}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    traffic_limit_gb: Number(event.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="description">Описание</label>
            <textarea
              id="description"
              value={formState.description}
              onChange={(event) =>
                setFormState((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>

          <div className="inline-actions">
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.is_active}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, is_active: event.target.checked }))
                }
              />
              <span>Активен</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.is_popular}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, is_popular: event.target.checked }))
                }
              />
              <span>Популярный</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.is_unlimited}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, is_unlimited: event.target.checked }))
                }
              />
              <span>Безлимитный</span>
            </label>
          </div>

          <Button
            onClick={() => (formState.id ? updateMutation.mutate() : createMutation.mutate())}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {formState.id
              ? updateMutation.isPending
                ? "Сохраняем..."
                : "Сохранить тариф"
              : createMutation.isPending
                ? "Создаём..."
                : "Создать тариф"}
          </Button>
        </Card>
      </div>
    </div>
  );
}

export default AdminTariffsPage;
