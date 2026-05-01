import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye, Power, RadioTower, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { gponService } from "@/services/endpoints/gpon";
import { zabbixService } from "@/services/endpoints/zabbix";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { GponOnt, ZabbixAlarm } from "@/types/domain";
import { formatDate } from "@/utils/format";
import { hasMvpRole } from "@/utils/roles";

const PAGE_SIZE = 20;
const LOW_RX_POWER = -25;

type OntCommand = "reboot" | "block" | "unblock" | "mark_rogue_suspected" | "refresh_status";

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "online") {
    return "success";
  }
  if (status === "degraded" || status === "rogue_suspected") {
    return "warning";
  }
  if (status === "offline" || status === "blocked") {
    return "danger";
  }
  return "neutral";
}

function oltStatusLabel(status: string) {
  if (status === "online") {
    return "Online";
  }
  if (status === "degraded") {
    return "Degraded";
  }
  if (status === "offline") {
    return "Offline";
  }
  return status;
}

function ontStatusLabel(status: string) {
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

function rxTone(value?: number | null): "success" | "warning" | "danger" | "neutral" {
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

function alarmTone(alarms: ZabbixAlarm[]): "info" | "warning" | "danger" | "neutral" {
  if (alarms.some((alarm) => alarm.severity === "critical")) {
    return "danger";
  }
  if (alarms.some((alarm) => alarm.severity === "high" || alarm.severity === "warning")) {
    return "warning";
  }
  return alarms.length ? "info" : "neutral";
}

function formatPower(value?: number | null) {
  return value === null || value === undefined ? "n/a" : `${value.toFixed(2)} dBm`;
}

function GponPage() {
  const role = useAuthStore((state: AuthState) => state.role);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedOnt, setSelectedOnt] = useState<GponOnt | null>(null);
  const [oltId, setOltId] = useState("");
  const [status, setStatus] = useState("all");
  const [vlanId, setVlanId] = useState("");
  const [ponPort, setPonPort] = useState("");
  const [rxMin, setRxMin] = useState("");
  const [rxMax, setRxMax] = useState("");
  const [search, setSearch] = useState("");

  const canNocAction = hasMvpRole(role, ["noc_engineer"]);
  const canAdminAction = hasMvpRole(role, ["admin"]);

  const oltsQuery = useQuery({
    queryKey: ["gpon", "olts"],
    queryFn: () => gponService.olts(),
  });

  const ontsQuery = useQuery({
    queryKey: ["gpon", "onts", page, oltId, status, vlanId, ponPort, rxMin, rxMax, search],
    queryFn: () =>
      gponService.onts({
        page,
        page_size: PAGE_SIZE,
        olt_id: oltId || undefined,
        status,
        vlan_id: vlanId ? Number(vlanId) : undefined,
        pon_port: ponPort ? Number(ponPort) : undefined,
        rx_power_min: rxMin ? Number(rxMin) : undefined,
        rx_power_max: rxMax ? Number(rxMax) : undefined,
        search: search || undefined,
      }),
  });
  const linkedAlarmsQuery = useQuery({
    queryKey: ["zabbix", "gpon-linked-alarms"],
    queryFn: () => zabbixService.alarms({ status: "active", page_size: 100 }),
    retry: false,
  });

  const ontMutation = useMutation({
    mutationFn: async (payload: { command: OntCommand; ont: GponOnt }) => {
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
    onSuccess: async (result) => {
      setSelectedOnt(result.ont);
      await queryClient.invalidateQueries({ queryKey: ["gpon"] });
      toast.success("GPON mock-команда выполнена.");
    },
    onError: () => {
      toast.error("Не удалось выполнить GPON mock-команду.");
    },
  });

  const olts = oltsQuery.data?.items ?? [];
  const onts = ontsQuery.data?.items ?? [];
  const totalPages = ontsQuery.data?.total_pages ?? Math.max(1, Math.ceil((ontsQuery.data?.total ?? 0) / PAGE_SIZE));
  const alarmBySource = useMemo(() => {
    const map = new Map<string, ZabbixAlarm[]>();
    for (const alarm of linkedAlarmsQuery.data?.items ?? []) {
      if (!alarm.source_id || (alarm.source_type !== "olt" && alarm.source_type !== "ont")) {
        continue;
      }
      const key = `${alarm.source_type}:${alarm.source_id}`;
      map.set(key, [...(map.get(key) ?? []), alarm]);
    }
    return map;
  }, [linkedAlarmsQuery.data?.items]);

  const runAction = (command: OntCommand, ont: GponOnt = selectedOnt as GponOnt) => {
    if (!ont) {
      return;
    }
    ontMutation.mutate({ command, ont });
  };

  return (
    <div className="stack-lg">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Network / GPON"
            title="GPON / OLT / ONT mock"
            description="Mock-инвентарь Eltex LTP-16X: OLT, ONT, PON-порты, VLAN, статусы и оптическая мощность без подключения к реальному OLT."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          {olts.map((olt) => (
            <Card key={olt.id} className="span-4 stack-md">
              <div className="toolbar-row">
                <div className="inline-actions">
                  <RadioTower size={18} />
                  <strong>{olt.name}</strong>
                </div>
                <div className="inline-actions">
                  {alarmBySource.get(`olt:${olt.id}`)?.length ? (
                    <StatusBadge tone={alarmTone(alarmBySource.get(`olt:${olt.id}`) ?? [])}>
                      {`${alarmBySource.get(`olt:${olt.id}`)?.length ?? 0} alarm`}
                    </StatusBadge>
                  ) : null}
                  <StatusBadge tone={statusTone(olt.status)}>{oltStatusLabel(olt.status)}</StatusBadge>
                </div>
              </div>
              <div className="summary-row">
                <span>Management IP</span>
                <strong>{olt.management_ip}</strong>
              </div>
              <div className="summary-row">
                <span>Модель</span>
                <strong>{olt.vendor} {olt.model}</strong>
              </div>
              <div className="summary-row">
                <span>PON-порты</span>
                <strong>{olt.pon_ports_used} / {olt.pon_ports_total}</strong>
              </div>
              <div className="summary-row">
                <span>Uplink</span>
                <strong>{olt.uplink_status}</strong>
              </div>
            </Card>
          ))}
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="stack-md">
          <div className="cards-grid">
            <label className="field span-3" htmlFor="gpon-olt">
              <span>OLT</span>
              <select
                id="gpon-olt"
                value={oltId}
                onChange={(event) => {
                  setOltId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все OLT</option>
                {olts.map((olt) => (
                  <option key={olt.id} value={olt.id}>
                    {olt.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field span-3" htmlFor="gpon-status">
              <span>Статус ONT</span>
              <select
                id="gpon-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Все</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="blocked">Blocked</option>
                <option value="rogue_suspected">Rogue suspected</option>
              </select>
            </label>
            <label className="field span-2" htmlFor="gpon-vlan">
              <span>VLAN</span>
              <input
                id="gpon-vlan"
                type="number"
                value={vlanId}
                onChange={(event) => {
                  setVlanId(event.target.value);
                  setPage(1);
                }}
                placeholder="300"
              />
            </label>
            <label className="field span-2" htmlFor="gpon-port">
              <span>PON-port</span>
              <input
                id="gpon-port"
                type="number"
                value={ponPort}
                onChange={(event) => {
                  setPonPort(event.target.value);
                  setPage(1);
                }}
                placeholder="1"
              />
            </label>
            <label className="field span-2" htmlFor="gpon-rx-max">
              <span>RX хуже, dBm</span>
              <input
                id="gpon-rx-max"
                type="number"
                value={rxMax}
                onChange={(event) => {
                  setRxMax(event.target.value);
                  setPage(1);
                }}
                placeholder="-25"
              />
            </label>
            <label className="field span-4" htmlFor="gpon-rx-min">
              <span>RX минимум, dBm</span>
              <input
                id="gpon-rx-min"
                type="number"
                value={rxMin}
                onChange={(event) => {
                  setRxMin(event.target.value);
                  setPage(1);
                }}
                placeholder="-28"
              />
            </label>
            <label className="field span-8" htmlFor="gpon-search">
              <span>Поиск</span>
              <input
                id="gpon-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Абонент, договор, serial, MAC, OLT"
              />
            </label>
          </div>
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.15}>
        <Card className="table-shell stack-md">
          <div className="toolbar-row">
            <div>
              <strong>ONT</strong>
              <p className="muted">RX ниже {LOW_RX_POWER} dBm подсвечивается как low optical power.</p>
            </div>
          </div>
          {onts.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Абонент</th>
                    <th>OLT / PON</th>
                    <th>Serial / MAC</th>
                    <th>VLAN</th>
                    <th>Статус</th>
                    <th>Оптика</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {onts.map((ont) => (
                    <tr key={ont.id}>
                      <td>
                        <div className="stack-sm">
                          <Link className="link-line" to={`/subscribers/${ont.subscriber_id}`}>
                            <strong>{ont.subscriber?.full_name ?? ont.subscriber?.billing_id ?? ont.subscriber_id}</strong>
                          </Link>
                          <span className="muted">{ont.subscriber?.billing_id ?? "договор не указан"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{ont.olt?.name ?? ont.olt_id}</strong>
                          <span className="muted">PON {ont.pon_port} / ONT {ont.ont_id_on_port}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{ont.serial_number}</strong>
                          <span className="muted">{ont.mac_address ?? "MAC не указан"}</span>
                        </div>
                      </td>
                      <td>{ont.vlan_id}</td>
                      <td>
                        <div className="stack-sm">
                          <StatusBadge tone={statusTone(ont.status)}>{ontStatusLabel(ont.status)}</StatusBadge>
                          {alarmBySource.get(`ont:${ont.id}`)?.length ? (
                            <StatusBadge tone={alarmTone(alarmBySource.get(`ont:${ont.id}`) ?? [])}>
                              {`${alarmBySource.get(`ont:${ont.id}`)?.length ?? 0} alarm`}
                            </StatusBadge>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <StatusBadge tone={rxTone(ont.rx_power)}>{formatPower(ont.rx_power)}</StatusBadge>
                          <span className="muted">TX {formatPower(ont.tx_power)}</span>
                        </div>
                      </td>
                      <td>
                        <Button size="sm" variant="secondary" onClick={() => setSelectedOnt(ont)}>
                          <Eye size={14} />
                          Детали
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<RadioTower size={20} />}
              title="ONT не найдены"
              description="Измените фильтры или проверьте demo-seed GPON."
            />
          )}
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.2}>
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

      <AnimatedModal
        open={Boolean(selectedOnt)}
        onClose={() => setSelectedOnt(null)}
        title="ONT details"
        footer={
          selectedOnt ? (
            <>
              {canNocAction ? (
                <>
                  <Button variant="secondary" isLoading={ontMutation.isPending} onClick={() => runAction("refresh_status")}>
                    <RefreshCw size={16} />
                    Refresh
                  </Button>
                  <Button variant="secondary" isLoading={ontMutation.isPending} onClick={() => runAction("reboot")}>
                    <Power size={16} />
                    Reboot
                  </Button>
                  <Button
                    variant="secondary"
                    isLoading={ontMutation.isPending}
                    onClick={() => runAction("mark_rogue_suspected")}
                  >
                    <ShieldAlert size={16} />
                    Mark rogue
                  </Button>
                </>
              ) : null}
              {canAdminAction && selectedOnt.status !== "blocked" ? (
                <Button variant="danger" isLoading={ontMutation.isPending} onClick={() => runAction("block")}>
                  <Ban size={16} />
                  Block
                </Button>
              ) : null}
              {canAdminAction && selectedOnt.status === "blocked" ? (
                <Button variant="secondary" isLoading={ontMutation.isPending} onClick={() => runAction("unblock")}>
                  <RotateCcw size={16} />
                  Unblock
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {selectedOnt ? (
          <div className="cards-grid">
            <Card className="span-6 stack-md">
              <strong>Абонент</strong>
              <div className="summary-row">
                <span>ФИО</span>
                <strong>{selectedOnt.subscriber?.full_name ?? "Не указан"}</strong>
              </div>
              <div className="summary-row">
                <span>Договор</span>
                <strong>{selectedOnt.subscriber?.billing_id ?? selectedOnt.subscriber_id}</strong>
              </div>
              <div className="summary-row">
                <span>OLT</span>
                <strong>{selectedOnt.olt?.name ?? selectedOnt.olt_id}</strong>
              </div>
              <div className="summary-row">
                <span>PON-port</span>
                <strong>{selectedOnt.pon_port} / {selectedOnt.ont_id_on_port}</strong>
              </div>
            </Card>
            <Card className="span-6 stack-md">
              <strong>ONT</strong>
              <div className="summary-row">
                <span>Serial</span>
                <strong>{selectedOnt.serial_number}</strong>
              </div>
              <div className="summary-row">
                <span>MAC</span>
                <strong>{selectedOnt.mac_address ?? "Не указан"}</strong>
              </div>
              <div className="summary-row">
                <span>VLAN</span>
                <strong>{selectedOnt.vlan_id}</strong>
              </div>
              <div className="summary-row">
                <span>Статус</span>
                <div className="inline-actions">
                  <StatusBadge tone={statusTone(selectedOnt.status)}>{ontStatusLabel(selectedOnt.status)}</StatusBadge>
                  {alarmBySource.get(`ont:${selectedOnt.id}`)?.length ? (
                    <StatusBadge tone={alarmTone(alarmBySource.get(`ont:${selectedOnt.id}`) ?? [])}>
                      {`${alarmBySource.get(`ont:${selectedOnt.id}`)?.length ?? 0} alarm`}
                    </StatusBadge>
                  ) : null}
                </div>
              </div>
              <div className="summary-row">
                <span>RX / TX</span>
                <strong>{formatPower(selectedOnt.rx_power)} / {formatPower(selectedOnt.tx_power)}</strong>
              </div>
              <div className="summary-row">
                <span>Last seen</span>
                <strong>{formatDate(selectedOnt.last_seen_at)}</strong>
              </div>
            </Card>
          </div>
        ) : null}
      </AnimatedModal>
    </div>
  );
}

export default GponPage;
