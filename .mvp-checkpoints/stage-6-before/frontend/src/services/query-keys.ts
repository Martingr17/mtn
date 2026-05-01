export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
  },
  tariffs: {
    all: ["tariffs"] as const,
    history: ["tariffs", "history"] as const,
  },
  payments: {
    history: ["payments", "history"] as const,
    methods: ["payments", "methods"] as const,
  },
  tickets: {
    list: ["tickets", "list"] as const,
    detail: (ticketId: string | number) => ["tickets", "detail", ticketId] as const,
  },
  notifications: {
    list: ["notifications", "list"] as const,
    unread: ["notifications", "unread"] as const,
    settings: ["notifications", "settings"] as const,
    events: ["notifications", "events"] as const,
  },
  stats: {
    traffic: ["stats", "traffic"] as const,
    payments: ["stats", "payments"] as const,
    tickets: ["stats", "tickets"] as const,
    speedtest: ["stats", "speedtest"] as const,
    monitoring: ["stats", "monitoring"] as const,
  },
  admin: {
    stats: ["admin", "stats"] as const,
    users: ["admin", "users"] as const,
    tickets: ["admin", "tickets"] as const,
    staff: ["admin", "staff"] as const,
    logs: ["admin", "logs"] as const,
    systemInfo: ["admin", "system-info"] as const,
    systemSettings: ["admin", "system-settings"] as const,
  },
};
