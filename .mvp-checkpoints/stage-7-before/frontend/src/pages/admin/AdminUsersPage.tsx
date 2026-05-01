import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { adminService } from "@/services/endpoints/admin";
import { getSafeDisplayName } from "@/utils/display-name";
import { formatCurrency, formatDate } from "@/utils/format";

const PAGE_SIZE = 20;

function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<{ id: string; type: "block" | "unblock" | null }>(
    {
      id: "",
      type: null,
    },
  );

  const usersQuery = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () =>
      adminService.listUsers({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
      }),
  });

  const blockMutation = useMutation({
    mutationFn: (userId: string) => adminService.blockUser(userId),
    onMutate: (userId) => {
      setPendingAction({ id: userId, type: "block" });
    },
    onSuccess: () => {
      toast.success("Пользователь заблокирован.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("Не удалось заблокировать пользователя."),
    onSettled: () => {
      setPendingAction({ id: "", type: null });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => adminService.unblockUser(userId),
    onMutate: (userId) => {
      setPendingAction({ id: userId, type: "unblock" });
    },
    onSuccess: () => {
      toast.success("Доступ восстановлен.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("Не удалось восстановить доступ."),
    onSettled: () => {
      setPendingAction({ id: "", type: null });
    },
  });

  const items = usersQuery.data?.items ?? [];
  const totalPages =
    usersQuery.data?.total_pages ?? Math.max(1, Math.ceil((usersQuery.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="stack-lg admin-users-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель / Абоненты"
            title="Абонентская база"
            description="Поиск, статусы аккаунтов, баланс и быстрые действия по каждому клиенту собраны в одном списке."
            actions={
              <div className="search-row">
                <label className="inline-actions minw-280" htmlFor="admin-users-search">
                  <Search size={16} />
                  <input
                    id="admin-users-search"
                    className="search-input"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Телефон, email или billing ID"
                  />
                </label>
              </div>
            }
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="table-shell">
          {items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Абонент</th>
                    <th>Роль</th>
                    <th>Баланс</th>
                    <th>Тикеты</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => {
                    const isLoading = pendingAction.id === user.id;
                    const displayName = getSafeDisplayName(user.full_name, user.phone, user.email);

                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="stack-sm">
                            <strong>{displayName}</strong>
                            <span className="muted">
                              {user.phone} / {user.email || "email не указан"} / {user.billing_id}
                            </span>
                            <span className="muted">
                              Создан {formatDate(user.created_at ?? new Date().toISOString(), "d MMM yyyy")}
                            </span>
                          </div>
                        </td>
                        <td>{user.role_label || user.role}</td>
                        <td>{formatCurrency(user.balance ?? 0)}</td>
                        <td>{user.open_tickets ?? user.total_tickets ?? 0}</td>
                        <td>
                          <StatusBadge tone={user.is_blocked ? "danger" : user.is_active ? "success" : "warning"}>
                            {user.status_label ||
                              (user.is_blocked ? "Заблокирован" : user.is_active ? "Активен" : "Неактивен")}
                          </StatusBadge>
                        </td>
                        <td>
                          <div className="inline-actions">
                            <Link className="link-line" to={`/admin/users/${user.id}`}>
                              Карточка
                            </Link>
                            {user.is_blocked ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                isLoading={isLoading && pendingAction.type === "unblock"}
                                loadingLabel="..."
                                onClick={() => unblockMutation.mutate(user.id)}
                              >
                                Разблокировать
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="danger"
                                isLoading={isLoading && pendingAction.type === "block"}
                                loadingLabel="..."
                                onClick={() => blockMutation.mutate(user.id)}
                              >
                                Заблокировать
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Users size={20} />}
              title="Пользователи не найдены"
              description="Измените строку поиска или сбросьте фильтр, чтобы снова увидеть абонентскую базу."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                >
                  Сбросить поиск
                </Button>
              }
            />
          )}
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
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

export default AdminUsersPage;
