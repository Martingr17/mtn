import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LifeBuoy, Lock, MessageSquareText, SendHorizontal } from "lucide-react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { ticketsService } from "@/services/endpoints/tickets";
import type { TicketDetail } from "@/types/domain";
import { formatRelative } from "@/utils/format";

function getTicketTone(status?: string) {
  if (status === "closed" || status === "resolved") {
    return "success";
  }

  if (status === "pending") {
    return "warning";
  }

  if (status === "open") {
    return "info";
  }

  return "neutral";
}

function getTicketStatusLabel(status?: string) {
  if (status === "resolved") {
    return "Решена";
  }

  if (status === "closed") {
    return "Закрыта";
  }

  if (status === "pending") {
    return "Ожидает ответа";
  }

  if (status === "in_progress") {
    return "В работе";
  }

  if (status === "open") {
    return "Открыта";
  }

  return "Без статуса";
}

function getTicketPriorityTone(priority?: string) {
  if (priority === "critical" || priority === "urgent" || priority === "high") {
    return "danger";
  }

  if (priority === "medium" || priority === "normal") {
    return "warning";
  }

  if (priority === "low") {
    return "success";
  }

  return "neutral";
}

function getTicketPriorityLabel(priority?: string) {
  if (priority === "critical" || priority === "urgent") {
    return "Срочно";
  }

  if (priority === "high") {
    return "Высокий приоритет";
  }

  if (priority === "medium" || priority === "normal") {
    return "Стандартный приоритет";
  }

  if (priority === "low") {
    return "Низкий приоритет";
  }

  return "Приоритет не указан";
}

function getMessageAuthorLabel(author?: string | null, index?: number) {
  const normalized = author?.trim();

  if (normalized === "Р’С‹") {
    return "Вы";
  }

  if (normalized) {
    return normalized;
  }

  return index === 0 ? "MTN" : "Участник";
}

function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.ticketId?.trim() ?? "";
  const [message, setMessage] = useState("");
  const messageTrimmed = message.trim();
  const ticketDetailKey = ["ticket-detail", ticketId] as const;
  const replyFeedback = useButtonFeedback();
  const closeFeedback = useButtonFeedback();

  const ticketQuery = useQuery({
    queryKey: ticketDetailKey,
    queryFn: () => ticketsService.detail(ticketId),
    enabled: Boolean(ticketId),
  });

  const replyMutation = useMutation({
    mutationFn: (replyBody: string) => ticketsService.reply(ticketId, replyBody),
    onMutate: async (replyBody: string) => {
      const draftMessage = replyBody.trim();
      if (!draftMessage) {
        return undefined;
      }

      await queryClient.cancelQueries({ queryKey: ticketDetailKey });
      const previous = queryClient.getQueryData<TicketDetail>(ticketDetailKey);

      queryClient.setQueryData<TicketDetail | undefined>(ticketDetailKey, (current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: `draft-${Date.now()}`,
                  user_id: current.user_id,
                  body: draftMessage,
                  is_internal: false,
                  created_at: new Date().toISOString(),
                  user_display_name: "Вы",
                },
              ],
            }
          : current,
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(ticketDetailKey, context.previous);
      }

      replyFeedback.flashFeedback("error");
      toast.error("Не удалось отправить сообщение. Попробуйте ещё раз.");
    },
    onSuccess: () => {
      setMessage("");
      replyFeedback.flashFeedback("success");
      toast.success("Сообщение отправлено.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ticketDetailKey });
      queryClient.invalidateQueries({ queryKey: ["support-page", "tickets"] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => ticketsService.close(ticketId),
    onSuccess: () => {
      closeFeedback.flashFeedback("success");
      toast.success("Заявка закрыта.");
      queryClient.invalidateQueries({ queryKey: ticketDetailKey });
      queryClient.invalidateQueries({ queryKey: ["support-page", "tickets"] });
    },
    onError: () => {
      closeFeedback.flashFeedback("error");
      toast.error("Не удалось закрыть заявку.");
    },
  });

  if (!ticketId) {
    return (
      <EmptyState
        icon={<LifeBuoy size={20} />}
        title="Тикет не найден"
        description="Проверьте ссылку или вернитесь в список обращений, чтобы открыть нужный диалог."
      />
    );
  }

  if (ticketQuery.isPending) {
    return <Skeleton className="skeleton-card" />;
  }

  if (!ticketQuery.data) {
    return (
      <EmptyState
        icon={<LifeBuoy size={20} />}
        title="Не удалось загрузить диалог"
        description="Детали обращения временно недоступны. Обновите страницу или вернитесь позже."
      />
    );
  }

  const ticket = ticketQuery.data;
  const isClosed = ticket.status === "closed";
  const isMessageInvalid = message.length > 0 && !messageTrimmed;

  return (
    <div className="stack-lg ticket-detail-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Поддержка / Заявка"
            title={ticket.subject || "Обращение в поддержку MTN"}
            description="Вся переписка, текущий статус и быстрые действия собраны в одном окне."
            actions={
              <div className="inline-actions">
                <StatusBadge tone={getTicketTone(ticket.status)}>
                  {getTicketStatusLabel(ticket.status)}
                </StatusBadge>
                <StatusBadge tone={getTicketPriorityTone(ticket.priority)}>
                  {getTicketPriorityLabel(ticket.priority)}
                </StatusBadge>
                <Button
                  variant="secondary"
                  isLoading={closeMutation.isPending}
                  loadingLabel="Закрываем..."
                  feedbackState={closeFeedback.feedbackState}
                  onClick={() => closeMutation.mutate()}
                  disabled={isClosed}
                >
                  <Lock size={16} />
                  {isClosed ? "Уже закрыта" : "Закрыть заявку"}
                </Button>
              </div>
            }
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          <div className="toolbar-row">
            <div className="inline-actions">
              <MessageSquareText size={18} />
              <strong>История переписки</strong>
            </div>
            <span className="muted">{ticket.messages.length} сообщений</span>
          </div>

          {ticket.messages.length ? (
            ticket.messages.map((entry, index) => {
              const authorLabel = getMessageAuthorLabel(entry.user_display_name, index);
              const isOwnMessage = authorLabel === "Вы";

              return (
                <div
                  key={entry.id}
                  className={`list-item ticket-message ${isOwnMessage ? "is-own" : "is-agent"}`}
                >
                  <div>
                    <strong>{authorLabel}</strong>
                    <p>{entry.body}</p>
                  </div>
                  <span className="muted">{formatRelative(entry.created_at)}</span>
                </div>
              );
            })
          ) : (
            <EmptyState
              icon={<MessageSquareText size={20} />}
              title="Переписка пока пуста"
              description="Как только вы или оператор отправите первое сообщение, история диалога появится здесь."
            />
          )}
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="stack-md">
          <div className="field">
            <label htmlFor="ticket-reply">Ответ в поддержку</label>
            <textarea
              id="ticket-reply"
              value={message}
              aria-invalid={isMessageInvalid}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Опишите уточнение, добавьте детали или продолжите диалог с поддержкой."
            />
          </div>

          <Button
            onClick={() => replyMutation.mutate(messageTrimmed)}
            disabled={!messageTrimmed || isClosed}
            isLoading={replyMutation.isPending}
            loadingLabel="Отправляем..."
            feedbackState={replyFeedback.feedbackState}
          >
            <SendHorizontal size={16} />
            Отправить сообщение
          </Button>
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default TicketDetailPage;
