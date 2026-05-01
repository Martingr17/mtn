const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = process.env.MTN_CAPTURE_BASE_URL || "https://mtn.website.yandexcloud.net";
const OUTPUT_DIR = path.resolve(__dirname, "..", "appendix_k_role_screenshots");

const now = new Date().toISOString();

const users = {
  user: {
    id: "101",
    email: "demo@operator.local",
    phone: "+7 900 100-20-30",
    first_name: "Мартин",
    last_name: "Абонент",
    role: "user",
    role_label: "Абонент",
    billing_id: "MTN91823341",
    balance: 1024,
    current_tariff: {
      id: "tariff-city-300",
      name: "Город 300",
      speed_mbps: 300,
      monthly_fee: 890,
    },
  },
  operator: {
    id: "201",
    email: "operator@operator.local",
    phone: "+7 900 555-10-20",
    first_name: "Ольга",
    last_name: "Оператор",
    role: "operator",
    role_label: "Оператор",
  },
  admin: {
    id: "301",
    email: "superadmin@operator.local",
    phone: "+7 900 777-10-20",
    first_name: "Анна",
    last_name: "Администратор",
    role: "admin",
    role_label: "Администратор",
  },
};

const ticketItems = [
  {
    id: "TK-1042",
    subject: "Снижение скорости вечером",
    status: "open",
    priority: "high",
    created_at: now,
    user_id: "101",
    user_phone: "+7 900 100-20-30",
    user_name: "Мартин Абонент",
    assigned_to: "201",
    assigned_to_name: "Ольга Оператор",
  },
  {
    id: "TK-1038",
    subject: "Проверка уведомлений по оплате",
    status: "pending",
    priority: "medium",
    created_at: "2026-04-26T13:30:00.000Z",
    user_id: "102",
    user_phone: "+7 900 222-33-44",
    user_name: "Ирина Клиент",
    assigned_to: "",
    assigned_to_name: "",
  },
  {
    id: "TK-1031",
    subject: "Инцидент на линии доступа",
    status: "resolved",
    priority: "critical",
    created_at: "2026-04-25T10:20:00.000Z",
    user_id: "103",
    user_phone: "+7 900 333-44-55",
    user_name: "Павел Иванов",
    assigned_to: "201",
    assigned_to_name: "Ольга Оператор",
  },
];

