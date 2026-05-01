import { useState } from "react";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Archive, Bell, CheckCheck, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { VirtualizedInfiniteList } from "@/components/ui/VirtualizedInfiniteList";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { notificationsService } from "@/services/endpoints/notifications";
import type { ApiListPayload, EntityId, NotificationItem } from "@/types/domain";
import { formatRelative } from "@/utils/format";

const PAGE_SIZE = 20;
const notificationsListKey = ["notifications-page", "list"] as const;

type NotificationListData = InfiniteData<ApiListPayload<NotificationItem>, number>;
type RowAction = "read" | "archive" | "delete" | null;

function getPriorityTone(priority?: string) {
  if (priority === "high" || priority === "critical") {
    return "danger";
  }

  if (priority === "medium") {
    return "warning";
  }

  if (priority === "low") {
    return "success";
  }

  return "info";
}

function getPriorityLabel(priority?: string) {
  if (priority === "critical") {
    return "Критично";
  }

  if (priority === "high") {
    return "Высокий приоритет";
  }

  if (priority === "medium") {
    return "Средний приоритет";
  }

  if (priority === "low") {
    return "Низкий приоритет";
  }

  return "Информация";
}

function NotificationsPage() {
  const [activeAction, setActiveAction] = useState<{ id: EntityId | null; type: RowAction }>({
    id: null,
    type: null,
  });
  const markAllFeedback = useButtonFeedback();

  const notificationsQuery = useInfiniteQuery({
    queryKey: notificationsListKey,
    queryFn: ({ pageParam = 1 }) => notificationsService.list(pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === PAGE_SIZE ? allPages.length + 1 : undefined,
    initialPageParam: 1,
  });

  const items = notificationsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const unreadCount = items.filter((item) => !item.is_read).length;

  const markReadMutation = useMutation({
    mutationFn: (notificationId: EntityId) => notificationsService.markRead(notificationId),
    onMutate: async (notificationId) => {
      setActiveAction({ id: notificationId, type: "read" });
      await queryClient.cancelQueries({ queryKey: notificationsListKey });
      const previous = queryClient.getQueryData<NotificationListData>(notificationsListKey);

      queryClient.setQueryData<NotificationListData>(notificationsListKey, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === notificationId ? { ...item, is_read: true } : item,
                ),
              })),
            }
          : current,
      );

      return { previous };
    },
    onSuccess: () => {
      toast.success("Уведомление отмечено как прочитанное.");
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationsListKey, context.previous);
      }

      toast.error("Не удалось обновить статус уведомления.");
    },
    onSettled: () => {
      setActiveAction({ id: null, type: null });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (notificationId: EntityId) => notificationsService.archive(notificationId),
    onMutate: (notificationId) => {
      setActiveAction({ id: notificationId, type: "archive" });
    },
    onSuccess: () => {
      toast.success("Уведомление отправлено в архив.");
      queryClient.invalidateQueries({ queryKey: notificationsListKey });
    },
    onError: () => {
      toast.error("Не удалось архивировать уведомление.");
    },
    onSettled: () => {
      setActiveAction({ id: null, type: null });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (notificationId: EntityId) => notificationsService.remove(notificationId),
    onMutate: (notificationId) => {
      setActiveAction({ id: notificationId, type: "delete" });
    },
    onSuccess: () => {
      toast.success("Уведомление удалено.");
      queryClient.invalidateQueries({ queryKey: notificationsListKey });
    },
    onError: () => {
      toast.error("Не удалось удалить уведомление.");
    },
    onSettled: () => {
      setActiveAction({ id: null, type: null });
    },
  });

  const handleMarkAllRead = async () => {
    try {
      await notificationsService.markAllRead();
      markAllFeedback.flashFeedback("success");
      toast.success("Все уведомления отмечены как прочитанные.");
      queryClient.invalidateQueries({ queryKey: notificationsListKey });
    } catch {
      markAllFeedback.flashFeedback("error");
      toast.error("Не удалось отметить все уведомления.");
    }
  };

  const renderNotificationRow = (notification: NotificationItem) => {
    const actionUrl = notification.action_url?.trim();
    const isExternalUrl = Boolean(actionUrl?.startsWith("http"));
    const isRowActionLoading = activeAction.id === notification.id;

    return (
      <div className={`list-item notification-row ${notification.is_read ? "" : "is-unread"}`}>
        <div>
          <div className="inline-actions">
            <Bell size={16} />
            <strong>{notification.title}</strong>
            <StatusBadge tone={getPriorityTone(notification.priority)}>
              {notification.priority_label || getPriorityLabel(notification.priority)}
            </StatusBadge>
          </div>
          <p>{notification.message || notification.body}</p>
          <p className="muted">{formatRelative(notification.created_at)}</p>
          {actionUrl ? (
            <a
              className="link-line"
              href={actionUrl}
              target={isExternalUrl ? "_blank" : undefined}
              rel={isExternalUrl ? "noreferrer" : undefined}
            >
              Открыть детали
              <ExternalLink size={14} />
            </a>
          ) : null}
        </div>

        <div className="inline-actions">
          {!notification.is_read ? (
            <Button
              size="sm"
              variant="secondary"
              isLoading={isRowActionLoading && activeAction.type === "read"}
              loadingLabel="..."
              onClick={() => markReadMutation.mutate(notification.id)}
            >
              Прочитано
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="secondary"
            isLoading={isRowActionLoading && activeAction.type === "archive"}
            loadingLabel="..."
            onClick={() => archiveMutation.mutate(notification.id)}
          >
            <Archive size={14} />
            Архив
          </Button>

          <Button
            size="sm"
            variant="danger"
            isLoading={isRowActionLoading && activeAction.type === "delete"}
            loadingLabel="..."
            onClick={() => deleteMutation.mutate(notification.id)}
          >
            <Trash2 size={14} />
            Удалить
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="stack-lg notifications-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Уведомления"
            title="Центр уведомлений MTN"
            description="Платежи, сервисные события и статусы сети собраны в одной ленте с понятным приоритетом."
            actions={
              <Button
                variant="secondary"
                onClick={handleMarkAllRead}
                isLoading={false}
                feedbackState={markAllFeedback.feedbackState}
                disabled={!unreadCount}
              >
                <CheckCheck size={16} />
                {unreadCount ? `Прочитать всё (${unreadCount})` : "Всё прочитано"}
              </Button>
            }
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <Card className="stack-md">
          {notificationsQuery.isPending && !items.length ? (
            <div className="data-list">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="skeleton-card" />
              ))}
            </div>
          ) : !items.length ? (
            <EmptyState
              icon={<Bell size={20} />}
              title="Лента пока пустая"
              description="Когда появятся новые события по аккаунту, платежам или качеству сети, они отобразятся здесь."
              action={
                <Button variant="secondary" onClick={() => notificationsQuery.refetch()}>
                  Обновить ленту
                </Button>
              }
            />
          ) : items.length > 100 ? (
            <VirtualizedInfiniteList
              items={items}
              hasNextPage={notificationsQuery.hasNextPage}
              isFetchingNextPage={notificationsQuery.isFetchingNextPage}
              onLoadMore={() => notificationsQuery.fetchNextPage()}
              renderItem={renderNotificationRow}
            />
          ) : (
            <div className="data-list">
              {items.map((notification) => (
                <div key={notification.id}>{renderNotificationRow(notification)}</div>
              ))}
            </div>
          )}

          {notificationsQuery.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => notificationsQuery.fetchNextPage()}
              isLoading={notificationsQuery.isFetchingNextPage}
              loadingLabel="Загружаем..."
            >
              Показать ещё
            </Button>
          ) : null}
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default NotificationsPage;
