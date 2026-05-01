import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountMetric } from "@/components/ui/CountMetric";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { adminService } from "@/services/endpoints/admin";
import { getSafeDisplayName } from "@/utils/display-name";
import { formatCurrency, formatDate, formatNumber } from "@/utils/format";

function formatPaymentLogMessage(item: Record<string, unknown>) {
  const raw = String(item.message ?? item.action ?? "").trim();
  const normalized = raw.toLowerCase();

  if (!raw) {
    return "Платёжное событие";
  }

  if (normalized.includes("manual")) {
    return "Ручное начисление";
  }

  if (normalized.includes("invoice")) {
    return "Обновление по счёту";
  }

  if (normalized.includes("bill")) {
    return "Изменение по биллингу";
  }

  if (normalized.includes("payment")) {
    return "Платёжное событие";
  }

  return raw;
}

function formatPaymentLogActor(item: Record<string, unknown>) {
  const raw = String(item.user_phone ?? item.actor ?? "").trim();

  if (!raw || raw.toLowerCase() === "system") {
    return "Система";
  }

  return raw;
}

function getDisplayName(name: string | null | undefined, phone: string, email?: string | null) {
  return getSafeDisplayName(name, phone, email);
}

function AdminPaymentsPage() {
  const statsQuery = useQuery({
    queryKey: ["admin-payments", "stats"],
    queryFn: adminService.stats,
  });
  const usersQuery = useQuery({
    queryKey: ["admin-payments", "users"],
    queryFn: () => adminService.listUsers({ page: 1, page_size: 50 }),
  });
  const logsQuery = useQuery({
    queryKey: ["admin-payments", "logs"],
    queryFn: () => adminService.logs(1, 20, "all"),
  });

  const [selectedUserId, setSelectedUserId] = useState("");
  const [amount, setAmount] = useState(500);
  const [comment, setComment] = useState("Компенсация / ручное пополнение");
  const paymentFeedback = useButtonFeedback();

  const effectiveSelectedUserId = selectedUserId || String(usersQuery.data?.items?.[0]?.id ?? "");
  const amountInvalid = amount <= 0;

  const manualPaymentMutation = useMutation({
    mutationFn: () => adminService.manualPayment(effectiveSelectedUserId, amount, comment.trim()),
    onSuccess: () => {
      paymentFeedback.flashFeedback("success");
      toast.success("Ручное начисление создано.");
      queryClient.invalidateQueries({ queryKey: ["admin-payments", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payments", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payments", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });

      if (effectiveSelectedUserId) {
        queryClient.invalidateQueries({
          queryKey: ["admin-user-detail", Number(effectiveSelectedUserId)],
        });
      }
    },
    onError: () => {
      paymentFeedback.flashFeedback("error");
      toast.error("Не удалось провести ручное начисление.");
    },
  });

  const stats = statsQuery.data;
  const paymentLogItems = (logsQuery.data?.items ?? []).filter((item) => {
    const joined = JSON.stringify(item).toLowerCase();
    return joined.includes("payment") || joined.includes("invoice") || joined.includes("bill");
  });

  return (
    <div className="stack-lg admin-payments-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель / Платежи"
            title="Платежи и ручные операции"
            description="Выручка, платёжная динамика и ручные операции собраны в одном рабочем экране."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          <Card className="metric-card">
            <div className="inline-actions">
              <Wallet size={18} />
              <span className="metric-label">Выручка за месяц</span>
            </div>
            <div className="metric-value">
              <CountMetric value={stats?.revenue_month ?? 0} mode="currency" />
            </div>
            <p className="muted">Сегодня: {formatCurrency(stats?.revenue_today ?? 0)}</p>
          </Card>

          <Card className="metric-card">
            <div className="inline-actions">
              <CreditCard size={18} />
              <span className="metric-label">Платёжная активность</span>
            </div>
            <div className="metric-value">
              <CountMetric value={stats?.payments_last_7_days?.reduce((sum, item) => sum + item.count, 0) ?? 0} />
            </div>
            <p className="muted">Операций за последние 7 дней</p>
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <div className="cards-grid">
          <Card className="span-5 stack-md">
            <strong>Ручное пополнение</strong>

            <div className="field">
              <label htmlFor="manual-user">Абонент</label>
              <select
                id="manual-user"
                value={effectiveSelectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                {(usersQuery.data?.items ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.phone} · {user.phone}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="manual-amount">Сумма</label>
              <input
                id="manual-amount"
                type="number"
                min={1}
                aria-invalid={amountInvalid}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value) || 0)}
              />
            </div>

            <div className="field">
              <label htmlFor="manual-comment">Комментарий</label>
              <input
                id="manual-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Например: компенсация за инцидент"
              />
            </div>

            <Button
              onClick={() => manualPaymentMutation.mutate()}
              disabled={!effectiveSelectedUserId || amountInvalid || !comment.trim()}
              isLoading={manualPaymentMutation.isPending}
              loadingLabel="Проводим..."
              feedbackState={paymentFeedback.feedbackState}
            >
              Начислить
            </Button>
          </Card>

          <Card className="span-7 stack-md">
            <div className="toolbar-row">
              <strong>Дневная динамика</strong>
              <span className="muted">Последние 7 дней</span>
            </div>

            {(stats?.payments_last_7_days ?? []).map((item) => (
              <div key={item.date} className="list-item">
                <div>
                  <strong>{formatDate(item.date, "d MMM")}</strong>
                  <p className="muted">{formatNumber(item.count)} операций</p>
                </div>
                <strong>{formatCurrency(item.amount)}</strong>
              </div>
            ))}
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.15}>
        <div className="cards-grid">
          <Card className="span-6 stack-md">
            <strong>Абоненты с риском долга</strong>
            {(usersQuery.data?.items ?? [])
              .filter((user) => user.has_debt || (user.balance ?? 0) < 0)
              .slice(0, 8)
              .map((user) => (
                <div key={user.id} className="list-item">
                  <div>
                    <strong>{getDisplayName(user.full_name, user.phone)}</strong>
                    <p className="muted">{user.phone}</p>
                  </div>
                  <strong>{formatCurrency(user.balance ?? 0)}</strong>
                </div>
              ))}
          </Card>

          <Card className="span-6 stack-md">
            <strong>Платёжные события в журнале</strong>
            {paymentLogItems.length ? (
              paymentLogItems.map((item, index) => (
                <div key={index} className="list-item">
                  <div>
                    <strong>{formatPaymentLogMessage(item as Record<string, unknown>)}</strong>
                    <p className="muted">{formatPaymentLogActor(item as Record<string, unknown>)}</p>
                  </div>
                  <span className="muted">
                    {formatDate(String(item.created_at ?? item.timestamp ?? new Date().toISOString()))}
                  </span>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<CreditCard size={20} />}
                title="Журнал пока пуст"
                description="Как только появятся новые платёжные события, они отобразятся в этой ленте."
              />
            )}
          </Card>
        </div>
      </AnimatedReveal>
    </div>
  );
}

export default AdminPaymentsPage;