const subscriberTickets = {
  items: ticketItems.map((ticket) => ({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status === "open" ? "new" : ticket.status,
    priority: ticket.priority,
    created_at: ticket.created_at,
    user_id: ticket.user_id,
  })),
  total: ticketItems.length,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const adminUsers = {
  items: [
    {
      id: "101",
      full_name: "Мартин Абонент",
      phone: "+7 900 100-20-30",
      email: "demo@operator.local",
      billing_id: "MTN91823341",
      role: "user",
      role_label: "Абонент",
      balance: 1024,
      open_tickets: 1,
      total_tickets: 4,
      is_active: true,
      is_blocked: false,
      status_label: "Активен",
      created_at: "2026-03-14T09:00:00.000Z",
    },
    {
      id: "102",
      full_name: "Ирина Клиент",
      phone: "+7 900 222-33-44",
      email: "client02@operator.local",
      billing_id: "MTN91823342",
      role: "user",
      role_label: "Абонент",
      balance: 450,
      open_tickets: 0,
      total_tickets: 2,
      is_active: true,
      is_blocked: false,
      status_label: "Активен",
      created_at: "2026-03-20T11:10:00.000Z",
    },
    {
      id: "103",
      full_name: "Павел Иванов",
      phone: "+7 900 333-44-55",
      email: "client03@operator.local",
      billing_id: "MTN91823343",
      role: "user",
      role_label: "Абонент",
      balance: -280,
      open_tickets: 1,
      total_tickets: 6,
      is_active: true,
      is_blocked: false,
      has_debt: true,
      status_label: "Требует внимания",
      created_at: "2026-02-27T15:40:00.000Z",
    },
  ],
  total: 3,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const payments = [
  {
    id: "PAY-9001",
    user_id: "101",
    amount: 1000,
    payment_type: "top_up",
    payment_method: "Банковская карта",
    status: "completed",
    created_at: now,
  },
  {
    id: "PAY-8994",
    user_id: "101",
    amount: 890,
    payment_type: "tariff",
    payment_method: "СБП",
    status: "completed",
    created_at: "2026-04-25T16:00:00.000Z",
  },
];

const adminStats = {
  total_users: 1248,
  new_users_today: 18,
  revenue_month: 1842500,
  revenue_today: 64200,
  open_tickets: 12,
  overdue_tickets: 3,
  monitoring_average_quality_score: 91,
  monitoring_critical_alerts_24h: 2,
  tickets_by_status: [
    { key: "open", label: "Открытые", value: 12 },
    { key: "pending", label: "В работе", value: 18 },
    { key: "resolved", label: "Решённые", value: 74 },
  ],
  tickets_by_priority: [
    { key: "critical", label: "Критичные", value: 3 },
    { key: "high", label: "Высокие", value: 7 },
    { key: "medium", label: "Средние", value: 20 },
  ],
  payments_last_7_days: [
    { date: "2026-04-21", count: 42, amount: 81200 },
    { date: "2026-04-22", count: 39, amount: 76800 },
    { date: "2026-04-23", count: 51, amount: 102600 },
    { date: "2026-04-24", count: 44, amount: 88900 },
    { date: "2026-04-25", count: 47, amount: 94000 },
    { date: "2026-04-26", count: 31, amount: 61100 },
    { date: "2026-04-27", count: 36, amount: 64200 },
  ],
  recent_activity: [
    {
      title: "Назначена заявка TK-1042",
      actor: "Ольга Оператор",
      details: "обработка обращения абонента",
      created_at: now,
    },
    {
      title: "Ручное начисление",
      actor: "Анна Администратор",
      details: "компенсация по инциденту",
      created_at: "2026-04-26T17:00:00.000Z",
    },
  ],
};

function listPayload(items) {
  return { items, total: items.length, page: 1, page_size: 20, total_pages: 1 };
}

function responseForUrl(url, role) {
  const pathname = new URL(url).pathname;

  if (pathname.endsWith("/users/me")) return users[role] || users.user;
  if (pathname.includes("/statistics/payments")) {
    return { total_amount: 1890, average_amount: 945, largest_payment: 1000, payment_count: 2 };
  }
  if (pathname.includes("/statistics/tickets")) {
    return { open_tickets: 1, total_tickets: 3, average_response_time_hours: 2 };
  }
  if (pathname.includes("/monitoring/summary")) {
    return { quality_score: 91, quality_label: "Канал работает стабильно" };
  }
  if (pathname.includes("/speedtest/stats")) {
    return { avg_download: 294, total_tests: 8 };
  }
  if (pathname.includes("/payments/history")) return payments;
  if (pathname.includes("/payments/methods")) {
    return [
      {
        id: "card-1",
        masked_pan: "**** 4242",
        card_type: "Visa",
        method_type: "bank_card",
        is_default: true,
        created_at: "2026-04-01T12:00:00.000Z",
      },
    ];
  }
  if (pathname.match(/\/tickets\/?$/)) return subscriberTickets;
  if (pathname.includes("/admin/stats")) return adminStats;
  if (pathname.includes("/admin/system/info")) {
    return {
      environment: "production",
      app_version: "MTN 1.0",
      uptime: "14 дней",
      cpu_percent: 32,
      memory_percent: 58,
      disk_percent: 41,
      db_connections: 18,
    };
  }
  if (pathname.includes("/admin/users")) return adminUsers;
  if (pathname.includes("/admin/tickets/TK-1042")) {
    return {
      ...ticketItems[0],
      messages: [
        { id: "m1", body: "Скорость падает после 20:00.", author_name: "Мартин Абонент", created_at: now },
        { id: "m2", body: "Проверяем линию доступа.", author_name: "Ольга Оператор", created_at: now },
      ],
    };
  }
  if (pathname.includes("/admin/tickets")) return listPayload(ticketItems);
  if (pathname.includes("/admin/staff")) {
    return [
      { id: "201", full_name: "Ольга Оператор", role: "operator", email: "operator@operator.local" },
      { id: "301", full_name: "Анна Администратор", role: "admin", email: "superadmin@operator.local" },
    ];
  }
  if (pathname.includes("/admin/logs")) {
    return listPayload([
      { message: "payment manual top-up", actor: "Анна Администратор", created_at: now },
      { message: "invoice updated", user_phone: "+7 900 100-20-30", created_at: "2026-04-26T12:00:00.000Z" },
    ]);
  }
  if (pathname.includes("/notifications")) {
    return listPayload([
      { id: "n1", title: "Платёж зачислен", body: "Баланс пополнен на 1000 ₽", created_at: now, read_at: null },
      { id: "n2", title: "Заявка обновлена", body: "Оператор взял обращение в работу", created_at: now, read_at: null },
    ]);
  }

  return {};
}

async function capturePage(browser, shot) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    locale: "ru-RU",
    ignoreHTTPSErrors: true,
  });

  if (shot.role) {
    await context.addInitScript(({ role, user }) => {
      window.localStorage.setItem("mtn_theme", "gradient");
      window.sessionStorage.setItem(
        "mtn-auth-store",
        JSON.stringify({
          state: {
            user,
            accessToken: "appendix-k-demo-token",
            refreshToken: "appendix-k-demo-refresh",
            expiresIn: 3600,
            role,
            isAuthenticated: true,
          },
          version: 0,
        }),
      );
    }, { role: shot.role, user: users[shot.role] || users.user });
  }

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/api/v1/**", async (route) => {
    const payload = responseForUrl(route.request().url(), shot.role || "user");
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(payload),
    });
  });

  await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, shot.file), fullPage: false });
  await context.close();
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const shots = [
    { path: "/login?preset=subscriber", file: "01_login_roles.png" },
    { path: "/dashboard", role: "user", file: "02_subscriber_dashboard.png" },
    { path: "/support", role: "user", file: "03_subscriber_support.png" },
    { path: "/admin/tickets", role: "operator", file: "04_operator_tickets.png" },
    { path: "/admin/dashboard", role: "operator", file: "05_operator_dashboard.png" },
    { path: "/admin/users", role: "admin", file: "06_admin_users.png" },
    { path: "/admin/payments", role: "admin", file: "07_admin_payments.png" },
  ];

  for (const shot of shots) {
    process.stdout.write(`capture ${shot.file}\n`);
    await capturePage(browser, shot);
  }

  await browser.close();
  process.stdout.write(OUTPUT_DIR + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
