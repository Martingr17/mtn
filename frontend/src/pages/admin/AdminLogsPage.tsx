import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { FileText, RotateCw } from "lucide-react";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { adminService } from "@/services/endpoints/admin";
import { formatDate } from "@/utils/format";

const LEVEL_OPTIONS = [
  { value: "all", label: "Все уровни" },
  { value: "error", label: "Ошибки" },
  { value: "warning", label: "Предупреждения" },
  { value: "info", label: "Информация" },
];

function getLogTone(level: string): "neutral" | "info" | "warning" | "danger" {
  if (level === "error" || level === "critical") {
    return "danger";
  }
  if (level === "warning") {
    return "warning";
  }
  if (level === "info") {
    return "info";
  }
  return "neutral";
}

function formatLogLevel(level: string) {
  if (level === "error" || level === "critical") {
    return "Ошибка";
  }
  if (level === "warning") {
    return "Предупреждение";
  }
  if (level === "info") {
    return "Информация";
  }
  return level || "Событие";
}

function AdminLogsPage() {
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState("all");

  const logsQuery = useQuery({
    queryKey: ["admin-logs", page, level],
    queryFn: () => adminService.logs(page, 30, level),
  });

  const logs = logsQuery.data?.items ?? [];
  const totalPages = logsQuery.data?.total_pages ?? 1;

  return (
    <div className="stack-lg admin-logs-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель / Журналы"
            title="Системные логи"
            description="Последние backend-события, ошибки и предупреждения для быстрой проверки demo-стенда перед защитой."
            actions={
              <Button variant="secondary" onClick={() => logsQuery.refetch()} isLoading={logsQuery.isFetching}>
                <RotateCw size={16} />
                Обновить
              </Button>
            }
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          <div className="toolbar-row">
            <div className="inline-actions">
              <FileText size={18} />
              <strong>Записи журнала</strong>
            </div>
            <div className="inline-actions">
              <label className="sr-only" htmlFor="admin-logs-level">
                Уровень логов
              </label>
              <select
                id="admin-logs-level"
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value);
                  setPage(1);
                }}
              >
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {logs.length ? (
            <div className="data-list">
              {logs.map((log, index) => {
                const levelValue = String(log.level ?? "info").toLowerCase();
                const timestamp = String(log.timestamp ?? log.created_at ?? "");
                const logger = String(log.logger ?? log.component ?? "app");
                const message = String(log.message ?? log.event ?? "Системное событие");

                return (
                  <div key={`${timestamp}-${index}`} className="list-item">
                    <div>
                      <div className="inline-actions">
                        <StatusBadge tone={getLogTone(levelValue)}>{formatLogLevel(levelValue)}</StatusBadge>
                        <strong>{message}</strong>
                      </div>
                      <p className="muted">
                        {logger} · {timestamp ? formatDate(timestamp) : "время не указано"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={logsQuery.isFetching ? "Загружаем логи" : "Логи не найдены"}
              description={
                logsQuery.isFetching
                  ? "Получаем последние записи backend-журнала."
                  : "Для выбранного уровня пока нет записей. Попробуйте другой фильтр или обновите список."
              }
              icon={<FileText size={20} />}
            />
          )}

          <div className="toolbar-row">
            <span className="muted">
              Страница {page} из {totalPages}
            </span>
            <div className="inline-actions">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Назад
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Вперед
              </Button>
            </div>
          </div>
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default AdminLogsPage;
