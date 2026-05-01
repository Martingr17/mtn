import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { adminService } from "@/services/endpoints/admin";
import { formatDate } from "@/utils/format";

function getTicketStatusTone(status?: string) {
  if (status === "resolved" || status === "closed") {
    return "success";
  }

  if (status === "pending" || status === "in_progress") {
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

  if (status === "pending" || status === "in_progress") {
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
    return "Высокий";
  }

  if (priority === "medium" || priority === "normal") {
    return "Стандартный";
  }

  if (priority === "low") {
    return "Низкий";
  }

  return "Не указан";
}

function getMessageAuthorLabel(message: Record<string, unknown>) {
  return String(
    message.user_display_name ?? message.author_name ?? message.author_phone ?? "Участник",
  );
}

function AdminTicketsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [resolutionText, setResolutionText] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const assignFeedback = useButtonFeedback();
  const replyFeedback = useButtonFeedback();
  const resolveFeedback = useButtonFeedback();

  const ticketsQuery = useQuery({
    queryKey: ["admin-tickets", page, status],
    queryFn: () =>
      adminService.listTickets({
        page,
        page_size: 20,
        status: status === "all" ? undefined : status,
      }),
  });
  const staffQuery = useQuery({
    queryKey: ["admin-tickets", "staff"],
    queryFn: adminService.staff,
  });
  const ticketDetailQuery = useQuery({
    queryKey: ["admin-tickets", "detail", activeTicketId],
    queryFn: () => adminService.ticket(activeTicketId ?? ""),
    enabled: Boolean(activeTicketId),
  });

  const assignMutation = useMutation({
    mutationFn: () => adminService.assignTicket(activeTicketId ?? "", assigneeId),
    onSuccess: () => {
      assignFeedback.flashFeedback("success");
      toast.success("Заявка назначена.");
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: () => {
      assignFeedback.flashFeedback("error");
      toast.error("Не удалось назначить оператора.");
    },
  });

  const replyMutation = useMutation({
    mutationFn: () => adminService.replyTicket(activeTicketId ?? "", replyText.trim()),
    onSuccess: () => {
      replyFeedback.flashFeedback("success");
      toast.success("Ответ клиенту отправлен.");
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: () => {
      replyFeedback.flashFeedback("error");
      toast.error("Не удалось отправить ответ.");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => adminService.resolveTicket(activeTicketId ?? "", resolutionText.trim()),
    onSuccess: () => {
      resolveFeedback.flashFeedback("success");
      toast.success("Заявка переведена в статус «Решена».");
      setResolutionText("");
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: () => {
      resolveFeedback.flashFeedback("error");
      toast.error("Не удалось завершить заявку.");
    },
  });

  const items = ticketsQuery.data?.items ?? [];
  const ticketDetail = useMemo(
    () => (ticketDetailQuery.data && typeof ticketDetailQuery.data === "object" ? ticketDetailQuery.data : {}),
    [ticketDetailQuery.data],
  );
  const detailMessages = Array.isArray((ticketDetail as { messages?: unknown[] }).messages)
    ? ((ticketDetail as { messages?: Array<Record<string, unknown>> }).messages ?? [])
    : [];
  const staffMembers = Array.isArray(staffQuery.data) ? staffQuery.data : [];

  return (
    <div className="stack-lg admin-tickets-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель / Заявки"
            title="Очередь обращений"
            description="Распределяйте заявки между операторами, отвечайте клиентам и фиксируйте решение в одном рабочем окне."
            actions={
              <div className="inline-actions">
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="all">Все статусы</option>
                  <option value="open">Открытые</option>
                  <option value="pending">В работе</option>
                  <option value="resolved">Решённые</option>
                  <option value="closed">Закрытые</option>
                </select>
              </div>
            }
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          <Card className="span-7 table-shell">
            {items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Заявка</th>
                      <th>Абонент</th>
                      <th>Статус</th>
                      <th>Приоритет</th>
                      <th>Оператор</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((ticket) => (
                      <tr
                        key={ticket.id}
                        className="table-row-interactive"
                        onClick={() => {
                          setActiveTicketId(ticket.id);
                          setAssigneeId(ticket.assigned_to ? String(ticket.assigned_to) : "");
                        }}
                      >
                        <td>
                          <div className="stack-sm">
                            <strong>{ticket.subject}</strong>
                            <span className="muted">{formatDate(ticket.created_at ?? new Date().toISOString())}</span>
                          </div>
                        </td>
                        <td>{ticket.user_phone}</td>
                        <td>
                          <StatusBadge tone={getTicketStatusTone(ticket.status)}>
                            {getTicketStatusLabel(ticket.status)}
                          </StatusBadge>
                        </td>
                        <td>
                          <StatusBadge tone={getTicketPriorityTone(ticket.priority)}>
                            {getTicketPriorityLabel(ticket.priority)}
                          </StatusBadge>
                        </td>
                        <td>{ticket.assigned_to_name || "Не назначен"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<LifeBuoy size={20} />}
                title="Очередь пуста"
                description="По текущему фильтру нет обращений. Измените статус или вернитесь позже."
              />
            )}
          </Card>

          <Card className="span-5 stack-md">
            <div className="inline-actions">
              <LifeBuoy size={18} />
              <strong>{activeTicketId ? `Заявка #${activeTicketId}` : "Выберите заявку"}</strong>
            </div>

            {activeTicketId ? (
              <>
                <div className="field">
                  <label htmlFor="ticket-assignee">Назначить оператору</label>
                  <select
                    id="ticket-assignee"
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {staffMembers.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => assignMutation.mutate()}
                  disabled={!assigneeId}
                  isLoading={assignMutation.isPending}
                  loadingLabel="Назначаем..."
                  feedbackState={assignFeedback.feedbackState}
                >
                  Назначить оператора
                </Button>

                <div className="field">
                  <label htmlFor="ticket-reply">Ответ клиенту</label>
                  <textarea
                    id="ticket-reply"
                    value={replyText}
                    aria-invalid={replyText.length > 0 && !replyText.trim()}
                    onChange={(event) => setReplyText(event.target.value)}
                    placeholder="Коротко и по делу опишите следующий шаг или решение."
                  />
                </div>

                <Button
                  onClick={() => replyMutation.mutate()}
                  disabled={!replyText.trim()}
                  isLoading={replyMutation.isPending}
                  loadingLabel="Отправляем..."
                  feedbackState={replyFeedback.feedbackState}
                >
                  Отправить ответ
                </Button>

                <div className="field">
                  <label htmlFor="ticket-resolution">Решение</label>
                  <textarea
                    id="ticket-resolution"
                    value={resolutionText}
                    aria-invalid={resolutionText.length > 0 && !resolutionText.trim()}
                    onChange={(event) => setResolutionText(event.target.value)}
                    placeholder="Зафиксируйте, что именно было сделано для решения проблемы."
                  />
                </div>

                <Button
                  variant="secondary"
                  onClick={() => resolveMutation.mutate()}
                  disabled={!resolutionText.trim()}
                  isLoading={resolveMutation.isPending}
                  loadingLabel="Завершаем..."
                  feedbackState={resolveFeedback.feedbackState}
                >
                  Отметить как решённую
                </Button>

                <div className="stack-sm">
                  <strong>Последние сообщения</strong>
                  {detailMessages.length ? (
                    detailMessages.map((message, index) => (
                      <div key={String(message.id ?? index)} className="list-item">
                        <div>
                          <strong>{getMessageAuthorLabel(message)}</strong>
                          <p>{String(message.body ?? "")}</p>
                        </div>
                        <span className="muted">
                          {formatDate(String(message.created_at ?? new Date().toISOString()))}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Сообщения появятся после загрузки деталей обращения.</p>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                icon={<LifeBuoy size={20} />}
                title="Детали появятся справа"
                description="Выберите обращение в таблице, чтобы назначить исполнителя, ответить клиенту или завершить кейс."
              />
            )}
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <div className="toolbar-row">
          <span className="muted">Страница {page}</span>
          <div className="inline-actions">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Назад
            </Button>
            <Button variant="secondary" onClick={() => setPage((current) => current + 1)}>
              Далее
            </Button>
          </div>
        </div>
      </AnimatedReveal>
    </div>
  );
}

export default AdminTicketsPage;
