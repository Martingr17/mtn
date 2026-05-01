import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { zabbixService } from "@/services/endpoints/zabbix";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { ZabbixAlarm, ZabbixAlarmType, ZabbixSeverity } from "@/types/domain";
import { formatDate } from "@/utils/format";
import { hasMvpRole } from "@/utils/roles";

const PAGE_SIZE = 20;

type AlarmCommand = "ack" | "resolve";

function severityTone(severity: string): "info" | "warning" | "danger" | "neutral" {
  if (severity === "critical") {
    return "danger";
  }
  if (severity === "high" || severity === "warning") {
    return "warning";
  }
  if (severity === "info") {
    return "info";
  }
  return "neutral";
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "resolved") {
    return "success";
  }
  if (status === "acknowledged") {
    return "warning";
  }
  if (status === "active") {
    return "danger";
  }
  return "neutral";
}

function alarmTypeLabel(value: string) {
  const labels: Record<ZabbixAlarmType, string> = {
    bgp_down: "BGP down",
    vrrp_failover: "VRRP failover",
    erps_ring_fault: "ERPS ring fault",
    olt_offline: "OLT offline",
    low_optical_power: "Low optical power",
    ups_low_battery: "UPS low battery",
    ddos_detected: "DDoS detected",
    nat_pool_high: "NAT pool high",
  };
  return labels[value as ZabbixAlarmType] ?? value;
}

function severityLabel(value: string) {
  const labels: Record<ZabbixSeverity, string> = {
    info: "Info",
    warning: "Warning",
    high: "High",
    critical: "Critical",
  };
  return labels[value as ZabbixSeverity] ?? value;
}

function metricValue(alarm: ZabbixAlarm) {
  if (alarm.metric_value === null || alarm.metric_value === undefined) {
    return "n/a";
  }
  if (alarm.metric_name === "ont.rx_power") {
    return `${alarm.metric_value.toFixed(2)} dBm`;
  }
  if (alarm.metric_name?.includes("pct")) {
    return `${alarm.metric_value.toFixed(0)}%`;
  }
  return String(alarm.metric_value);
}

