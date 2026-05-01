import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Gauge, Network, PlugZap, Power, RefreshCw, RotateCcw, ShieldAlert, Ticket, Wallet } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { gponService } from "@/services/endpoints/gpon";
import { radiusService } from "@/services/endpoints/radius";
import { subscribersService } from "@/services/endpoints/subscribers";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { GponOnt, RadiusSession, SubscriberPayment, SubscriberTicket } from "@/types/domain";
import { formatCurrency, formatDate, formatSpeed } from "@/utils/format";
import { hasMvpRole } from "@/utils/roles";

type SubscriberTab = "main" | "balance" | "payments" | "tickets" | "network";
const LOW_RX_POWER = -25;

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

function radiusStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") {
    return "success";
  }
  if (status === "blocked") {
    return "danger";
  }
  if (status === "disconnected") {
    return "warning";
  }
  return "neutral";
}

function radiusStatusLabel(status: string) {
  if (status === "active") {
    return "Активна";
  }
  if (status === "blocked") {
    return "Заблокирована";
  }
  if (status === "disconnected") {
    return "Отключена";
  }
  return status;
}

function gponStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "online") {
    return "success";
  }
  if (status === "rogue_suspected") {
    return "warning";
  }
  if (status === "offline" || status === "blocked") {
    return "danger";
  }
  return "neutral";
}

function gponStatusLabel(status: string) {
  if (status === "online") {
    return "Online";
  }
  if (status === "offline") {
    return "Offline";
  }
  if (status === "blocked") {
    return "Blocked";
  }
  if (status === "rogue_suspected") {
    return "Rogue suspected";
  }
  return status;
}

function rxPowerTone(value?: number | null): "success" | "warning" | "danger" | "neutral" {
  if (value === null || value === undefined) {
    return "neutral";
  }
  if (value <= LOW_RX_POWER) {
    return "danger";
  }
  if (value <= -23) {
    return "warning";
  }
  return "success";
}

