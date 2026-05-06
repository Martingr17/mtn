import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Siren } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { incidentsService } from "@/services/endpoints/incidents";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { AffectedService, IncidentCreatePayload, IncidentSeverity, NocIncident } from "@/types/domain";
import { formatDate } from "@/utils/format";
import { hasMvpRole } from "@/utils/roles";

const PAGE_SIZE = 20;

const DEFAULT_FORM: IncidentCreatePayload = {
  title: "",
  description: "",
  severity: "medium",
  affected_service: "other",
  affected_subscribers_count: 0,
};

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

function countBy(items: NocIncident[], predicate: (item: NocIncident) => boolean) {
  return items.filter(predicate).length;
}

function getIncidentAlarms(incident: NocIncident) {
  return Array.isArray(incident.alarms) ? incident.alarms : [];
}

function NocIncidentsPage() {
  const role = useAuthStore((state: AuthState) => state.role);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [affectedService, setAffectedService] = useState("all");
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<IncidentCreatePayload>(DEFAULT_FORM);

  const canCreate = hasMvpRole(role, ["noc_engineer"]);

  const incidentsQuery = useQuery({
    queryKey: ["incidents", page, status, severity, affectedService, source, search],
    queryFn: () =>
      incidentsService.list({
        page,
        page_size: PAGE_SIZE,
        status,
        severity,
        affected_service: affectedService,
        source,
        search: search || undefined,
      }),
  });

  const summaryQuery = useQuery({
    queryKey: ["incidents", "summary"],
    queryFn: () => incidentsService.list({ page_size: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      incidentsService.create({
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || undefined,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
      setModalOpen(false);
      setForm(DEFAULT_FORM);
      toast.success(`Incident #${result.incident.id} created.`);
    },
    onError: () => {
      toast.error("Failed to create NOC incident.");
    },
  });

  const incidents = incidentsQuery.data?.items ?? [];
  const totalPages = incidentsQuery.data?.total_pages ?? Math.max(1, Math.ceil((incidentsQuery.data?.total ?? 0) / PAGE_SIZE));
  const summaryItems = summaryQuery.data?.items ?? [];
  const summary = {
    new: countBy(summaryItems, (item) => item.status === "new"),
    inProgress: countBy(summaryItems, (item) => item.status === "in_progress"),
    critical: countBy(summaryItems, (item) => item.severity === "critical" && item.status !== "closed"),
    resolved: countBy(summaryItems, (item) => item.status === "resolved"),
  };

  return (
    <div className="stack-lg">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="NOC"
            title="NOC incidents"
            description="Operational incident board linking Zabbix alarms with engineer workflow, assignment and resolution status."
            actions={
              canCreate ? (
                <Button onClick={() => setModalOpen(true)}>
                  <Plus size={16} />
                  Create manual
                </Button>
              ) : null
            }
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <Card className="span-3 metric-card">
          <span className="metric-label">New</span>
          <div className="metric-value">{summary.new}</div>
        </Card>
        <Card className="span-3 metric-card">
          <span className="metric-label">In progress</span>
          <div className="metric-value">{summary.inProgress}</div>
        </Card>
        <Card className="span-3 metric-card">
          <span className="metric-label">Critical</span>
          <div className="metric-value">{summary.critical}</div>
        </Card>
        <Card className="span-3 metric-card">
          <span className="metric-label">Resolved</span>
          <div className="metric-value">{summary.resolved}</div>
        </Card>
      </div>

      <Card className="stack-md">
        <div className="cards-grid">
          <label className="field span-2" htmlFor="incident-status">
            <span>Status</span>
            <select
              id="incident-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="field span-2" htmlFor="incident-severity">
            <span>Severity</span>
            <select
              id="incident-severity"
              value={severity}
              onChange={(event) => {
                setSeverity(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="field span-2" htmlFor="incident-service">
            <span>Service</span>
            <select
              id="incident-service"
              value={affectedService}
              onChange={(event) => {
                setAffectedService(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="bgp">BGP</option>
              <option value="vrrp">VRRP</option>
              <option value="erps">ERPS</option>
              <option value="gpon">GPON</option>
              <option value="olt">OLT</option>
              <option value="ont">ONT</option>
              <option value="cgnat">CGNAT</option>
              <option value="ups">UPS</option>
              <option value="ddos">DDoS</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field span-2" htmlFor="incident-source">
            <span>Source</span>
            <select
              id="incident-source"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="manual">Manual</option>
              <option value="zabbix">Zabbix</option>
            </select>
          </label>
          <label className="field span-4" htmlFor="incident-search">
            <span>Search</span>
            <input
              id="incident-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Title or description"
            />
          </label>
        </div>
      </Card>

      <Card className="table-shell stack-md">
        <div className="toolbar-row">
          <div className="inline-actions">
            <Siren size={18} />
            <strong>Incidents</strong>
          </div>
          <span className="muted">{incidentsQuery.data?.total ?? 0} incidents</span>
        </div>

        {incidents.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Service</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Engineer</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => {
                  const alarms = getIncidentAlarms(incident);

                  return (
                    <tr key={incident.id}>
                      <td>
                        <div className="stack-sm">
                          <Link className="link-line" to={`/noc/incidents/${incident.id}`}>
                            <strong>#{incident.id} {incident.title}</strong>
                          </Link>
                          <span className="muted">{incident.source} source · {alarms.length} alarms</span>
                        </div>
                      </td>
                      <td>{incident.affected_service}</td>
                      <td>
                        <StatusBadge tone={severityTone(incident.severity)}>{incident.severity}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(incident.status)}>{incident.status}</StatusBadge>
                      </td>
                      <td>{incident.assigned_user?.full_name ?? "Unassigned"}</td>
                      <td>{formatDate(incident.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<AlertTriangle size={20} />}
            title="No incidents"
            description="Change filters or create the first manual NOC incident."
          />
        )}
      </Card>

      <div className="toolbar-row">
        <span className="muted">Page {page} of {totalPages}</span>
        <div className="inline-actions">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Back
          </Button>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
            Next
          </Button>
        </div>
      </div>

      <AnimatedModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create manual incident"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!form.title.trim()}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </>
        }
      >
        <label className="field" htmlFor="manual-incident-title">
          <span>Title</span>
          <input
            id="manual-incident-title"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Example: Aggregation uplink degradation"
          />
        </label>
        <label className="field" htmlFor="manual-incident-description">
          <span>Description</span>
          <textarea
            id="manual-incident-description"
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            rows={4}
          />
        </label>
        <div className="form-grid">
          <label className="field" htmlFor="manual-incident-severity">
            <span>Severity</span>
            <select
              id="manual-incident-severity"
              value={form.severity}
              onChange={(event) =>
                setForm((current) => ({ ...current, severity: event.target.value as IncidentSeverity }))
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="field" htmlFor="manual-incident-service">
            <span>Service</span>
            <select
              id="manual-incident-service"
              value={form.affected_service}
              onChange={(event) =>
                setForm((current) => ({ ...current, affected_service: event.target.value as AffectedService }))
              }
            >
              <option value="bgp">BGP</option>
              <option value="vrrp">VRRP</option>
              <option value="erps">ERPS</option>
              <option value="gpon">GPON</option>
              <option value="olt">OLT</option>
              <option value="ont">ONT</option>
              <option value="cgnat">CGNAT</option>
              <option value="ups">UPS</option>
              <option value="ddos">DDoS</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field" htmlFor="manual-incident-subscribers">
            <span>Affected subscribers</span>
            <input
              id="manual-incident-subscribers"
              type="number"
              min={0}
              value={form.affected_subscribers_count ?? 0}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  affected_subscribers_count: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
        </div>
      </AnimatedModal>
    </div>
  );
}

export default NocIncidentsPage;
