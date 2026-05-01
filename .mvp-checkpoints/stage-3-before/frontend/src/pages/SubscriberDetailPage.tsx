import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Network, Ticket, Wallet } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { subscribersService } from "@/services/endpoints/subscribers";
import type { SubscriberPayment, SubscriberTicket } from "@/types/domain";
import { formatCurrency, formatDate, formatSpeed } from "@/utils/format";

type SubscriberTab = "main" | "balance" | "payments" | "tickets" | "network";

const TABS: Array<{ key: SubscriberTab; label: string }> = [
  { key: "main", label: "Основное" },
  { key: "balance", label: "Баланс" },
  { key: "payments", label: "Платежи" },
  { key: "tickets", label: "Заявки" },
  { key: "network", label: "Сеть / ONT" },
];

function statusTone(status: string): "success" | "warning" | "danger" {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "inactive") {
    return "warning";
  }
  return "success";
}

function paymentStatusLabel(status: string) {
  if (status === "succeeded") {
    return "Успешно";
  }
  if (status === "pending" || status === "processing") {
    return "В обработке";
  }
  if (status === "failed") {
    return "Ошибка";
  }
  if (status === "cancelled") {
    return "Отменен";
  }
  return status;
}

function ticketStatusLabel(status: string) {
  if (status === "new") {
    return "Новая";
  }
  if (status === "in_progress") {
    return "В работе";
  }
  if (status === "waiting_customer") {
    return "Ожидает клиента";
  }
  if (status === "resolved") {
    return "Решена";
  }
  if (status === "closed") {
    return "Закрыта";
  }
  return status;
}

