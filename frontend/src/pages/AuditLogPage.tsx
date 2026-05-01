import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Search, ScrollText } from "lucide-react";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { auditService } from "@/services/endpoints/audit";
import type { AuditLogItem } from "@/types/domain";
import { formatDate } from "@/utils/format";

const PAGE_SIZE = 20;

function toneForAction(action: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (action.includes("resolve") || action.includes("unblock") || action.includes("sent")) {
    return "success";
  }
  if (action.includes("block") || action.includes("critical") || action.includes("failed")) {
    return "danger";
  }
  if (action.includes("ack") || action.includes("refresh") || action.includes("skipped")) {
    return "warning";
  }
  if (action.includes("create") || action.includes("start")) {
    return "info";
  }
  return "neutral";
}

function changeSummary(item: AuditLogItem) {
  if (!item.changes) {
    return item.reason ?? "n/a";
  }

  const keys = Object.keys(item.changes).slice(0, 3);
  if (!keys.length) {
    return item.reason ?? "n/a";
  }
  return keys.join(", ");
}

function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [actor, setActor] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const queryParams = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      entity_type: entityType,
      action,
      actor: actor || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [action, actor, dateFrom, dateTo, entityType, page],
  );

  const auditQuery = useQuery({
    queryKey: ["audit", queryParams],
    queryFn: () => auditService.list(queryParams),
  });

  const items = auditQuery.data?.items ?? [];
  const totalPages = auditQuery.data?.total_pages ?? Math.max(1, Math.ceil((auditQuery.data?.total ?? 0) / PAGE_SIZE));

  const resetFilters = () => {
    setEntityType("all");
    setAction("all");
    setActor("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  return (
    <div className="stack-lg">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Admin / Audit"
            title="Audit log"
            description="Unified audit trail for write actions in RADIUS, GPON, Zabbix, NOC incidents and Telegram alerts."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          <div className="cards-grid audit-filter-grid">
            <label className="field span-2" htmlFor="audit-entity">
              <span>Entity type</span>
              <select
                id="audit-entity"
                value={entityType}
                onChange={(event) => {
                  setEntityType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="radius_session">RADIUS session</option>
                <option value="ont">ONT</option>
                <option value="zabbix_alarm">Zabbix alarm</option>
                <option value="noc_incident">NOC incident</option>
                <option value="telegram_alert">Telegram alert</option>
              </select>
            </label>
            <label className="field span-2" htmlFor="audit-action">
              <span>Action</span>
              <select
                id="audit-action"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="block">radius block</option>
                <option value="unblock">radius unblock</option>
                <option value="disconnect">radius disconnect</option>
                <option value="change_speed">radius change speed</option>
                <option value="gpon_reboot">gpon reboot</option>
                <option value="gpon_block">gpon block</option>
                <option value="gpon_unblock">gpon unblock</option>
                <option value="gpon_mark_rogue_suspected">gpon mark rogue</option>
                <option value="gpon_refresh_status">gpon refresh</option>
                <option value="zabbix_ack">zabbix ack</option>
                <option value="zabbix_resolve">zabbix resolve</option>
                <option value="incident_create">incident create</option>
                <option value="incident_create_from_alarm">incident from alarm</option>
                <option value="incident_ack">incident ack</option>
                <option value="incident_start">incident start</option>
                <option value="incident_resolve">incident resolve</option>
                <option value="incident_close">incident close</option>
                <option value="incident_assign">incident assign</option>
                <option value="telegram_sent">telegram sent</option>
                <option value="telegram_skipped">telegram skipped</option>
                <option value="telegram_failed">telegram failed</option>
              </select>
            </label>
            <label className="field span-2" htmlFor="audit-actor">
              <span>Actor</span>
              <input
                id="audit-actor"
                value={actor}
                onChange={(event) => {
                  setActor(event.target.value);
                  setPage(1);
                }}
                placeholder="Name, phone, email"
              />
            </label>
            <label className="field span-2" htmlFor="audit-from">
              <span>Date from</span>
              <input
                id="audit-from"
                type="datetime-local"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="field span-2" htmlFor="audit-to">
              <span>Date to</span>
              <input
                id="audit-to"
                type="datetime-local"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="field span-2 audit-reset-field">
              <span>&nbsp;</span>
              <Button variant="secondary" onClick={resetFilters}>
                <Search size={16} />
                Reset
              </Button>
            </div>
          </div>
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="table-shell stack-md">
          <div className="toolbar-row">
            <div className="inline-actions">
              <ScrollText size={18} />
              <strong>Events</strong>
            </div>
            <span className="muted">{auditQuery.data?.total ?? 0} records</span>
          </div>

          {items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Entity</th>
                    <th>Action</th>
                    <th>Changes</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.created_at)}</td>
                      <td>
                        <div className="stack-sm">
                          <strong>{item.actor?.full_name ?? `User #${item.user_id ?? "system"}`}</strong>
                          <span className="muted">{item.actor?.role ?? "system"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{item.entity_type}</strong>
                          <span className="muted">#{item.entity_id}</span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={toneForAction(item.action)}>{item.action}</StatusBadge>
                      </td>
                      <td>{changeSummary(item)}</td>
                      <td>{item.ip_address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<ScrollText size={20} />}
              title="No audit records"
              description="Run a demo write action in RADIUS, GPON, Zabbix, NOC or Telegram to populate the audit trail."
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

export default AuditLogPage;
