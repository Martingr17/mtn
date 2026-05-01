import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Flame, Zap } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { tariffsService } from "@/services/endpoints/tariffs";
import { usersService } from "@/services/endpoints/users";
import type { UserProfile } from "@/types/domain";
import { formatCurrency } from "@/utils/format";

const tariffsProfileKey = ["tariffs-page", "me"] as const;
const tariffsListKey = ["tariffs-page", "list"] as const;

function TariffsPage() {
  const tariffsQuery = useQuery({ queryKey: tariffsListKey, queryFn: tariffsService.list });
  const profileQuery = useQuery({ queryKey: tariffsProfileKey, queryFn: usersService.me });

  const changeMutation = useMutation({
    mutationFn: (payload: { tariffId: number; effectiveFrom: "today" | "next_month" }) =>
      tariffsService.changeTariff(payload.tariffId, payload.effectiveFrom),
    onMutate: async ({ tariffId }) => {
      await queryClient.cancelQueries({ queryKey: tariffsProfileKey });
      const previousProfile = queryClient.getQueryData<UserProfile>(tariffsProfileKey);
      const selectedTariff = tariffsQuery.data?.find((tariff) => tariff.id === tariffId);
      queryClient.setQueryData<UserProfile | undefined>(tariffsProfileKey, (current) =>
        current ? { ...current, current_tariff: selectedTariff } : current,
      );
      return { previousProfile };
    },
    onError: (_error, _payload, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(tariffsProfileKey, context.previousProfile);
      }
      toast.error("Не удалось отправить заявку на смену тарифа.");
    },
    onSuccess: () => {
      toast.success("Заявка на смену тарифа отправлена.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tariffsProfileKey });
      queryClient.invalidateQueries({ queryKey: tariffsListKey });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] });
      queryClient.invalidateQueries({ queryKey: ["profile-page", "me"] });
    },
  });

  if (tariffsQuery.isPending) {
    return <Skeleton className="skeleton-card" />;
  }

  const currentTariffId = (profileQuery.data?.current_tariff as { id?: number } | undefined)?.id;
  const hasDebt = (profileQuery.data?.balance ?? 0) < 0;

  const handleChangeTariff = (tariffId: number, effectiveFrom: "today" | "next_month") => {
    if (effectiveFrom === "today") {
      if (hasDebt) {
        toast.error("Нельзя активировать тариф сегодня при отрицательном балансе.");
        return;
      }

      if (!window.confirm("Активировать новый тариф уже сегодня?")) {
        return;
      }
    }

    changeMutation.mutate({ tariffId, effectiveFrom });
  };

  return (
    <div className="stack-lg tariffs-page">
      <Card className="hero-card">
        <SectionHeading
          eyebrow="Тарифы"
          title="Тарифы MTN"
          description="Сравните скорость, стоимость и сценарии использования. Смена тарифа занимает пару действий и не превращается в длинную анкету."
        />
      </Card>

      <div className="cards-grid">
        {tariffsQuery.data?.map((tariff) => (
          <Card key={tariff.id} className="span-4 stack-md">
            <div className="toolbar-row">
              <div>
                <strong>{tariff.name}</strong>
                <p className="muted">{tariff.description || "Сбалансированный тариф MTN для повседневной работы и дома"}</p>
              </div>
              {tariff.is_popular ? <Flame size={18} /> : <Zap size={18} />}
            </div>

            <div className="metric-value">{formatCurrency(tariff.price)}</div>
            <p className="muted">
              До {tariff.speed_mbps} Мбит/с
              {tariff.upload_speed_mbps ? ` / исходящая скорость ${tariff.upload_speed_mbps} Мбит/с` : ""}
            </p>

            <div className="stack-sm">
              {(tariff.features ?? []).slice(0, 4).map((feature, index) => (
                <div className="inline-actions" key={index}>
                  <CheckCircle2 size={16} />
                  <span>{typeof feature === "string" ? feature : JSON.stringify(feature)}</span>
                </div>
              ))}
            </div>

            <div className="inline-actions">
              <Button
                disabled={changeMutation.isPending || currentTariffId === tariff.id}
                onClick={() => handleChangeTariff(tariff.id, "next_month")}
              >
                {currentTariffId === tariff.id ? "Текущий тариф" : "Подключить"}
              </Button>
              <Button
                variant="secondary"
                disabled={changeMutation.isPending || currentTariffId === tariff.id || hasDebt}
                onClick={() => handleChangeTariff(tariff.id, "today")}
              >
                Активировать сегодня
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default TariffsPage;
