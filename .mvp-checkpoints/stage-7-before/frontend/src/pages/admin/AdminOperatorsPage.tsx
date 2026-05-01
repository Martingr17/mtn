import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { adminService } from "@/services/endpoints/admin";
import type { UserRole } from "@/types/domain";
import { formatDate } from "@/utils/format";

const INITIAL_FORM = {
  id: "",
  phone: "",
  email: "",
  first_name: "",
  last_name: "",
  role: "operator" as UserRole,
  password: "",
};

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function AdminOperatorsPage() {
  const staffQuery = useQuery({
    queryKey: ["admin-operators", "staff"],
    queryFn: adminService.staff,
  });

  const [formState, setFormState] = useState({ ...INITIAL_FORM });
  const saveFeedback = useButtonFeedback();

  const canSubmit =
    formState.phone.trim().length > 0 &&
    formState.first_name.trim().length > 0 &&
    formState.last_name.trim().length > 0 &&
    (formState.id.length > 0 || formState.password.trim().length > 0);

  const createMutation = useMutation({
    mutationFn: () => adminService.createStaff(formState),
    onSuccess: () => {
      saveFeedback.flashFeedback("success");
      toast.success("Сотрудник добавлен.");
      setFormState({ ...INITIAL_FORM });
      queryClient.invalidateQueries({ queryKey: ["admin-operators", "staff"] });
    },
    onError: () => {
      saveFeedback.flashFeedback("error");
      toast.error("Не удалось создать сотрудника.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => adminService.updateStaff(formState.id, formState),
    onSuccess: () => {
      saveFeedback.flashFeedback("success");
      toast.success("Профиль сотрудника обновлён.");
      queryClient.invalidateQueries({ queryKey: ["admin-operators", "staff"] });
    },
    onError: () => {
      saveFeedback.flashFeedback("error");
      toast.error("Не удалось обновить сотрудника.");
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="stack-lg admin-operators-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель / Операторы"
            title="Команда поддержки и операций"
            description="Управляйте составом команды, ролями и рабочими профилями сотрудников в одном разделе."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          <Card className="span-7 stack-md">
            <div className="toolbar-row">
              <div className="inline-actions">
                <ShieldCheck size={18} />
                <strong>Сотрудники</strong>
              </div>
              <Button variant="secondary" onClick={() => setFormState({ ...INITIAL_FORM })}>
                Новый сотрудник
              </Button>
            </div>

            {(staffQuery.data ?? []).length ? (
              (staffQuery.data ?? []).map((staff) => (
                <div key={staff.id} className="list-item">
                  <div>
                    <strong>{staff.display_name}</strong>
                    <p className="muted">
                      {staff.phone} · {staff.email || "Email не указан"}
                    </p>
                    <p className="muted">Добавлен {formatDate(staff.created_at, "d MMM yyyy")}</p>
                  </div>
                  <div className="inline-actions">
                    <StatusBadge tone={staff.is_active ? "success" : "warning"}>
                      {staff.role_label}
                    </StatusBadge>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const parts = splitFullName(staff.full_name);
                        setFormState({
                          id: staff.id,
                          phone: staff.phone,
                          email: staff.email ?? "",
                          first_name: parts.firstName,
                          last_name: parts.lastName,
                          role: staff.role,
                          password: "",
                        });
                      }}
                    >
                      Редактировать
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<ShieldCheck size={20} />}
                title="Команда пока не настроена"
                description="Добавьте первого сотрудника, чтобы распределять обращения и админские задачи."
              />
            )}
          </Card>

          <Card className="span-5 stack-md">
            <div className="inline-actions">
              <UserCog size={18} />
              <strong>{formState.id ? "Редактирование сотрудника" : "Новый сотрудник"}</strong>
            </div>

            <div className="field">
              <label htmlFor="operator-phone">Телефон</label>
              <input
                id="operator-phone"
                aria-invalid={formState.phone.length > 0 && !formState.phone.trim()}
                value={formState.phone}
                onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>

            <div className="field">
              <label htmlFor="operator-email">Email</label>
              <input
                id="operator-email"
                value={formState.email}
                onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
              />
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="operator-first-name">Имя</label>
                <input
                  id="operator-first-name"
                  aria-invalid={formState.first_name.length > 0 && !formState.first_name.trim()}
                  value={formState.first_name}
                  onChange={(event) => setFormState((current) => ({ ...current, first_name: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="operator-last-name">Фамилия</label>
                <input
                  id="operator-last-name"
                  aria-invalid={formState.last_name.length > 0 && !formState.last_name.trim()}
                  value={formState.last_name}
                  onChange={(event) => setFormState((current) => ({ ...current, last_name: event.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="operator-role">Роль</label>
              <select
                id="operator-role"
                value={formState.role}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, role: event.target.value as UserRole }))
                }
              >
                <option value="operator">Оператор</option>
                <option value="admin">Администратор</option>
                <option value="super_admin">Суперадминистратор</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="operator-password">Пароль</label>
              <input
                id="operator-password"
                type="password"
                aria-invalid={formState.password.length > 0 && !formState.password.trim()}
                value={formState.password}
                onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
                placeholder={
                  formState.id
                    ? "Оставьте пустым, чтобы не менять"
                    : "Введите временный пароль"
                }
              />
            </div>

            <Button
              onClick={() => (formState.id ? updateMutation.mutate() : createMutation.mutate())}
              disabled={!canSubmit || isSaving}
              isLoading={isSaving}
              loadingLabel={formState.id ? "Сохраняем..." : "Создаём..."}
              feedbackState={saveFeedback.feedbackState}
            >
              {formState.id ? "Сохранить сотрудника" : "Создать сотрудника"}
            </Button>
          </Card>
        </div>
      </AnimatedReveal>
    </div>
  );
}

export default AdminOperatorsPage;
