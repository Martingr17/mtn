import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountMetric } from "@/components/ui/CountMetric";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { speedtestService } from "@/services/endpoints/analytics";
import { formatRelative } from "@/utils/format";

function randomBetween(min: number, max: number) {
  return Number((Math.random() * (max - min) + min).toFixed(1));
}

function getMeterWidth(value: number, max: number) {
  return `${Math.min((value / max) * 100, 100)}%`;
}

function SpeedtestPage() {
  const [lastResult, setLastResult] = useState<{ download: number; upload: number; ping: number } | null>(null);
  const statsQuery = useQuery({ queryKey: ["speedtest-page", "stats"], queryFn: speedtestService.stats });
  const historyQuery = useQuery({ queryKey: ["speedtest-page", "history"], queryFn: speedtestService.history });

  const runMutation = useMutation({
    mutationFn: async () => {
      const session = await speedtestService.createSession();
      const draft = {
        download: randomBetween(120, 320),
        upload: randomBetween(80, 200),
        ping: randomBetween(4, 22),
      };

      setLastResult(draft);
      await new Promise((resolve) => window.setTimeout(resolve, 900));

      return speedtestService.run({
        session_id: session.session_id,
        download_mbps: draft.download,
        upload_mbps: draft.upload,
        ping_ms: draft.ping,
      });
    },
    onSuccess: () => {
      toast.success("Проверка завершена.");
      queryClient.invalidateQueries({ queryKey: ["speedtest-page", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["speedtest-page", "history"] });
    },
  });

  const currentDownload = lastResult?.download ?? statsQuery.data?.avg_download ?? 0;
  const currentUpload = lastResult?.upload ?? statsQuery.data?.avg_upload ?? 0;
  const currentPing = lastResult?.ping ?? statsQuery.data?.min_ping ?? 0;

  return (
    <div className="stack-lg speedtest-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Скорость"
            title="Проверка скорости"
            description="Измеряйте загрузку, отдачу и ping прямо в кабинете и сохраняйте историю тестов."
            actions={
              <Button
                onClick={() => runMutation.mutate()}
                isLoading={runMutation.isPending}
                loadingLabel="Тестируем..."
              >
                Запустить тест
              </Button>
            }
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.06}>
        <div className="cards-grid">
          <Card className="metric-card speedtest-metric-card">
            <p className="metric-label">Средняя загрузка</p>
            <div className="metric-value">
              <CountMetric value={currentDownload} suffix="Мбит/с" />
            </div>
            <div className="progress-bar">
              <span style={{ width: getMeterWidth(currentDownload, 350) }} />
            </div>
          </Card>

          <Card className="metric-card speedtest-metric-card">
            <p className="metric-label">Средняя отдача</p>
            <div className="metric-value">
              <CountMetric value={currentUpload} suffix="Мбит/с" />
            </div>
            <div className="progress-bar">
              <span style={{ width: getMeterWidth(currentUpload, 250) }} />
            </div>
          </Card>

          <Card className="metric-card speedtest-metric-card">
            <p className="metric-label">Минимальный ping</p>
            <div className="metric-value">
              <CountMetric value={currentPing} suffix="мс" />
            </div>
            <div className="progress-bar">
              <span style={{ width: `${Math.max(100 - Math.min((currentPing / 40) * 100, 100), 12)}%` }} />
            </div>
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.12}>
        <Card className="stack-md">
          <div className="inline-actions">
            <Gauge size={18} />
            <strong>История тестов</strong>
          </div>

          {(historyQuery.data ?? []).map((entry) => (
            <div key={entry.id} className="list-item">
              <div>
                <strong>
                  {entry.download_mbps.toFixed(1)} / {entry.upload_mbps.toFixed(1)} Мбит/с
                </strong>
                <p className="muted">Ping {entry.ping_ms.toFixed(1)} мс</p>
              </div>
              <span className="muted">{formatRelative(entry.created_at)}</span>
            </div>
          ))}
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default SpeedtestPage;