function formatPower(value?: number | null) {
  return value === null || value === undefined ? "n/a" : `${value.toFixed(2)} dBm`;
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
  const role = useAuthStore((state: AuthState) => state.role);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SubscriberTab>("main");
  const [speedDown, setSpeedDown] = useState("");
  const [speedUp, setSpeedUp] = useState("");

  const canReadRadius = hasMvpRole(role, ["support", "billing", "noc_engineer", "admin"]);
  const canBlockRadius = hasMvpRole(role, ["billing"]);
  const canDisconnectRadius = hasMvpRole(role, ["support", "noc_engineer"]);
  const canChangeRadiusSpeed = hasMvpRole(role, ["noc_engineer"]);
  const canReadGponSummary = hasMvpRole(role, ["subscriber", "support", "billing", "noc_engineer", "admin"]);
  const canGponNocAction = hasMvpRole(role, ["noc_engineer"]);
  const canGponAdminAction = hasMvpRole(role, ["admin"]);

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
  const radiusQuery = useQuery({
    queryKey: ["radius", "subscriber", subscriberId],
    queryFn: () => radiusService.subscriberSession(subscriberId),
    enabled: Boolean(subscriberId) && canReadRadius,
    retry: false,
  });
  const gponQuery = useQuery({
    queryKey: ["gpon", "subscriber", subscriberId],
    queryFn: () => gponService.subscriberOnt(subscriberId),
    enabled: Boolean(subscriberId) && canReadGponSummary,
    retry: false,
  });

  const radiusMutation = useMutation({
    mutationFn: async (payload: {
      command: "block" | "unblock" | "disconnect" | "change_speed";
      session: RadiusSession;
      speedDown?: number;
      speedUp?: number;
    }) => {
      if (payload.command === "block") {
        return radiusService.block(payload.session.subscriber_id);
      }
      if (payload.command === "unblock") {
        return radiusService.unblock(payload.session.subscriber_id);
      }
      if (payload.command === "disconnect") {
        return radiusService.disconnect(payload.session.subscriber_id);
      }
      return radiusService.changeSpeed(
        payload.session.subscriber_id,
        payload.speedDown ?? payload.session.speed_down,
        payload.speedUp ?? payload.session.speed_up,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["radius"] });
      toast.success("RADIUS mock-команда выполнена.");
    },
    onError: () => {
      toast.error("Не удалось выполнить RADIUS mock-команду.");
    },
  });

  const gponMutation = useMutation({
    mutationFn: async (payload: {
      command: "reboot" | "block" | "unblock" | "mark_rogue_suspected" | "refresh_status";
      ont: GponOnt;
    }) => {
      if (payload.command === "reboot") {
        return gponService.reboot(payload.ont.id);
      }
      if (payload.command === "block") {
        return gponService.block(payload.ont.id);
      }
      if (payload.command === "unblock") {
        return gponService.unblock(payload.ont.id);
      }
      if (payload.command === "mark_rogue_suspected") {
        return gponService.markRogueSuspected(payload.ont.id);
      }
      return gponService.refreshStatus(payload.ont.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gpon"] });
      toast.success("GPON mock-команда выполнена.");
    },
    onError: () => {
      toast.error("Не удалось выполнить GPON mock-команду.");
    },
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
  const radiusSession = radiusQuery.data;
  const gponOnt = gponQuery.data;

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
        <div className="cards-grid">
          <Card className="span-7 stack-md">
            <div className="inline-actions">
              <Network size={18} />
              <strong>RADIUS-сессия</strong>
            </div>
            {!canReadRadius ? (
              <p className="muted">RADIUS-сессии доступны сотрудникам support, billing, NOC и admin.</p>
            ) : null}
            {canReadRadius && radiusQuery.isLoading ? <Skeleton className="skeleton-card" /> : null}
            {canReadRadius && !radiusQuery.isLoading && !radiusSession ? (
              <EmptyState
                icon={<Network size={20} />}
                title="RADIUS-сессия не найдена"
                description="Mock-сессия появится после demo-seed или первой управляющей команды."
              />
            ) : null}
            {radiusSession ? (
              <>
                <div className="summary-row">
                  <span>Статус</span>
                  <StatusBadge tone={radiusStatusTone(radiusSession.status)}>
                    {radiusStatusLabel(radiusSession.status)}
                  </StatusBadge>
                </div>
                <div className="summary-row">
                  <span>IP / MAC</span>
                  <strong>
                    {radiusSession.framed_ip_address ?? "IP не назначен"} /{" "}
                    {radiusSession.mac_address ?? "MAC не указан"}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Профиль тарифа</span>
                  <strong>{radiusSession.tariff_profile ?? "MVP-DEFAULT"}</strong>
                </div>
                <div className="summary-row">
                  <span>Скорость</span>
                  <strong>{radiusSession.speed_down} / {radiusSession.speed_up} Мбит/с</strong>
                </div>
                <div className="inline-actions">
                  {canBlockRadius && radiusSession.status !== "blocked" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      isLoading={radiusMutation.isPending}
                      onClick={() => radiusMutation.mutate({ command: "block", session: radiusSession })}
                    >
                      <Ban size={14} />
                      Block
                    </Button>
                  ) : null}
                  {canBlockRadius && radiusSession.status === "blocked" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={radiusMutation.isPending}
                      onClick={() => radiusMutation.mutate({ command: "unblock", session: radiusSession })}
                    >
                      <RotateCcw size={14} />
                      Unblock
                    </Button>
                  ) : null}
                  {canDisconnectRadius && radiusSession.status !== "disconnected" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={radiusMutation.isPending}
                      onClick={() => radiusMutation.mutate({ command: "disconnect", session: radiusSession })}
                    >
                      <PlugZap size={14} />
                      Disconnect
                    </Button>
                  ) : null}
                </div>
                {canChangeRadiusSpeed ? (
                  <div className="form-grid">
                    <label className="field" htmlFor="subscriber-radius-down">
                      <span>Download, Мбит/с</span>
                      <input
                        id="subscriber-radius-down"
                        type="number"
                        min={1}
                        max={10000}
                        value={speedDown || radiusSession.speed_down}
                        onChange={(event) => setSpeedDown(event.target.value)}
                      />
                    </label>
                    <label className="field" htmlFor="subscriber-radius-up">
                      <span>Upload, Мбит/с</span>
                      <input
                        id="subscriber-radius-up"
                        type="number"
                        min={1}
                        max={10000}
                        value={speedUp || radiusSession.speed_up}
                        onChange={(event) => setSpeedUp(event.target.value)}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={radiusMutation.isPending}
                      onClick={() =>
                        radiusMutation.mutate({
                          command: "change_speed",
                          session: radiusSession,
                          speedDown: Number(speedDown || radiusSession.speed_down),
                          speedUp: Number(speedUp || radiusSession.speed_up),
                        })
                      }
                    >
                      <Gauge size={14} />
                      Change speed
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </Card>

          <Card className="span-5 stack-md">
            <div className="inline-actions">
              <Network size={18} />
              <strong>GPON / ONT</strong>
            </div>
            {gponQuery.isLoading ? <Skeleton className="skeleton-card" /> : null}
            {!gponQuery.isLoading && !gponOnt ? (
              <EmptyState
                icon={<Network size={20} />}
                title="ONT не найдена"
                description="GPON mock-данные появятся после demo-seed или назначения ONT абоненту."
              />
            ) : null}
            {gponOnt ? (
              <>
                <div className="summary-row">
                  <span>Статус</span>
                  <StatusBadge tone={gponStatusTone(gponOnt.status)}>{gponStatusLabel(gponOnt.status)}</StatusBadge>
                </div>
                <div className="summary-row">
                  <span>OLT / PON</span>
                  <strong>
                    {gponOnt.olt?.name ?? gponOnt.olt_id} / PON {gponOnt.pon_port}:{gponOnt.ont_id_on_port}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Serial / MAC</span>
                  <strong>{gponOnt.serial_number} / {gponOnt.mac_address ?? "MAC не указан"}</strong>
                </div>
                <div className="summary-row">
                  <span>VLAN</span>
                  <strong>{gponOnt.vlan_id}</strong>
                </div>
                <div className="summary-row">
                  <span>RX / TX</span>
                  <div className="inline-actions">
                    <StatusBadge tone={rxPowerTone(gponOnt.rx_power)}>{formatPower(gponOnt.rx_power)}</StatusBadge>
                    <strong>{formatPower(gponOnt.tx_power)}</strong>
                  </div>
                </div>
                <div className="summary-row">
                  <span>Last seen</span>
                  <strong>{formatDate(gponOnt.last_seen_at)}</strong>
                </div>
                <div className="inline-actions">
                  {canGponNocAction ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={gponMutation.isPending}
                        onClick={() => gponMutation.mutate({ command: "refresh_status", ont: gponOnt })}
                      >
                        <RefreshCw size={14} />
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={gponMutation.isPending}
                        onClick={() => gponMutation.mutate({ command: "reboot", ont: gponOnt })}
                      >
                        <Power size={14} />
                        Reboot
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={gponMutation.isPending}
                        onClick={() => gponMutation.mutate({ command: "mark_rogue_suspected", ont: gponOnt })}
                      >
                        <ShieldAlert size={14} />
                        Mark rogue
                      </Button>
                    </>
                  ) : null}
                  {canGponAdminAction && gponOnt.status !== "blocked" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      isLoading={gponMutation.isPending}
                      onClick={() => gponMutation.mutate({ command: "block", ont: gponOnt })}
                    >
                      <Ban size={14} />
                      Block
                    </Button>
                  ) : null}
                  {canGponAdminAction && gponOnt.status === "blocked" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={gponMutation.isPending}
                      onClick={() => gponMutation.mutate({ command: "unblock", ont: gponOnt })}
                    >
                      <RotateCcw size={14} />
                      Unblock
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export default SubscriberDetailPage;