function PaymentsTable({ items }: { items: SubscriberPayment[] }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<Wallet size={20} />}
        title="Платежей пока нет"
        description="История платежей появится после первой операции по абоненту."
      />
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Сумма</th>
            <th>Метод</th>
            <th>Тип</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {items.map((payment) => (
            <tr key={payment.id}>
              <td>{formatDate(payment.completed_at ?? payment.created_at)}</td>
              <td>{formatCurrency(payment.amount)}</td>
              <td>{payment.payment_method || "Не указан"}</td>
              <td>{payment.payment_type}</td>
              <td>{paymentStatusLabel(payment.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketsTable({ items }: { items: SubscriberTicket[] }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<Ticket size={20} />}
        title="Заявок пока нет"
        description="История обращений абонента будет доступна в этом блоке."
      />
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Заявка</th>
            <th>Категория</th>
            <th>Приоритет</th>
            <th>Статус</th>
            <th>Создана</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <div className="stack-sm">
                  <strong>{ticket.subject}</strong>
                  <span className="muted">{ticket.assignee_name || "Не назначена"}</span>
                </div>
              </td>
              <td>{ticket.category || "Другое"}</td>
              <td>{ticket.priority}</td>
              <td>{ticketStatusLabel(ticket.status)}</td>
              <td>{formatDate(ticket.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriberDetailPage() {
  const { id } = useParams();
  const subscriberId = id ?? "";
  const [activeTab, setActiveTab] = useState<SubscriberTab>("main");

  const detailQuery = useQuery({
    queryKey: ["subscriber-detail", subscriberId],
    queryFn: () => subscribersService.detail(subscriberId),
    enabled: Boolean(subscriberId),
  });
  const balanceQuery = useQuery({
    queryKey: ["subscriber-detail", subscriberId, "balance"],
    queryFn: () => subscribersService.balance(subscriberId),
    enabled: Boolean(subscriberId),
  });
  const paymentsQuery = useQuery({
    queryKey: ["subscriber-detail", subscriberId, "payments"],
    queryFn: () => subscribersService.payments(subscriberId, 20, 0),
    enabled: Boolean(subscriberId),
  });
  const ticketsQuery = useQuery({
    queryKey: ["subscriber-detail", subscriberId, "tickets"],
    queryFn: () => subscribersService.tickets(subscriberId, 1, 20),
    enabled: Boolean(subscriberId),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="stack-lg">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-card" />
        <Skeleton className="skeleton-card" />
      </div>
    );
  }

  if (!detailQuery.data) {
    return (
      <Card>
        <EmptyState
          title="Абонент не найден"
          description="Проверьте идентификатор абонента или вернитесь к списку."
        />
      </Card>
    );
  }

  const subscriber = detailQuery.data;
  const balance = balanceQuery.data?.balance ?? subscriber.balance ?? 0;
  const payments = paymentsQuery.data?.items ?? subscriber.recent_payments;
  const tickets = ticketsQuery.data?.items ?? subscriber.recent_tickets;

  return (
    <div className="stack-lg">
      <Link className="link-line" to="/subscribers">
        <ArrowLeft size={16} /> Назад к абонентам
      </Link>

      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="OSS/BSS MVP / Карточка абонента"
            title={subscriber.full_name}
            description={`Договор ${subscriber.billing_id}. Единая сводка по услугам, балансу, платежам и обращениям.`}
            actions={
              <StatusBadge tone={statusTone(subscriber.service_status)}>
                {subscriber.service_status_label}
              </StatusBadge>
            }
          />
        </Card>
      </AnimatedReveal>

      <div className="tab-list" role="tablist" aria-label="Разделы карточки абонента">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab-trigger ${activeTab === tab.key ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "main" ? (
        <div className="cards-grid">
          <Card className="span-6 stack-md">
            <strong>Основные данные</strong>
            <div className="summary-row">
              <span>ФИО</span>
              <strong>{subscriber.full_name}</strong>
            </div>
            <div className="summary-row">
              <span>Номер договора</span>
              <strong>{subscriber.billing_id}</strong>
            </div>
            <div className="summary-row">
              <span>Адрес подключения</span>
              <strong>{subscriber.connection_address || "Не указан"}</strong>
            </div>
            <div className="summary-row">
              <span>Телефон</span>
              <strong>{subscriber.phone}</strong>
            </div>
            <div className="summary-row">
              <span>Email</span>
              <strong>{subscriber.email || "Не указан"}</strong>
            </div>
          </Card>

          <Card className="span-6 stack-md">
            <strong>Услуга</strong>
            <div className="summary-row">
              <span>Статус услуги</span>
              <StatusBadge tone={statusTone(subscriber.service_status)}>
                {subscriber.service_status_label}
              </StatusBadge>
            </div>
            <div className="summary-row">
              <span>Тариф</span>
              <strong>{subscriber.current_tariff?.name || "Не назначен"}</strong>
            </div>
            <div className="summary-row">
              <span>Скорость</span>
              <strong>{formatSpeed(subscriber.current_tariff?.speed_mbps ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Абонентская плата</span>
              <strong>{formatCurrency(subscriber.current_tariff?.price ?? 0)}</strong>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === "balance" ? (
        <div className="cards-grid">
          <Card className="span-4 metric-card">
            <span className="metric-label">Текущий баланс</span>
            <div className="metric-value">{formatCurrency(balance)}</div>
            <p className="muted">Обновлено {formatDate(balanceQuery.data?.updated_at)}</p>
          </Card>
          <Card className="span-4 metric-card">
            <span className="metric-label">Состояние</span>
            <div className="metric-value">{balance < 0 ? "Долг" : "ОК"}</div>
            <p className="muted">Договор {subscriber.billing_id}</p>
          </Card>
          <Card className="span-4 metric-card">
            <span className="metric-label">Последний платеж</span>
            <div className="metric-value">{formatDate(subscriber.last_payment_at, "d MMM")}</div>
            <p className="muted">История доступна во вкладке платежей</p>
          </Card>
        </div>
      ) : null}

      {activeTab === "payments" ? (
        <Card className="table-shell stack-md">
          <strong>Платежи</strong>
          <PaymentsTable items={payments} />
        </Card>
      ) : null}

      {activeTab === "tickets" ? (
        <Card className="table-shell stack-md">
          <strong>Заявки</strong>
          <TicketsTable items={tickets} />
        </Card>
      ) : null}

      {activeTab === "network" ? (
        <Card className="stack-md">
          <div className="inline-actions">
            <Network size={18} />
            <strong>Сеть / ONT</strong>
          </div>
          <p className="muted">
            Данные ONT, OLT, PON-порта и оптической мощности будут реализованы на этапе GPON.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

export default SubscriberDetailPage;
