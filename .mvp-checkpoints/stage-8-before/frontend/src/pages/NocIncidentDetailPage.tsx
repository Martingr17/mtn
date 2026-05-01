import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Play, RotateCcw, Send, UserCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { incidentsService } from "@/services/endpoints/incidents";
import { telegramAlertsService } from "@/services/endpoints/telegram-alerts";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { NocIncident } from "@/types/domain";
import { formatDate } from "@/utils/format";
import { hasMvpRole } from "@/utils/roles";

type IncidentCommand = "ack" | "start" | "resolve" | "close" | "assign_self";

function severityTone(severity: string): "success" | "warning" | "danger" | "neutral" {
  if (severity === "critical") {
    return "danger";
  }
  if (severity === "high" || severity === "medium") {
    return "warning";
  }
  if (severity === "low") {
    return "success";
  }
  return "neutral";
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "resolved" || status === "closed") {
    return "success";
  }
  if (status === "in_progress" || status === "acknowledged") {
    return "warning";
  }
  if (status === "new") {
    return "danger";
  }
  return "neutral";
}

function alarmSeverityTone(severity: string): "info" | "warning" | "danger" | "neutral" {
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

function timeline(incident: NocIncident) {
  return [
    { label: "Created", value: incident.created_at },
    { label: "Acknowledged", value: incident.acknowledged_at },
    { label: "Started", value: incident.started_at },
    { label: "Resolved", value: incident.resolved_at },
    { label: "Closed", value: incident.closed_at },
  ];
}

function NocIncidentDetailPage() {
  const { id } = useParams();
  const incidentId = id ?? "";
  const role = useAuthStore((state: AuthState) => state.role);
  const user = useAuthStore((state: AuthState) => state.user);
  const queryClient = useQueryClient();
  const canNocAction = hasMvpRole(role, ["noc_engineer"]);
  const canAdminAction = hasMvpRole(role, ["admin"]);

  const incidentQuery = useQuery({
    queryKey: ["incidents", incidentId],
    queryFn: () => incidentsService.detail(incidentId),
    enabled: Boolean(incidentId),
  });

  const actionMutation = useMutation({
    mutationFn: (command: IncidentCommand) => {
      if (command === "ack") {
        return incidentsService.acknowledge(incidentId);
      }
      if (command === "start") {
        return incidentsService.start(incidentId);
      }
      if (command === "resolve") {
        return incidentsService.resolve(incidentId);
      }
      if (command === "close") {
        return incidentsService.close(incidentId);
      }
      return incidentsService.assign(incidentId, Number(user?.id));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
      toast.success("Incident updated.");
    },
    onError: () => {
      toast.error("Failed to update incident.");
    },
  });
  const telegramMutation = useMutation({
    mutationFn: () => telegramAlertsService.sendIncident(incidentId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["telegram-alerts"] });
      toast.success(`Telegram alert ${result.alert.status}.`);
    },
    onError: () => {
      toast.error("Failed to send Telegram alert.");
    },
  });

  if (incidentQuery.isLoading) {
    return (
      <div className="stack-lg">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-card" />
        <Skeleton className="skeleton-card" />
      </div>
    );
  }

  if (!incidentQuery.data) {
    return (
      <Card>
        <EmptyState title="Incident not found" description="Check the incident ID or return to the NOC board." />
      </Card>
    );
  }

  const incident = incidentQuery.data;

  return (
    <div className="stack-lg">
      <Link className="link-line" to="/noc/incidents">
        <ArrowLeft size={16} /> Back to incidents
      </Link>

      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow={`NOC / Incident #${incident.id}`}
            title={incident.title}
            description={incident.description ?? "No description provided."}
            actions={
              <div className="inline-actions">
                <StatusBadge tone={severityTone(incident.severity)}>{incident.severity}</StatusBadge>
                <StatusBadge tone={statusTone(incident.status)}>{incident.status}</StatusBadge>
              </div>
            }
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <Card className="span-5 stack-md">
          <strong>Incident</strong>
          <div className="summary-row">
            <span>Service</span>
            <strong>{incident.affected_service}</strong>
          </div>
          <div className="summary-row">
            <span>Source</span>
            <strong>{incident.source}</strong>
          </div>
          <div className="summary-row">
            <span>Affected subscribers</span>
            <strong>{incident.affected_subscribers_count}</strong>
          </div>
          <div className="summary-row">
            <span>Assigned engineer</span>
            <strong>{incident.assigned_user?.full_name ?? "Unassigned"}</strong>
          </div>
          <div className="summary-row">
            <span>Created by</span>
            <strong>{incident.created_by_user?.full_name ?? incident.created_by ?? "n/a"}</strong>
          </div>
        </Card>

        <Card className="span-7 stack-md">
          <strong>Workflow</strong>
          <div className="inline-actions">
            {canNocAction && incident.status === "new" ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={actionMutation.isPending}
                onClick={() => actionMutation.mutate("ack")}
              >
                <CheckCircle2 size={14} />
                Ack
              </Button>
            ) : null}
            {canNocAction && incident.status !== "in_progress" && incident.status !== "closed" ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={actionMutation.isPending}
                onClick={() => actionMutation.mutate("start")}
              >
                <Play size={14} />
                Start
              </Button>
            ) : null}
            {canNocAction && incident.status !== "resolved" && incident.status !== "closed" ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={actionMutation.isPending}
                onClick={() => actionMutation.mutate("resolve")}
              >
                <CheckCircle2 size={14} />
                Resolve
              </Button>
            ) : null}
            {canNocAction && user?.id ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={actionMutation.isPending}
                onClick={() => actionMutation.mutate("assign_self")}
              >
                <UserCheck size={14} />
                Assign to me
              </Button>
            ) : null}
            {canAdminAction && incident.status !== "closed" ? (
              <Button
                size="sm"
                variant="danger"
                isLoading={actionMutation.isPending}
                onClick={() => actionMutation.mutate("close")}
              >
                <RotateCcw size={14} />
                Close
              </Button>
            ) : null}
            {(canNocAction || canAdminAction) && incident.severity === "critical" ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={telegramMutation.isPending}
                onClick={() => telegramMutation.mutate()}
              >
                <Send size={14} />
                Send Telegram alert
              </Button>
            ) : null}
          </div>
          {timeline(incident).map((item) => (
            <div key={item.label} className="summary-row">
              <span>{item.label}</span>
              <strong>{item.value ? formatDate(item.value) : "Pending"}</strong>
            </div>
          ))}
        </Card>
      </div>

      <AnimatedReveal delay={0.08}>
        <Card className="table-shell stack-md">
          <div className="toolbar-row">
            <strong>Linked Zabbix alarms</strong>
            <span className="muted">{incident.alarms.length} alarms</span>
          </div>

          {incident.alarms.length ? (
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
                  </tr>
                </thead>
                <tbody>
                  {incident.alarms.map((alarm) => (
                    <tr key={alarm.id}>
                      <td>
                        <div className="stack-sm">
                          <strong>{alarm.title}</strong>
                          <span className="muted">{alarm.alarm_type}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{alarm.source_name}</strong>
                          <span className="muted">{alarm.source_type}</span>
                        </div>
                      </td>
                      <td>{alarm.metric_name ?? "metric"}: {alarm.metric_value ?? "n/a"}</td>
                      <td>
                        <StatusBadge tone={alarmSeverityTone(alarm.severity)}>{alarm.severity}</StatusBadge>
                      </td>
                      <td>{alarm.status}</td>
                      <td>{formatDate(alarm.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No linked alarms"
              description="Manual incidents can be handled without a Zabbix alarm link."
            />
          )}
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default NocIncidentDetailPage;
