import { useMemo, useState } from "react";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { CreditCard, Download, Wallet } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { queryKeys } from "@/services/query-keys";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { VirtualizedInfiniteList } from "@/components/ui/VirtualizedInfiniteList";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { paymentsService } from "@/services/endpoints/payments";
import type { Payment } from "@/types/domain";
import { formatCurrency, formatDate, formatRelative } from "@/utils/format";

const PAGE_SIZE = 20;
const paymentHistoryKey = ["payments-page", "history"] as const;

type PaymentHistoryData = InfiniteData<Payment[], number>;

function getPaymentStatusLabel(status?: string | null) {
  if (status === "completed" || status === "succeeded" || status === "success") {
    return "Успешно";
  }

  if (status === "pending" || status === "processing") {
    return "В обработке";
  }

  if (status === "failed" || status === "error") {
    return "Ошибка";
  }

  if (status === "cancelled" || status === "canceled") {
    return "Отменён";
  }

  return "Создан";
}

function PaymentsPage() {
  const [amount, setAmount] = useState(1000);
  const [method, setMethod] = useState("bank_card");
  const paymentButton = useButtonFeedback();
  const statementButton = useButtonFeedback();

  const methodsQuery = useQuery({
    queryKey: ["payments-page", "methods"],
    queryFn: paymentsService.methods,
  });
  const historyQuery = useInfiniteQuery({
    queryKey: paymentHistoryKey,
    queryFn: ({ pageParam = 0 }) => paymentsService.history(PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    initialPageParam: 0,
  });

  const isAmountValid = Number.isFinite(amount) && amount > 0;

  const createPaymentMutation = useMutation({
    mutationFn: () => paymentsService.create(amount, method),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: paymentHistoryKey });
      const previous = queryClient.getQueryData<PaymentHistoryData>(paymentHistoryKey);
      queryClient.setQueryData<PaymentHistoryData>(paymentHistoryKey, (current) => {
        const draft: Payment = {
          id: String(Date.now()),
          user_id: "0",
          amount,
          payment_type: "top_up",
          status: "pending",
          created_at: new Date().toISOString(),
          payment_method: method,
        };

        if (!current) {
          return { pageParams: [0], pages: [[draft]] };
        }

        const firstPage = current.pages[0] ? [draft, ...current.pages[0]] : [draft];
        return { ...current, pages: [firstPage, ...current.pages.slice(1)] };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(paymentHistoryKey, context.previous);
      }

      paymentButton.flashFeedback("error");
      toast.error("Платёж не создан.");
    },
    onSuccess: async (result) => {
      try {
        if (result.provider === "demo" && result.payment_id) {
          await paymentsService.confirmDemo(result.payment_id);
          paymentButton.flashFeedback("success");
          toast.success("Баланс пополнен.");
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
            queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] }),
            queryClient.invalidateQueries({ queryKey: ["profile-page", "me"] }),
          ]);
          return;
        }

        paymentButton.flashFeedback("success");
        toast.success("Платёж создан. Открываем страницу оплаты.");

        if (result.redirect_url) {
          window.open(result.redirect_url, "_blank", "noopener,noreferrer");
        }
      } catch {
        paymentButton.flashFeedback("error");
        toast.error("Платёж создан, но завершить сценарий не удалось.");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: paymentHistoryKey });
    },
  });

  const statementMutation = useMutation({
    mutationFn: () => paymentsService.statementPdf(),
    onSuccess: ({ blob, filename }) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      statementButton.flashFeedback("success");
      toast.success("PDF-выписка загружена.");
    },
    onError: () => {
      statementButton.flashFeedback("error");
      toast.error("Не удалось сформировать PDF-выписку.");
    },
  });

  const payments = historyQuery.data?.pages.flat() ?? [];
  const canCreatePayment = isAmountValid && !createPaymentMutation.isPending;
  const savedMethods = methodsQuery.data ?? [];
  const methodOptions = useMemo(
    () => [
      { value: "bank_card", label: "Банковская карта" },
      { value: "sbp", label: "СБП" },
      ...(savedMethods.length
        ? [{ value: "saved_card", label: "Сохранённая карта" }]
        : []),
    ],
    [savedMethods.length],
  );

  const handleCreatePayment = () => {
    if (!isAmountValid) {
      paymentButton.flashFeedback("error");
      toast.error("Введите корректную сумму платежа.");
      return;
    }

    createPaymentMutation.mutate();
  };

  return (
    <div className="stack-lg payments-page">
      <AnimatedReveal delay={0}>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Платежи"
            title="Пополнение баланса и история платежей"
            description="Пополнение баланса, история платежей и быстрые действия собраны в одном экране без лишней перезагрузки интерфейса."
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <AnimatedReveal className="span-5" delay={80}>
          <Card className="stack-md">
            <div className="inline-actions payment-presets">
              <Wallet size={18} />
              <strong>Быстрое пополнение</strong>
            </div>

            <div className="field">
              <label>Сумма</label>
              <input
                type="number"
                min={1}
                aria-invalid={!isAmountValid}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value) || 0)}
              />
            </div>

            <div className="field">
              <label>Способ оплаты</label>
              <select value={method} onChange={(event) => setMethod(event.target.value)}>
                {methodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="inline-actions">
              {[300, 500, 1000, 1500, 2000].map((preset) => (
                <Button key={preset} variant="secondary" size="sm" onClick={() => setAmount(preset)}>
                  {preset}
                </Button>
              ))}
            </div>

            <Button
              onClick={handleCreatePayment}
              disabled={!canCreatePayment}
              isLoading={createPaymentMutation.isPending}
              loadingLabel="Обработка..."
              feedbackState={paymentButton.feedbackState}
            >
              Оплатить
            </Button>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-7" delay={150}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <div className="inline-actions">
                <CreditCard size={18} />
                <strong>Сохранённые методы</strong>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => statementMutation.mutate()}
                isLoading={statementMutation.isPending}
                loadingLabel="Готовим..."
                feedbackState={statementButton.feedbackState}
              >
                <Download size={14} />
                Выписка PDF
              </Button>
            </div>

            {methodsQuery.isPending ? (
              <div className="data-list">
                {Array.from({ length: 2 }).map((_, index) => (
                  <Skeleton key={index} className="skeleton-card" />
                ))}
              </div>
            ) : savedMethods.length ? (
              savedMethods.map((savedMethod) => (
                <div key={savedMethod.id} className="list-item">
                  <div>
                    <strong>{savedMethod.masked_pan || savedMethod.method_type}</strong>
                    <p className="muted">{savedMethod.card_type || savedMethod.method_type}</p>
                  </div>
                  <div>
                    <p>{savedMethod.is_default ? "По умолчанию" : "Активна"}</p>
                    <p className="muted">{formatDate(savedMethod.created_at)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Сохранённых платёжных методов пока нет.</p>
            )}
          </Card>
        </AnimatedReveal>
      </div>

      <AnimatedReveal delay={220}>
        <Card className="stack-md">
            <div className="toolbar-row">
              <strong>История платежей</strong>
            <span className="muted">Последние операции по счёту</span>
          </div>

          {historyQuery.isPending && !payments.length ? (
            <div className="data-list">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="skeleton-card" />
              ))}
            </div>
          ) : payments.length > 100 ? (
            <VirtualizedInfiniteList
              items={payments}
              hasNextPage={historyQuery.hasNextPage}
              isFetchingNextPage={historyQuery.isFetchingNextPage}
              onLoadMore={() => historyQuery.fetchNextPage()}
              renderItem={(payment) => (
                <div className="list-item">
                  <div>
                    <strong>{formatCurrency(payment.amount)}</strong>
                    <p className="muted">{payment.payment_method || payment.payment_type}</p>
                  </div>
                  <div>
                    <p>{getPaymentStatusLabel(payment.status)}</p>
                    <p className="muted">{formatRelative(payment.created_at)}</p>
                  </div>
                </div>
              )}
            />
          ) : payments.length ? (
            <div className="data-list">
              {payments.map((payment) => (
                <div key={payment.id} className="list-item">
                  <div>
                    <strong>{formatCurrency(payment.amount)}</strong>
                    <p className="muted">{payment.payment_method || payment.payment_type}</p>
                  </div>
                  <div>
                    <p>{getPaymentStatusLabel(payment.status)}</p>
                    <p className="muted">{formatRelative(payment.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              action={
                <Button onClick={() => setAmount(1000)}>
                  Пополнить баланс
                </Button>
              }
              title="История пока пуста"
              description="После первого успешного пополнения операция появится в этом списке."
            />
          )}

          {historyQuery.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => historyQuery.fetchNextPage()}
              disabled={historyQuery.isFetchingNextPage}
              isLoading={historyQuery.isFetchingNextPage}
              loadingLabel="Загружаем..."
            >
              Загрузить ещё
            </Button>
          ) : null}
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default PaymentsPage;

