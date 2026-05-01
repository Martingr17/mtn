import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Gauge, PlugZap, RotateCcw, ShieldOff } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { radiusService } from "@/services/endpoints/radius";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { RadiusAction, RadiusSession } from "@/types/domain";
import { formatDate } from "@/utils/format";
import { hasMvpRole } from "@/utils/roles";

const PAGE_SIZE = 20;

type RadiusCommand = "block" | "unblock" | "disconnect" | "change_speed";

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
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

function statusLabel(status: string) {
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

function actionLabel(action: RadiusAction | string) {
  if (action === "block") {
    return "Блокировка";
  }
  if (action === "unblock") {
    return "Разблокировка";
  }
  if (action === "disconnect") {
    return "Disconnect";
  }
  if (action === "change_speed") {
    return "Смена скорости";
  }
  return action;
}

function RadiusPage() {
  const role = useAuthStore((state: AuthState) => state.role);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [speedSession, setSpeedSession] = useState<RadiusSession | null>(null);
  const [speedDown, setSpeedDown] = useState(100);
  const [speedUp, setSpeedUp] = useState(50);

  const canBlock = hasMvpRole(role, ["billing"]);
  const canDisconnect = hasMvpRole(role, ["support", "noc_engineer"]);
  const canChangeSpeed = hasMvpRole(role, ["noc_engineer"]);

  const sessionsQuery = useQuery({
    queryKey: ["radius", "sessions", page, status, search],
    queryFn: () =>
      radiusService.sessions({
        page,
        page_size: PAGE_SIZE,
        status,
        search: search || undefined,
      }),
  });

  const actionsQuery = useQuery({
    queryKey: ["radius", "actions", search],
    queryFn: () =>
      radiusService.actions({
        page: 1,
        page_size: 20,
        search: search || undefined,
      }),
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: {
      command: RadiusCommand;
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
      setSpeedSession(null);
      toast.success("RADIUS mock-команда выполнена.");
    },
    onError: () => {
      toast.error("Не удалось выполнить RADIUS mock-команду.");
    },
  });

  const sessions = sessionsQuery.data?.items ?? [];
  const totalPages =
    sessionsQuery.data?.total_pages ?? Math.max(1, Math.ceil((sessionsQuery.data?.total ?? 0) / PAGE_SIZE));
  const actions = actionsQuery.data?.items ?? [];

  const openSpeedModal = (session: RadiusSession) => {
    setSpeedSession(session);
    setSpeedDown(session.speed_down);
    setSpeedUp(session.speed_up);
  };

  return (
    <div className="stack-lg">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Network / RADIUS CoA"
            title="RADIUS/CoA mock"
            description="Управление mock-сессиями абонентов: block, unblock, disconnect и change speed без подключения к реальному FreeRADIUS."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          <div className="cards-grid">
            <label className="field span-4" htmlFor="radius-status">
              <span>Статус</span>
              <select
                id="radius-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="blocked">Заблокированные</option>
                <option value="disconnected">Отключённые</option>
              </select>
            </label>
            <label className="field span-8" htmlFor="radius-search">
              <span>Поиск</span>
              <input
                id="radius-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Абонент, договор, IP, MAC"
              />
            </label>
          </div>
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="table-shell stack-md">
          <div className="toolbar-row">
            <div>
              <strong>Сессии</strong>
              <p className="muted">Состояние хранится локально в mock-таблице `radius_sessions`.</p>
            </div>
          </div>

          {sessions.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Абонент</th>
                    <th>IP / MAC</th>
                    <th>NAS</th>
                    <th>Профиль</th>
                    <th>Скорость</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <div className="stack-sm">
                          <Link className="link-line" to={`/subscribers/${session.subscriber_id}`}>
                            <strong>{session.subscriber?.full_name ?? session.username}</strong>
                          </Link>
                          <span className="muted">{session.subscriber?.billing_id ?? session.username}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{session.framed_ip_address ?? "IP не назначен"}</strong>
                          <span className="muted">{session.mac_address ?? "MAC не указан"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{session.nas_ip_address ?? "NAS не указан"}</strong>
                          <span className="muted">{session.nas_port ?? "Порт не указан"}</span>
                        </div>
                      </td>
                      <td>{session.tariff_profile ?? "MVP-DEFAULT"}</td>
                      <td>{session.speed_down} / {session.speed_up} Мбит/с</td>
                      <td>
                        <StatusBadge tone={statusTone(session.status)}>{statusLabel(session.status)}</StatusBadge>
                      </td>
                      <td>
                        <div className="inline-actions">
                          {canBlock && session.status !== "blocked" ? (
                            <Button
                              size="sm"
                              variant="danger"
                              isLoading={actionMutation.isPending}
                              onClick={() => actionMutation.mutate({ command: "block", session })}
                            >
                              <Ban size={14} />
                              Block
                            </Button>
                          ) : null}
                          {canBlock && session.status === "blocked" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={actionMutation.isPending}
                              onClick={() => actionMutation.mutate({ command: "unblock", session })}
                            >
                              <RotateCcw size={14} />
                              Unblock
                            </Button>
                          ) : null}
                          {canDisconnect && session.status !== "disconnected" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={actionMutation.isPending}
                              onClick={() => actionMutation.mutate({ command: "disconnect", session })}
                            >
                              <PlugZap size={14} />
                              Disconnect
                            </Button>
                          ) : null}
                          {canChangeSpeed ? (
                            <Button size="sm" variant="secondary" onClick={() => openSpeedModal(session)}>
                              <Gauge size={14} />
                              Speed
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<ShieldOff size={20} />}
              title="RADIUS-сессии не найдены"
              description="Измените фильтры или дождитесь demo-seed сессий."
            />
          )}
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.15}>
        <div className="toolbar-row">
          <span className="muted">
            Страница {page} из {totalPages}
          </span>
          <div className="inline-actions">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Назад
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Далее
            </Button>
          </div>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.2}>
        <Card className="table-shell stack-md">
          <strong>Журнал действий RADIUS</strong>
          {actions.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Абонент</th>
                    <th>Действие</th>
                    <th>Статус</th>
                    <th>Скорость</th>
                    <th>Исполнитель</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.created_at)}</td>
                      <td>{item.subscriber?.billing_id ?? item.subscriber_id}</td>
                      <td>{actionLabel(item.action)}</td>
                      <td>{item.old_status ?? "n/a"} → {item.new_status ?? "n/a"}</td>
                      <td>
                        {item.old_speed_down ?? "n/a"} / {item.old_speed_up ?? "n/a"} →{" "}
                        {item.new_speed_down ?? "n/a"} / {item.new_speed_up ?? "n/a"}
                      </td>
                      <td>{item.performed_by_name ?? item.performed_by ?? "system"}</td>
                      <td>{item.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<ShieldOff size={20} />}
              title="Журнал пока пуст"
              description="После первой mock-команды здесь появится запись из `radius_action_log`."
            />
          )}
        </Card>
      </AnimatedReveal>

      <AnimatedModal
        open={Boolean(speedSession)}
        onClose={() => setSpeedSession(null)}
        title="Change speed"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSpeedSession(null)}>
              Отмена
            </Button>
            <Button
              isLoading={actionMutation.isPending}
              onClick={() => {
                if (!speedSession) {
                  return;
                }
                actionMutation.mutate({
                  command: "change_speed",
                  session: speedSession,
                  speedDown,
                  speedUp,
                });
              }}
            >
              Применить
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field" htmlFor="radius-speed-down">
            <span>Download, Мбит/с</span>
            <input
              id="radius-speed-down"
              type="number"
              min={1}
              max={10000}
              value={speedDown}
              onChange={(event) => setSpeedDown(Number(event.target.value))}
            />
          </label>
          <label className="field" htmlFor="radius-speed-up">
            <span>Upload, Мбит/с</span>
            <input
              id="radius-speed-up"
              type="number"
              min={1}
              max={10000}
              value={speedUp}
              onChange={(event) => setSpeedUp(Number(event.target.value))}
            />
          </label>
        </div>
      </AnimatedModal>
    </div>
  );
}

export default RadiusPage;
