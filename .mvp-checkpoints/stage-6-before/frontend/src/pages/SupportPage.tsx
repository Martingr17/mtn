import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LifeBuoy, MessageSquareText } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { ticketsService } from "@/services/endpoints/tickets";
import type { ApiListPayload, Ticket } from "@/types/domain";
import { formatDate } from "@/utils/format";

const supportTicketsKey = ["support-page", "tickets"] as const;

const PRIORITY_LABELS: Record<string, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  urgent: "Срочный",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  waiting_customer: "Ждёт ответа",
  resolved: "Решена",
  closed: "Закрыта",
  escalated: "Эскалация",
};

function SupportPage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("medium");
  const submitButton = useButtonFeedback();

  const ticketsQuery = useQuery({
    queryKey: supportTicketsKey,
    queryFn: () => ticketsService.list(1, 20),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      ticketsService.create({ subject: subject.trim(), body: body.trim(), priority }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: supportTicketsKey });
      const previous = queryClient.getQueryData<ApiListPayload<Ticket>>(supportTicketsKey);
      const draftId = `draft-${Date.now()}`;
      queryClient.setQueryData<ApiListPayload<Ticket>>(supportTicketsKey, (current) => {
        const draft: Ticket = {
          id: draftId,
          subject: subject.trim(),
          status: "new",
          priority,
          created_at: new Date().toISOString(),
          user_id: "0",
        };

        if (!current) {
          return { items: [draft], total: 1, page: 1, page_size: 20, total_pages: 1 };
        }

        return { ...current, items: [draft, ...current.items], total: current.total + 1 };
      });
      return { previous, draftId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(supportTicketsKey, context.previous);
      }

      submitButton.flashFeedback("error");
      toast.error("Заявка не создана.");
    },
    onSuccess: (ticket, _variables, context) => {
      if (context?.draftId) {
        queryClient.setQueryData<ApiListPayload<Ticket>>(supportTicketsKey, (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === context.draftId ? ticket : item)),
              }
            : current,
        );
      }

      setSubject("");
      setBody("");
      submitButton.flashFeedback("success");
      toast.success("Заявка отправлена. Оператор увидит её сразу.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: supportTicketsKey });
    },
  });

  const canCreateTicket = subject.trim().length > 0 && body.trim().length > 0;
  const tickets = ticketsQuery.data?.items ?? [];

  return (
    <div className="support-layout support-page">
      <AnimatedReveal delay={0}>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Поддержка"
            title="Поддержка и обращения"
            description="Создавайте заявки, отслеживайте статусы и переходите в чат по каждому обращению в одном разделе."
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <AnimatedReveal className="span-5" delay={80}>
          <Card className="stack-md">
            <div className="inline-actions">
              <MessageSquareText size={18} />
              <strong>Новая заявка</strong>
            </div>
            <div className="field">
              <label>Тема</label>
              <input
                id="support-subject"
                aria-invalid={!subject.trim() && subject.length > 0}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Например, низкая скорость вечером"
              />
            </div>
            <div className="field">
              <label>Приоритет</label>
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </div>
            <div className="field">
              <label>Описание</label>
              <textarea
                aria-invalid={!body.trim() && body.length > 0}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canCreateTicket}
              isLoading={createMutation.isPending}
              loadingLabel="Отправляем..."
              feedbackState={submitButton.feedbackState}
            >
              Создать заявку
            </Button>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-7" delay={150}>
          <Card className="stack-md">
            <div className="inline-actions">
              <LifeBuoy size={18} />
              <strong>Мои обращения</strong>
            </div>

            {ticketsQuery.isPending ? (
              <div className="data-list">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="skeleton-card" />
                ))}
              </div>
            ) : tickets.length ? (
              tickets.map((ticket) => (
                <div key={ticket.id} className="list-item">
                  <div>
                    <strong>{ticket.subject}</strong>
                    <p className="muted">
                      {PRIORITY_LABELS[ticket.priority] ?? ticket.priority} · {formatDate(ticket.created_at, "d MMM yyyy")}
                    </p>
                  </div>
                  <div>
                    <p>{STATUS_LABELS[ticket.status] ?? ticket.status}</p>
                    <Link className="link-line" to={`/support/${ticket.id}`}>
                      Открыть чат
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                action={
                  <Button onClick={() => document.querySelector<HTMLInputElement>("#support-subject")?.focus()}>
                    Создать первое обращение
                  </Button>
                }
                title="У вас пока нет открытых заявок"
                description="Первое обращение появится здесь сразу после отправки."
              />
            )}
          </Card>
        </AnimatedReveal>
      </div>
    </div>
  );
}

export default SupportPage;
