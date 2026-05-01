import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Shield } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { adminService } from "@/services/endpoints/admin";
import { formatCurrency, formatDate, formatRelative } from "@/utils/format";

function extractArray(candidate: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(candidate)) {
    return candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  return [];
}

function extractRecord(candidate: unknown): Record<string, unknown> {
  return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
}

function getRoleLabel(role?: string | null) {
  if (role === "super_admin") {
    return "Суперадминистратор";
  }

  if (role === "admin") {
    return "Администратор";
  }

  if (role === "operator") {
    return "Оператор";
  }

  return "Абонент";
}

function getPaymentStatusLabel(status?: string | null, fallbackType?: string | null) {
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

  return fallbackType || "Платёж";
}

function getTicketStatusLabel(status?: string | null) {
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

  return "Новая";
}

function getTicketPriorityLabel(priority?: string | null) {
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

function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.userId?.trim() ?? "";
  const [manualAmount, setManualAmount] = useState(500);
  const [manualComment, setManualComment] = useState("Ручное пополнение из админ-панели");

  const userQuery = useQuery({
    queryKey: ["admin-user-detail", userId],
    queryFn: () => adminService.getUser(userId),
    enabled: Boolean(userId),
  });

  const blockMutation = useMutation({
    mutationFn: () => adminService.blockUser(userId),
    onSuccess: () => {
      toast.success("Пользователь заблокирован.");
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("Не удалось заблокировать пользователя."),
  });

  const unblockMutation = useMutation({
    mutationFn: () => adminService.unblockUser(userId),
    onSuccess: () => {
      toast.success("Доступ восстановлен.");
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("Не удалось восстановить доступ."),
  });

  const manualPaymentMutation = useMutation({
    mutationFn: () => adminService.manualPayment(userId, manualAmount, manualComment),
    onSuccess: () => {
      toast.success("Ручное начисление выполнено.");
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("Не удалось провести ручное начисление."),
  });

  const data = extractRecord(userQuery.data);
  const user = extractRecord(data.user ?? data.profile ?? data);
  const billing = extractRecord(data.billing ?? {});
  const currentTariff = extractRecord(data.current_tariff ?? user.current_tariff ?? {});
  const recentPayments = useMemo(
    () => extractArray(data.recent_payments ?? data.payments ?? billing.recent_payments),
    [billing.recent_payments, data.payments, data.recent_payments],
  );
  const recentTickets = useMemo(
    () => extractArray(data.recent_tickets ?? data.tickets ?? user.recent_tickets),
    [data.recent_tickets, data.tickets, user.recent_tickets],
  );

  const isBlocked = Boolean(user.is_blocked ?? data.is_blocked);
  const isActive = Boolean(user.is_active ?? data.is_active ?? true);
  const isVerified = user.is_verified === true;
  const hasTwoFactor = user.is_2fa_enabled === true;
  const lastLoginAt =
    typeof user.last_login_at === "string"
      ? user.last_login_at
      : typeof data.last_login_at === "string"
        ? data.last_login_at
        : null;

  return (
    <div className="stack-lg">
      <Link className="link-line" to="/admin/users">
        <ArrowLeft size={16} /> Назад к списку абонентов
      </Link>

      <Card className="hero-card">
        <SectionHeading
          eyebrow="Админ-панель / Абонент"
          title={String(user.full_name ?? user.phone ?? `Пользователь #${userId}`)}
          description="Карточка клиента с основными данными, финансовым статусом и быстрыми административными действиями."
        />
      </Card>

      <div className="cards-grid">
        <Card className="span-4 stack-md">
          <div className="toolbar-row">
            <strong>Статус</strong>
            <StatusBadge tone={isBlocked ? "danger" : isActive ? "success" : "warning"}>
              {isBlocked ? "Заблокирован" : isActive ? "Активен" : "Неактивен"}
            </StatusBadge>
          </div>
          <div className="summary-row">
            <span>Телефон</span>
            <strong>{String(user.phone ?? "-")}</strong>
          </div>
          <div className="summary-row">
            <span>Email</span>
            <strong>{String(user.email ?? "-")}</strong>
          </div>
          <div className="summary-row">
            <span>Billing ID</span>
            <strong>{String(user.billing_id ?? billing.billing_id ?? "-")}</strong>
          </div>
          <div className="summary-row">
            <span>Последний вход</span>
            <strong>{formatRelative(lastLoginAt)}</strong>
          </div>
          <div className="inline-actions">
            {isBlocked ? (
              <Button variant="secondary" onClick={() => unblockMutation.mutate()}>
                Разблокировать
              </Button>
            ) : (
              <Button variant="danger" onClick={() => blockMutation.mutate()}>
                Заблокировать
              </Button>
            )}
          </div>
        </Card>

        <Card className="span-4 stack-md">
          <div className="inline-actions">
            <CreditCard size={18} />
            <strong>Финансы</strong>
          </div>
          <div className="summary-row">
            <span>Баланс</span>
            <strong>{formatCurrency(Number(user.balance ?? billing.balance ?? 0))}</strong>
          </div>
          <div className="summary-row">
            <span>Тариф</span>
            <strong>{String(currentTariff.name ?? "Не назначен")}</strong>
          </div>
          <div className="summary-row">
            <span>Скорость</span>
            <strong>{String(currentTariff.speed_mbps ?? "-")} Мбит/с</strong>
          </div>
          <div className="field">
            <label htmlFor="manualAmount">Сумма ручного начисления</label>
            <input
              id="manualAmount"
              type="number"
              value={manualAmount}
              onChange={(event) => setManualAmount(Number(event.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label htmlFor="manualComment">Комментарий</label>
            <input
              id="manualComment"
              value={manualComment}
              onChange={(event) => setManualComment(event.target.value)}
            />
          </div>
          <Button onClick={() => manualPaymentMutation.mutate()} disabled={manualPaymentMutation.isPending}>
            {manualPaymentMutation.isPending ? "Проводим..." : "Начислить вручную"}
          </Button>
        </Card>

        <Card className="span-4 stack-md">
          <div className="inline-actions">
            <Shield size={18} />
            <strong>Профиль клиента</strong>
          </div>
          <div className="summary-row">
            <span>Роль</span>
            <strong>{getRoleLabel(String(user.role ?? data.role ?? "user"))}</strong>
          </div>
          <div className="summary-row">
            <span>Верификация</span>
            <StatusBadge tone={isVerified ? "success" : "warning"}>
              {isVerified ? "Пройдена" : "Не завершена"}
            </StatusBadge>
          </div>
          <div className="summary-row">
            <span>Создан</span>
            <strong>{formatDate(String(user.created_at ?? data.created_at ?? new Date().toISOString()))}</strong>
          </div>
          <div className="summary-row">
            <span>2FA</span>
            <strong>{hasTwoFactor ? "Включена" : "Выключена"}</strong>
          </div>
        </Card>
      </div>

      <div className="cards-grid">
        <Card className="span-6 stack-md">
          <strong>Последние платежи</strong>
          {recentPayments.length ? (
            recentPayments.map((payment, index) => (
              <div key={String(payment.id ?? index)} className="list-item">
                <div>
                  <strong>{formatCurrency(Number(payment.amount ?? 0))}</strong>
                  <p className="muted">
                    {getPaymentStatusLabel(String(payment.status ?? ""), String(payment.payment_type ?? "Платёж"))}
                  </p>
                </div>
                <div>
                  <p className="muted">
                    {formatDate(String(payment.created_at ?? payment.completed_at ?? new Date().toISOString()))}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">История платежей пока недоступна в карточке пользователя.</p>
          )}
        </Card>

        <Card className="span-6 stack-md">
          <strong>Последние обращения</strong>
          {recentTickets.length ? (
            recentTickets.map((ticket, index) => (
              <div key={String(ticket.id ?? index)} className="list-item">
                <div>
                  <strong>{String(ticket.subject ?? `Заявка #${ticket.id ?? index}`)}</strong>
                  <p className="muted">
                    {getTicketPriorityLabel(String(ticket.priority ?? ""))} / {getTicketStatusLabel(String(ticket.status ?? ""))}
                  </p>
                </div>
                <div>
                  <p className="muted">
                    {formatDate(String(ticket.created_at ?? ticket.updated_at ?? new Date().toISOString()))}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Активных обращений сейчас нет.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default AdminUserDetailPage;