function ZabbixMonitoringPage() {
  const role = useAuthStore((state: AuthState) => state.role);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [alarmType, setAlarmType] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [search, setSearch] = useState("");

  const canAction = hasMvpRole(role, ["noc_engineer"]);

  const summaryQuery = useQuery({
    queryKey: ["zabbix", "summary"],
    queryFn: () => zabbixService.summary(),
  });

  const alarmsQuery = useQuery({
    queryKey: ["zabbix", "alarms", page, severity, status, alarmType, sourceType, search],
    queryFn: () =>
      zabbixService.alarms({
        page,
        page_size: PAGE_SIZE,
        severity,
        status,
        alarm_type: alarmType,
        source_type: sourceType,
        search: search || undefined,
      }),
  });

  const alarmMutation = useMutation({
    mutationFn: (payload: { command: AlarmCommand; alarm: ZabbixAlarm }) => {
      if (payload.command === "ack") {
        return zabbixService.acknowledge(payload.alarm.id);
      }
      return zabbixService.resolve(payload.alarm.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["zabbix"] });
      toast.success("Zabbix mock alarm updated.");
    },
    onError: () => {
      toast.error("Failed to update Zabbix mock alarm.");
    },
  });

  const refreshMutation = useMutation({
    mutationFn: zabbixService.refresh,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["zabbix"] });
      toast.success(`Zabbix mock refreshed: ${result.refreshed} updated, ${result.created} created.`);
    },
    onError: () => {
      toast.error("Failed to refresh Zabbix mock alarms.");
    },
  });

  const alarms = alarmsQuery.data?.items ?? [];
  const totalPages = alarmsQuery.data?.total_pages ?? Math.max(1, Math.ceil((alarmsQuery.data?.total ?? 0) / PAGE_SIZE));
  const summary = summaryQuery.data;

  return (
    <div className="stack-lg">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Monitoring / Zabbix"
            title="Zabbix alarms mock"
            description="Network alarm console for BGP, VRRP, ERPS, OLT, ONT optical power, UPS, CGNAT and DDoS events without real Zabbix API calls."
            actions={
              canAction ? (
                <Button
                  variant="secondary"
                  isLoading={refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>
              ) : null
            }
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <Card className="span-2 metric-card">
          <span className="metric-label">Active</span>
          <div className="metric-value">{summary?.active ?? 0}</div>
        </Card>
        <Card className="span-2 metric-card">
          <span className="metric-label">Critical</span>
          <div className="metric-value">{summary?.critical ?? 0}</div>
        </Card>
        <Card className="span-2 metric-card">
          <span className="metric-label">High</span>
          <div className="metric-value">{summary?.high ?? 0}</div>
        </Card>
        <Card className="span-2 metric-card">
          <span className="metric-label">Warning</span>
          <div className="metric-value">{summary?.warning ?? 0}</div>
        </Card>
        <Card className="span-2 metric-card">
          <span className="metric-label">Resolved</span>
          <div className="metric-value">{summary?.resolved ?? 0}</div>
        </Card>
        <Card className="span-2 metric-card">
          <span className="metric-label">Ack</span>
          <div className="metric-value">{summary?.acknowledged ?? 0}</div>
        </Card>
      </div>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          <div className="cards-grid">
            <label className="field span-2" htmlFor="zbx-severity">
              <span>Severity</span>
              <select
                id="zbx-severity"
                value={severity}
                onChange={(event) => {
                  setSeverity(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label className="field span-2" htmlFor="zbx-status">
              <span>Status</span>
              <select
                id="zbx-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label className="field span-3" htmlFor="zbx-type">
              <span>Alarm type</span>
              <select
                id="zbx-type"
                value={alarmType}
                onChange={(event) => {
                  setAlarmType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="bgp_down">BGP down</option>
                <option value="vrrp_failover">VRRP failover</option>
                <option value="erps_ring_fault">ERPS ring fault</option>
                <option value="olt_offline">OLT offline</option>
                <option value="low_optical_power">Low optical power</option>
                <option value="ups_low_battery">UPS low battery</option>
                <option value="nat_pool_high">NAT pool high</option>
                <option value="ddos_detected">DDoS detected</option>
              </select>
            </label>
            <label className="field span-2" htmlFor="zbx-source">
              <span>Source</span>
              <select
                id="zbx-source"
                value={sourceType}
                onChange={(event) => {
                  setSourceType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="core_router">Core router</option>
                <option value="aggregation_switch">Aggregation</option>
                <option value="olt">OLT</option>
                <option value="ont">ONT</option>
                <option value="ups">UPS</option>
                <option value="external">External</option>
              </select>
            </label>
            <label className="field span-3" htmlFor="zbx-search">
              <span>Search</span>
              <input
                id="zbx-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Source, title, metric"
              />
            </label>
          </div>
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="table-shell stack-md">
          <div className="toolbar-row">
            <div className="inline-actions">
              <ShieldAlert size={18} />
              <strong>Alarms</strong>
            </div>
            <span className="muted">{alarmsQuery.data?.total ?? 0} events</span>
          </div>

          {alarms.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Alarm</th>
                    <th>Source</th>
                    <th>Metric</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Last seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alarms.map((alarm) => (
                    <tr key={alarm.id}>
                      <td>
                        <div className="stack-sm">
                          <strong>{alarm.title}</strong>
                          <span className="muted">{alarmTypeLabel(alarm.alarm_type)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{alarm.source_name}</strong>
                          <span className="muted">{alarm.source_type}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{metricValue(alarm)}</strong>
                          <span className="muted">{alarm.metric_name ?? "metric"}</span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={severityTone(alarm.severity)}>{severityLabel(alarm.severity)}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(alarm.status)}>{alarm.status}</StatusBadge>
                      </td>
                      <td>{formatDate(alarm.last_seen_at)}</td>
                      <td>
                        <div className="inline-actions">
                          {canAction && alarm.status === "active" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={alarmMutation.isPending}
                              onClick={() => alarmMutation.mutate({ command: "ack", alarm })}
                            >
                              <AlertTriangle size={14} />
                              Ack
                            </Button>
                          ) : null}
                          {canAction && alarm.status !== "resolved" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={alarmMutation.isPending}
                              onClick={() => alarmMutation.mutate({ command: "resolve", alarm })}
                            >
                              <CheckCircle2 size={14} />
                              Resolve
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
              icon={<ShieldAlert size={20} />}
              title="No Zabbix alarms"
              description="Change filters or run mock refresh to create demo monitoring events."
            />
          )}
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.15}>
        <div className="toolbar-row">
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <div className="inline-actions">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Back
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </AnimatedReveal>
    </div>
  );
}

export default ZabbixMonitoringPage;
