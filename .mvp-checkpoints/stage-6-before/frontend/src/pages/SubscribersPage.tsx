import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Link } from "react-router-dom";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { subscribersService } from "@/services/endpoints/subscribers";
import { formatCurrency, formatDate, formatSpeed } from "@/utils/format";

const PAGE_SIZE = 20;

function statusTone(status: string): "success" | "warning" | "danger" {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "inactive") {
    return "warning";
  }
  return "success";
}

function SubscribersPage() {
  const [page, setPage] = useState(1);
  const [contract, setContract] = useState("");
  const [search, setSearch] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState("all");

  const subscribersQuery = useQuery({
    queryKey: ["subscribers", page, contract, search, address, status],
    queryFn: () =>
      subscribersService.list({
        page,
        page_size: PAGE_SIZE,
        contract: contract || undefined,
        search: search || undefined,
        address: address || undefined,
        status,
      }),
  });

  const items = subscribersQuery.data?.items ?? [];
  const totalPages =
    subscribersQuery.data?.total_pages ?? Math.max(1, Math.ceil((subscribersQuery.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="stack-lg">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="OSS/BSS MVP / Абоненты"
            title="Карточки абонентов"
            description="Единый список абонентов с договором, контактами, адресом подключения, тарифом, балансом и состоянием услуги."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          <div className="cards-grid">
            <label className="field span-3" htmlFor="subscriber-contract">
              <span>Номер договора</span>
              <input
                id="subscriber-contract"
                value={contract}
                onChange={(event) => {
                  setContract(event.target.value);
                  setPage(1);
                }}
                placeholder="DEMO90001"
              />
            </label>

            <label className="field span-3" htmlFor="subscriber-search">
              <span>ФИО, email, телефон</span>
              <input
                id="subscriber-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="+7900, ivan@example.ru"
              />
            </label>

            <label className="field span-3" htmlFor="subscriber-address">
              <span>Адрес</span>
              <input
                id="subscriber-address"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setPage(1);
                }}
                placeholder="улица, дом"
              />
            </label>

            <label className="field span-3" htmlFor="subscriber-status">
              <span>Статус</span>
              <select
                id="subscriber-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="blocked">Заблокированные</option>
                <option value="inactive">Неактивные</option>
              </select>
            </label>
          </div>
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="table-shell">
          {items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Абонент</th>
                    <th>Договор</th>
                    <th>Адрес</th>
                    <th>Тариф</th>
                    <th>Баланс</th>
                    <th>Заявки</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((subscriber) => (
                    <tr key={subscriber.id} className="table-row-interactive">
                      <td>
                        <div className="stack-sm">
                          <Link className="link-line" to={`/subscribers/${subscriber.id}`}>
                            <strong>{subscriber.full_name}</strong>
                          </Link>
                          <span className="muted">
                            {subscriber.phone} / {subscriber.email || "email не указан"}
                          </span>
                        </div>
                      </td>
                      <td>{subscriber.billing_id}</td>
                      <td>{subscriber.connection_address || "Не указан"}</td>
                      <td>
                        <div className="stack-sm">
                          <strong>{subscriber.current_tariff?.name || "Не назначен"}</strong>
                          <span className="muted">{formatSpeed(subscriber.current_tariff?.speed_mbps ?? 0)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack-sm">
                          <strong>{formatCurrency(subscriber.balance ?? 0)}</strong>
                          <span className="muted">
                            Платеж: {formatDate(subscriber.last_payment_at, "d MMM yyyy")}
                          </span>
                        </div>
                      </td>
                      <td>{subscriber.open_tickets} / {subscriber.total_tickets}</td>
                      <td>
                        <StatusBadge tone={statusTone(subscriber.service_status)}>
                          {subscriber.service_status_label}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Users size={20} />}
              title="Абоненты не найдены"
              description="Измените фильтры или сбросьте поиск, чтобы снова увидеть абонентскую базу."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setContract("");
                    setSearch("");
                    setAddress("");
                    setStatus("all");
                    setPage(1);
                  }}
                >
                  Сбросить фильтры
                </Button>
              }
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
    </div>
  );
}

export default SubscribersPage;
