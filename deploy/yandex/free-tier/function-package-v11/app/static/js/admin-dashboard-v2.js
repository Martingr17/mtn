(function () {
    const root = document.getElementById("adminDashboardPage");
    const ui = window.OperatorUI || null;
    if (!root || !ui) return;

    const STORAGE = {
        dashboard: "mtn_admin_dashboard_state_v2",
        payments: "mtn_admin_payments_v1",
        operators: "mtn_admin_operators_v1",
        tariffs: "mtn_admin_tariffs_v1",
        ticketsManual: "mtn_admin_ticket_queue_manual_v1",
        theme: "mtn_admin_dashboard_theme_v2",
        role: "mtn_admin_dashboard_role_v2",
        widgets: "mtn_admin_dashboard_widgets_v2",
    };

    const TICKET_OPEN_STATUSES = new Set(["new", "in_progress", "waiting_customer"]);
    const POLL_INTERVAL = 30000;

    const nodes = {
        roleSwitch: document.getElementById("adminDashboardRoleSwitch"),
        themeToggle: document.getElementById("adminDashboardThemeToggle"),
        refresh: document.getElementById("adminDashboardRefresh"),
        exportPdf: document.getElementById("adminDashboardExportPdf"),
        kpis: document.getElementById("adminDashboardKpis"),
        widgetGrid: document.getElementById("adminDashboardWidgetGrid"),
        connectionsNote: document.getElementById("adminDashboardConnectionsNote"),
        connectionsChart: document.getElementById("adminDashboardConnectionsChart"),
        ticketsChart: document.getElementById("adminDashboardTicketsChart"),
        highPriority: document.getElementById("adminDashboardHighPriority"),
        debts: document.getElementById("adminDashboardDebts"),
        lowSpeed: document.getElementById("adminDashboardLowSpeed"),
        activity: document.getElementById("adminDashboardActivity"),
        search: document.getElementById("adminDashboardSearch"),
        searchBtn: document.getElementById("adminDashboardSearchBtn"),
        searchResults: document.getElementById("adminDashboardSearchResults"),
        userTariff: document.getElementById("adminDashboardUserTariff"),
        userForm: document.getElementById("adminDashboardUserForm"),
        ticketForm: document.getElementById("adminDashboardTicketForm"),
        paymentForm: document.getElementById("adminDashboardPaymentForm"),
    };

    const state = {
        theme: window.localStorage.getItem(STORAGE.theme) || "light",
        role: normalizeRole(window.localStorage.getItem(STORAGE.role) || document.body.dataset.currentUserRole || "admin"),
        eventFilter: "all",
        charts: {
            connections: null,
            tickets: null,
        },
        sortable: null,
        previousHourlyTickets: 0,
        pollTimer: null,
    };

    function normalizeRole(value) {
        const role = String(value || "").toLowerCase();
        if (role === "operator") return "operator";
        return "admin";
    }

    function readJson(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            console.warn(`Failed to parse ${key}`, error);
            return fallback;
        }
    }

    function writeJson(key, value) {
        window.localStorage.setItem(key, JSON.stringify(value));
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            maximumFractionDigits: 0,
        }).format(Number(value || 0));
    }

    function formatDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function formatDay(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
        }).format(date);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function toast(message, type = "info", title = "") {
        ui.toast(message, type, title);
    }

    function openModal(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add("modal-open");
    }

    function closeModal(id) {
        const modal = typeof id === "string" ? document.getElementById(id) : id;
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove("modal-open");
    }

    function currentActor() {
        return document.body.dataset.currentUserName || (state.role === "admin" ? "Иван Иванов" : "Мария Петрова");
    }

    function defaultTariffs() {
        return [
            { id: 1, name: "Старт 100", speed: 100, price: 490, type: "home", status: "active" },
            { id: 2, name: "Город 300", speed: 300, price: 790, type: "home", status: "active" },
            { id: 3, name: "Смена 500", speed: 500, price: 1090, type: "work", status: "active" },
            { id: 4, name: "Семья 700 + ТВ", speed: 700, price: 1490, type: "home", status: "active" },
            { id: 5, name: "Бизнес 1000", speed: 1000, price: 2490, type: "business", status: "active" },
        ];
    }

    function defaultPayments() {
        return [
            { id: 1001, date: "2026-03-15T14:32:00", abonent: "Мартин Григорян", account: "DEMO77777", type: "topup", amount: 1000, method: "card", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-67" },
            { id: 1002, date: "2026-03-15T10:15:00", abonent: "Анна Смирнова", account: "DEMO77778", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Тариф Город 300", phone: "+7 999 123-45-68" },
            { id: 1003, date: "2026-03-14T18:20:00", abonent: "Пётр Иванов", account: "DEMO77779", type: "manual", amount: 500, method: "manual", status: "success", operator: "Иван Иванов", comment: "Ошибочное списание", phone: "+7 999 123-45-69" },
            { id: 1004, date: "2026-03-14T09:00:00", abonent: "Елена Петрова", account: "DEMO77780", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Абонентская плата", phone: "+7 999 123-45-70" },
            { id: 1005, date: "2026-03-13T22:40:00", abonent: "Алексей Сидоров", account: "DEMO77781", type: "topup", amount: 500, method: "sbp", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-71" },
            { id: 1006, date: "2026-03-13T15:30:00", abonent: "Ольга Козлова", account: "DEMO77782", type: "charge", amount: -1490, method: "auto", status: "error", operator: "Система", comment: "Недостаточно средств", phone: "+7 999 123-45-72" },
            { id: 1007, date: "2026-03-12T11:00:00", abonent: "Дмитрий Морозов", account: "DEMO77783", type: "topup", amount: 2000, method: "card", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-73" },
            { id: 1008, date: "2026-03-12T08:15:00", abonent: "Наталья Власова", account: "DEMO77784", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Абонентская плата", phone: "+7 999 123-45-74" },
        ];
    }

    function defaultOperators() {
        return [
            { id: 1, name: "Иван Иванов", email: "ivan@mtn.ru", role: "admin", status: "active", lastLogin: new Date(Date.now() - 25 * 60000).toISOString(), activeTickets: 0, activities: [] },
            { id: 2, name: "Мария Петрова", email: "maria@mtn.ru", role: "operator", status: "active", lastLogin: new Date(Date.now() - 3 * 60000).toISOString(), activeTickets: 3, activities: [] },
            { id: 3, name: "Алексей Смирнов", email: "alex@mtn.ru", role: "operator", status: "active", lastLogin: new Date(Date.now() - 80 * 60000).toISOString(), activeTickets: 5, activities: [] },
            { id: 4, name: "Елена Козлова", email: "elena@mtn.ru", role: "operator", status: "blocked", lastLogin: new Date(Date.now() - 4 * 86400000).toISOString(), activeTickets: 0, activities: [] },
            { id: 5, name: "Дмитрий Морозов", email: "dmitry@mtn.ru", role: "operator", status: "active", lastLogin: new Date(Date.now() - 120 * 60000).toISOString(), activeTickets: 1, activities: [] },
        ];
    }

    function defaultTickets() {
        return [
            { id: 123, created_at: "2026-03-15T14:32:00", user_name: "Мартин Григорян", user_phone: "+7 999 123-45-67", subject: "Нет интернета", priority: "high", status: "new", assigned_to_name: "" },
            { id: 122, created_at: "2026-03-15T10:15:00", user_name: "Анна Смирнова", user_phone: "+7 999 123-45-68", subject: "Снижена скорость", priority: "medium", status: "in_progress", assigned_to_name: "Иван Иванов" },
            { id: 121, created_at: "2026-03-14T18:20:00", user_name: "Пётр Иванов", user_phone: "+7 999 123-45-69", subject: "Вопрос по оплате", priority: "low", status: "resolved", assigned_to_name: "Мария Петрова" },
            { id: 120, created_at: "2026-03-14T09:00:00", user_name: "Елена Петрова", user_phone: "+7 999 123-45-70", subject: "Смена тарифа", priority: "low", status: "closed", assigned_to_name: "Иван Иванов" },
            { id: 119, created_at: "2026-03-13T22:40:00", user_name: "Алексей Сидоров", user_phone: "+7 999 123-45-71", subject: "Технические работы", priority: "medium", status: "new", assigned_to_name: "" },
            { id: 118, created_at: "2026-03-13T15:30:00", user_name: "Ольга Козлова", user_phone: "+7 999 123-45-72", subject: "Нет интернета", priority: "high", status: "in_progress", assigned_to_name: "Мария Петрова" },
            { id: 117, created_at: "2026-03-12T11:00:00", user_name: "Дмитрий Морозов", user_phone: "+7 999 123-45-73", subject: "Жалоба на качество", priority: "medium", status: "new", assigned_to_name: "" },
            { id: 116, created_at: "2026-03-12T08:15:00", user_name: "Наталья Власова", user_phone: "+7 999 123-45-74", subject: "Вопрос по оплате", priority: "low", status: "in_progress", assigned_to_name: "Иван Иванов" },
            { id: 115, created_at: "2026-03-11T16:45:00", user_name: "Сергей Тихонов", user_phone: "+7 999 123-45-75", subject: "Снижена скорость", priority: "medium", status: "resolved", assigned_to_name: "Мария Петрова" },
            { id: 114, created_at: "2026-03-11T10:00:00", user_name: "Ирина Соколова", user_phone: "+7 999 123-45-76", subject: "Нет интернета", priority: "high", status: "new", assigned_to_name: "" },
        ];
    }

    function seedDashboardState() {
        const existing = readJson(STORAGE.dashboard, null);
        if (existing && Array.isArray(existing.abonents) && Array.isArray(existing.connections) && Array.isArray(existing.activity)) {
            return existing;
        }

        const now = new Date();
        const connections = [];
        for (let index = 29; index >= 0; index -= 1) {
            const date = new Date(now);
            date.setDate(now.getDate() - index);
            const base = 8 + Math.round(Math.sin(index / 4) * 4);
            const variance = (index % 5) - 2;
            connections.push({
                date: date.toISOString(),
                count: Math.max(2, base + variance + (index < 7 ? 4 : 0)),
            });
        }

        const abonents = [
            { id: 1, account: "DEMO77777", name: "Мартин Григорян", phone: "+7 999 123-45-67", email: "martin@mtn.ru", tariff: "Город 300", tariffSpeed: 300, balance: 1470, status: "active", debtDays: 0, speedShare: 83, registeredAt: "2026-03-10T12:00:00", lastActivity: "2026-04-11T10:25:00" },
            { id: 2, account: "DEMO77778", name: "Анна Смирнова", phone: "+7 999 123-45-68", email: "anna@mtn.ru", tariff: "Старт 100", tariffSpeed: 100, balance: -200, status: "blocked", debtDays: 15, speedShare: 91, registeredAt: "2026-02-28T11:00:00", lastActivity: "2026-04-10T18:40:00" },
            { id: 3, account: "DEMO77779", name: "Пётр Иванов", phone: "+7 999 123-45-69", email: "petr@mtn.ru", tariff: "Смена 500", tariffSpeed: 500, balance: 3200, status: "active", debtDays: 0, speedShare: 96, registeredAt: "2026-04-08T15:10:00", lastActivity: "2026-04-11T09:50:00" },
            { id: 4, account: "DEMO77780", name: "Елена Петрова", phone: "+7 999 123-45-70", email: "elena.client@mtn.ru", tariff: "Город 300", tariffSpeed: 300, balance: -50, status: "active", debtDays: 5, speedShare: 68, registeredAt: "2026-04-09T13:15:00", lastActivity: "2026-04-11T08:10:00" },
            { id: 5, account: "DEMO77781", name: "Алексей Сидоров", phone: "+7 999 123-45-71", email: "alex.client@mtn.ru", tariff: "Старт 100", tariffSpeed: 100, balance: 50, status: "active", debtDays: 0, speedShare: 74, registeredAt: "2026-03-14T09:00:00", lastActivity: "2026-04-10T20:18:00" },
            { id: 6, account: "DEMO77782", name: "Ольга Козлова", phone: "+7 999 123-45-72", email: "olga@mtn.ru", tariff: "Семья 700 + ТВ", tariffSpeed: 700, balance: -1200, status: "blocked", debtDays: 30, speedShare: 61, registeredAt: "2026-02-14T16:45:00", lastActivity: "2026-04-09T14:55:00" },
            { id: 7, account: "DEMO77783", name: "Дмитрий Морозов", phone: "+7 999 123-45-73", email: "dmitry.client@mtn.ru", tariff: "Бизнес 1000", tariffSpeed: 1000, balance: 5000, status: "active", debtDays: 0, speedShare: 92, registeredAt: "2026-04-04T10:30:00", lastActivity: "2026-04-11T10:45:00" },
            { id: 8, account: "DEMO77784", name: "Наталья Власова", phone: "+7 999 123-45-74", email: "natalia@mtn.ru", tariff: "Город 300", tariffSpeed: 300, balance: 890, status: "active", debtDays: 0, speedShare: 79, registeredAt: "2026-03-22T12:10:00", lastActivity: "2026-04-10T17:30:00" },
            { id: 9, account: "DEMO77785", name: "Сергей Тихонов", phone: "+7 999 123-45-75", email: "sergey@mtn.ru", tariff: "Старт 100", tariffSpeed: 100, balance: -350, status: "suspended", debtDays: 18, speedShare: 72, registeredAt: "2026-04-06T08:15:00", lastActivity: "2026-04-10T12:05:00" },
            { id: 10, account: "DEMO77786", name: "Ирина Соколова", phone: "+7 999 123-45-76", email: "irina@mtn.ru", tariff: "Смена 500", tariffSpeed: 500, balance: 120, status: "active", debtDays: 0, speedShare: 66, registeredAt: "2026-04-07T14:25:00", lastActivity: "2026-04-11T07:40:00" },
        ];

        const activity = [
            { id: "evt-1", type: "ticket", title: "Заявка №123 создана", description: "Мартин Григорян · Нет интернета", actor: "Система", at: "2026-04-11T14:32:00" },
            { id: "evt-2", type: "payment", title: "Платёж на 500 ₽", description: "Анна Смирнова · ручное подтверждение", actor: "Иван Иванов", at: "2026-04-11T14:15:00" },
            { id: "evt-3", type: "user", title: "Новый абонент зарегистрирован", description: "Пётр Иванов · Город 300", actor: "Система", at: "2026-04-11T13:50:00" },
            { id: "evt-4", type: "ticket", title: "Заявка №120 закрыта", description: "Тема: Смена тарифа", actor: "Мария Петрова", at: "2026-04-11T13:20:00" },
            { id: "evt-5", type: "system", title: "Обновление мониторинга", description: "Качество линии пересчитано по 5 234 абонентам", actor: "Система", at: "2026-04-11T12:55:00" },
        ];

        const payload = {
            abonents,
            connections,
            activity,
            lastUserId: abonents.length,
        };

        writeJson(STORAGE.dashboard, payload);
        return payload;
    }

    function ensureStorageSeed() {
        if (!readJson(STORAGE.tariffs, null)) writeJson(STORAGE.tariffs, defaultTariffs());
        if (!readJson(STORAGE.payments, null)) writeJson(STORAGE.payments, defaultPayments());
        if (!readJson(STORAGE.operators, null)) writeJson(STORAGE.operators, defaultOperators());
        seedDashboardState();
    }

    function getDashboardState() {
        return seedDashboardState();
    }

    function setDashboardState(nextState) {
        writeJson(STORAGE.dashboard, nextState);
    }

    function getTariffs() {
        return readJson(STORAGE.tariffs, defaultTariffs()).filter((item) => item.status !== "hidden");
    }

    function getPayments() {
        return readJson(STORAGE.payments, defaultPayments());
    }

    function setPayments(items) {
        writeJson(STORAGE.payments, items);
    }

    function getOperators() {
        return readJson(STORAGE.operators, defaultOperators());
    }

    function setOperators(items) {
        writeJson(STORAGE.operators, items);
    }

    function getTickets() {
        const manual = readJson(STORAGE.ticketsManual, []);
        const map = new Map();
        [...defaultTickets(), ...manual].forEach((item) => map.set(item.id, item));
        return Array.from(map.values()).sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
    }

    function setManualTickets(items) {
        writeJson(STORAGE.ticketsManual, items);
    }

    function statusText(value) {
        return ({
            new: "Новая",
            in_progress: "В работе",
            waiting_customer: "Ожидает клиента",
            resolved: "Решена",
            closed: "Закрыта",
        })[value] || value;
    }

    function priorityText(value) {
        return ({
            high: "Высокий",
            medium: "Средний",
            low: "Низкий",
        })[value] || value;
    }

    function userStatusText(value) {
        return ({
            active: "Активен",
            blocked: "Заблокирован",
            suspended: "Приостановлен",
        })[value] || value;
    }

    function badgeClass(kind, value) {
        if (kind === "priority") return value === "high" ? "is-danger" : value === "medium" ? "is-warning" : "is-success";
        if (kind === "status") return value === "new" ? "is-info" : value === "in_progress" || value === "waiting_customer" ? "is-warning" : value === "resolved" ? "is-success" : "is-muted";
        if (kind === "user-status") return value === "active" ? "is-success" : value === "blocked" ? "is-danger" : "is-warning";
        return "is-info";
    }

    function renderBadge(kind, value, label) {
        return `<span class="admin-suite-badge ${badgeClass(kind, value)}">${escapeHtml(label)}</span>`;
    }

    function applyTheme() {
        const isDark = state.theme === "dark";
        document.body.classList.toggle("admin-dashboard-theme-dark", isDark);
        if (nodes.themeToggle) {
            nodes.themeToggle.innerHTML = isDark
                ? '<i class="fas fa-sun"></i> Светлая тема'
                : '<i class="fas fa-moon"></i> Тёмная тема';
        }
    }

    function toggleRoleScopedBlocks() {
        root.querySelectorAll("[data-role-scope]").forEach((node) => {
            node.hidden = node.dataset.roleScope === "admin" && state.role !== "admin";
        });
    }

    function getSnapshot() {
        const dashboard = getDashboardState();
        const abonents = dashboard.abonents || [];
        const tickets = getTickets();
        const payments = getPayments();
        const operators = getOperators();
        const connections = dashboard.connections || [];
        const activity = (dashboard.activity || []).slice().sort((left, right) => new Date(right.at) - new Date(left.at));
        return { dashboard, abonents, tickets, payments, operators, connections, activity };
    }

    function metricCards(snapshot) {
        const now = Date.now();
        const monthAgo = now - 31 * 86400000;
        const weekAgo = now - 7 * 86400000;

        const totalUsers = snapshot.abonents.length;
        const openTickets = snapshot.tickets.filter((ticket) => TICKET_OPEN_STATUSES.has(ticket.status)).length;
        const highPriority = snapshot.tickets.filter((ticket) => ticket.priority === "high" && TICKET_OPEN_STATUSES.has(ticket.status)).length;
        const revenueMonth = snapshot.payments
            .filter((payment) => payment.amount > 0 && payment.status === "success" && new Date(payment.date).getTime() >= monthAgo)
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const newUsersWeek = snapshot.abonents.filter((user) => new Date(user.registeredAt).getTime() >= weekAgo).length;
        const positiveTopups = snapshot.payments.filter((payment) => payment.amount > 0 && payment.status === "success" && new Date(payment.date).getTime() >= monthAgo);
        const averageCheck = positiveTopups.length ? revenueMonth / positiveTopups.length : 0;
        const conversion = snapshot.payments.length
            ? Math.round((snapshot.payments.filter((payment) => payment.status === "success").length / snapshot.payments.length) * 100)
            : 0;

        const allCards = [
            { key: "users", title: "Всего абонентов", value: String(totalUsers), meta: `+${newUsersWeek} за неделю`, link: "/admin/abonents", linkLabel: "Перейти к абонентам", icon: "fa-users", roles: ["admin", "operator"] },
            { key: "tickets", title: "Активные заявки", value: String(openTickets), meta: `Высокий приоритет: ${highPriority}`, link: "/admin/tickets", linkLabel: "Перейти к заявкам", icon: "fa-life-ring", roles: ["admin", "operator"] },
            { key: "revenue", title: "Выручка за месяц", value: formatCurrency(revenueMonth), meta: "+5% к прошлому месяцу", icon: "fa-ruble-sign", roles: ["admin"] },
            { key: "new-users", title: "Новых абонентов за неделю", value: String(newUsersWeek), meta: "Подключения по текущему периоду", icon: "fa-user-plus", roles: ["admin", "operator"] },
            { key: "average-check", title: "Средний чек", value: formatCurrency(averageCheck), meta: "По успешным пополнениям", icon: "fa-chart-column", roles: ["admin"] },
            { key: "conversion", title: "Конверсия в оплату", value: `${conversion}%`, meta: "Успешные операции ко всем транзакциям", icon: "fa-circle-check", roles: ["admin"] },
        ];

        return allCards.filter((card) => card.roles.includes(state.role));
    }

    function renderKpis(snapshot) {
        if (!nodes.kpis) return;
        const cards = metricCards(snapshot);
        nodes.kpis.innerHTML = cards.map((card) => `
            <article class="admin-dashboard-kpi">
                <div class="admin-dashboard-kpi-head">
                    <div class="admin-dashboard-kpi-title">${escapeHtml(card.title)}</div>
                    <span class="admin-dashboard-kpi-icon"><i class="fas ${escapeHtml(card.icon)}"></i></span>
                </div>
                <div class="admin-dashboard-kpi-value">${escapeHtml(card.value)}</div>
                <div class="admin-dashboard-kpi-meta">${escapeHtml(card.meta)}</div>
                ${card.link ? `<a class="admin-dashboard-kpi-link" href="${card.link}">${escapeHtml(card.linkLabel)} <i class="fas fa-arrow-right"></i></a>` : ""}
            </article>
        `).join("");
    }

    function chartPalette() {
        const dark = state.theme === "dark";
        return {
            label: dark ? "#f8fafc" : "#111827",
            grid: "rgba(148, 163, 184, 0.18)",
            primary: "#2563eb",
            secondary: "#60a5fa",
            success: "#10b981",
            warning: "#f59e0b",
            danger: "#ef4444",
            muted: dark ? "#94a3b8" : "#64748b",
        };
    }

    function renderConnectionsChart(snapshot) {
        if (!nodes.connectionsChart || typeof window.Chart === "undefined") return;
        const palette = chartPalette();
        if (state.charts.connections) state.charts.connections.destroy();

        const series = snapshot.connections.slice(-30);
        const weekTotal = series.slice(-7).reduce((sum, item) => sum + Number(item.count || 0), 0);
        if (nodes.connectionsNote) nodes.connectionsNote.textContent = `Новые подключения: +${weekTotal} за последнюю неделю`;

        state.charts.connections = new window.Chart(nodes.connectionsChart, {
            type: "line",
            data: {
                labels: series.map((item) => formatDay(item.date)),
                datasets: [{
                    label: "Подключения",
                    data: series.map((item) => item.count),
                    borderColor: palette.primary,
                    backgroundColor: "rgba(37, 99, 235, 0.14)",
                    fill: true,
                    tension: 0.32,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: palette.label } },
                },
                scales: {
                    x: { ticks: { color: palette.muted }, grid: { color: palette.grid } },
                    y: { ticks: { color: palette.muted }, grid: { color: palette.grid }, beginAtZero: true },
                },
            },
        });
    }

    function renderTicketsChart(snapshot) {
        if (!nodes.ticketsChart || typeof window.Chart === "undefined") return;
        const palette = chartPalette();
        if (state.charts.tickets) state.charts.tickets.destroy();

        const statusMap = [
            { key: "new", label: "Новые", color: palette.primary },
            { key: "in_progress", label: "В работе", color: palette.warning },
            { key: "resolved", label: "Решены", color: palette.success },
            { key: "closed", label: "Закрыты", color: palette.muted },
        ];

        state.charts.tickets = new window.Chart(nodes.ticketsChart, {
            type: "doughnut",
            data: {
                labels: statusMap.map((status) => status.label),
                datasets: [{
                    data: statusMap.map((status) => snapshot.tickets.filter((ticket) => ticket.status === status.key).length),
                    backgroundColor: statusMap.map((status) => status.color),
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: palette.label },
                    },
                },
            },
        });
    }

    function emptyState(title, message) {
        return `<div class="admin-dashboard-empty"><strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div></div>`;
    }

    function renderList(container, items, formatter, emptyTitle, emptyCopy) {
        if (!container) return;
        if (!items.length) {
            container.innerHTML = emptyState(emptyTitle, emptyCopy);
            return;
        }
        container.innerHTML = items.map(formatter).join("");
    }

    function renderProblemZones(snapshot) {
        const urgent = snapshot.tickets
            .filter((ticket) => ticket.priority === "high" && TICKET_OPEN_STATUSES.has(ticket.status))
            .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
            .slice(0, 5);

        renderList(
            nodes.highPriority,
            urgent,
            (item) => `
                <article class="admin-widget-list-item is-critical">
                    <div class="admin-widget-list-row">
                        <div>
                            <div class="admin-widget-list-title">№${item.id} · ${escapeHtml(item.user_name)}</div>
                            <div class="admin-widget-list-copy">${escapeHtml(item.subject)} · ${formatDateTime(item.created_at)}</div>
                        </div>
                        ${renderBadge("priority", item.priority, priorityText(item.priority))}
                    </div>
                </article>
            `,
            "Нет срочных заявок",
            "Сейчас в очереди нет обращений, требующих немедленного внимания."
        );

        const debtUsers = snapshot.abonents
            .filter((user) => Number(user.balance || 0) < 0)
            .sort((left, right) => left.balance - right.balance)
            .slice(0, 5);

        renderList(
            nodes.debts,
            debtUsers,
            (item) => {
                const severe = Number(item.balance || 0) < -500;
                return `
                    <article class="admin-widget-list-item ${severe ? "is-critical" : "is-warning"}">
                        <div class="admin-widget-list-row">
                            <div>
                                <div class="admin-widget-list-title">${escapeHtml(item.account)} · ${escapeHtml(item.name)}</div>
                                <div class="admin-widget-list-copy">Долг ${formatCurrency(item.balance)} · ${item.debtDays} дн.</div>
                            </div>
                            ${renderBadge("user-status", item.status, userStatusText(item.status))}
                        </div>
                    </article>
                `;
            },
            "Нет абонентов с долгом",
            "Отрицательного баланса по текущим данным нет."
        );

        const lowSpeed = snapshot.abonents
            .filter((user) => Number(user.speedShare || 0) < 70)
            .sort((left, right) => left.speedShare - right.speedShare)
            .slice(0, 5);

        renderList(
            nodes.lowSpeed,
            lowSpeed,
            (item) => `
                <article class="admin-widget-list-item is-warning">
                    <div class="admin-widget-list-row">
                        <div>
                            <div class="admin-widget-list-title">${escapeHtml(item.name)}</div>
                            <div class="admin-widget-list-copy">${item.speedShare}% от тарифа · ${escapeHtml(item.tariff)}</div>
                        </div>
                        <span class="admin-suite-badge is-warning">${escapeHtml(String(item.speedShare))}%</span>
                    </div>
                </article>
            `,
            "Линий риска нет",
            "Ни один абонент не опустился ниже 70% от заявленной скорости."
        );
    }

    function renderActivity(snapshot) {
        if (!nodes.activity) return;
        const items = snapshot.activity
            .filter((item) => state.eventFilter === "all" || item.type === state.eventFilter)
            .slice(0, 10);

        renderList(
            nodes.activity,
            items,
            (item) => `
                <article class="admin-activity-item">
                    <div class="admin-activity-time">${formatDateTime(item.at)}</div>
                    <div class="admin-activity-main">
                        <strong>${escapeHtml(item.title)}</strong>
                        <div class="admin-activity-meta">${escapeHtml(item.description)}</div>
                    </div>
                    <div class="admin-activity-meta">${escapeHtml(item.actor)}</div>
                </article>
            `,
            "Нет событий",
            "Лента активности пока пуста."
        );

        root.querySelectorAll("[data-activity-filter]").forEach((button) => {
            button.classList.toggle("is-accent", button.dataset.activityFilter === state.eventFilter);
        });
    }

    function renderSearchResults(results) {
        if (!nodes.searchResults) return;
        renderList(
            nodes.searchResults,
            results,
            (item) => `
                <article class="admin-widget-list-item">
                    <div class="admin-widget-list-row">
                        <div>
                            <div class="admin-widget-list-title">${escapeHtml(item.name)}</div>
                            <div class="admin-widget-list-copy">${escapeHtml(item.account)} · ${escapeHtml(item.phone)} · ${escapeHtml(item.email || "—")}</div>
                        </div>
                        ${renderBadge("user-status", item.status, userStatusText(item.status))}
                    </div>
                    <div class="admin-widget-list-copy">Тариф: ${escapeHtml(item.tariff)} · Баланс: ${formatCurrency(item.balance)}</div>
                </article>
            `,
            "Совпадений нет",
            "Попробуйте уточнить лицевой счёт, телефон или имя."
        );
    }

    function searchAbonents() {
        const query = String(nodes.search?.value || "").trim().toLowerCase();
        if (!query) {
            nodes.searchResults.innerHTML = emptyState("Введите запрос", "Например, DEMO77777, +7 999 или имя абонента.");
            return;
        }
        const snapshot = getSnapshot();
        const results = snapshot.abonents.filter((item) => {
            const haystack = `${item.account} ${item.name} ${item.phone} ${item.email || ""}`.toLowerCase();
            return haystack.includes(query);
        }).slice(0, 6);
        renderSearchResults(results);
    }

    function populateTariffsSelect() {
        if (!nodes.userTariff) return;
        nodes.userTariff.innerHTML = getTariffs()
            .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${item.speed} Мбит/с · ${formatCurrency(item.price)}</option>`)
            .join("");
    }

    function appendActivity(entry) {
        const dashboard = getDashboardState();
        const next = { id: `evt-${Math.random().toString(36).slice(2, 9)}`, ...entry };
        dashboard.activity = [next, ...(dashboard.activity || [])].slice(0, 40);
        setDashboardState(dashboard);
    }

    function createNewUser(payload) {
        const dashboard = getDashboardState();
        const nextId = Number(dashboard.lastUserId || dashboard.abonents.length || 0) + 1;
        const tariffs = getTariffs();
        const selectedTariff = tariffs.find((item) => item.name === payload.tariff) || tariffs[0];

        dashboard.abonents.unshift({
            id: nextId,
            account: `DEMO${77770 + nextId}`,
            name: payload.name,
            phone: payload.phone,
            email: payload.email,
            tariff: selectedTariff?.name || payload.tariff,
            tariffSpeed: Number(selectedTariff?.speed || 100),
            balance: Number(payload.balance || 0),
            status: "active",
            debtDays: 0,
            speedShare: 88,
            registeredAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
        });
        dashboard.lastUserId = nextId;
        setDashboardState(dashboard);

        appendActivity({
            type: "user",
            title: "Новый абонент создан",
            description: `${payload.name} · ${selectedTariff?.name || payload.tariff}`,
            actor: currentActor(),
            at: new Date().toISOString(),
        });

        toast(`Абонент «${payload.name}» добавлен.`, "success");
    }

    function createManualTicket(payload) {
        const manual = readJson(STORAGE.ticketsManual, []);
        const maxId = Math.max(123, ...manual.map((item) => Number(item.id || 0)), ...defaultTickets().map((item) => Number(item.id || 0)));
        const nextTicket = {
            id: maxId + 1,
            created_at: new Date().toISOString(),
            user_name: payload.user,
            user_phone: payload.phone,
            subject: payload.subject,
            priority: payload.priority,
            status: "new",
            assigned_to_name: "",
            description: payload.description,
        };
        manual.unshift(nextTicket);
        setManualTickets(manual.slice(0, 50));

        appendActivity({
            type: "ticket",
            title: `Заявка №${nextTicket.id} создана`,
            description: `${payload.user} · ${payload.subject}`,
            actor: currentActor(),
            at: nextTicket.created_at,
        });

        toast(`Заявка №${nextTicket.id} добавлена в очередь.`, "success");
    }

    function createManualPayment(payload) {
        const payments = getPayments();
        const dashboard = getDashboardState();
        const maxId = Math.max(1000, ...payments.map((item) => Number(item.id || 0)));
        const targetUser = dashboard.abonents.find((user) => user.name.toLowerCase() === payload.user.toLowerCase());
        const payment = {
            id: maxId + 1,
            date: new Date().toISOString(),
            abonent: payload.user,
            account: targetUser?.account || `MANUAL${maxId + 1}`,
            type: "manual",
            amount: Number(payload.amount || 0),
            method: "manual",
            status: "success",
            operator: currentActor(),
            comment: payload.comment || "Ручное зачисление через дашборд",
            phone: targetUser?.phone || "—",
        };
        payments.unshift(payment);
        setPayments(payments.slice(0, 80));

        if (targetUser) {
            targetUser.balance = Number(targetUser.balance || 0) + payment.amount;
            targetUser.lastActivity = new Date().toISOString();
            setDashboardState(dashboard);
        }

        appendActivity({
            type: "payment",
            title: `Ручное зачисление ${formatCurrency(payment.amount)}`,
            description: `${payload.user} · ${payment.comment}`,
            actor: currentActor(),
            at: payment.date,
        });

        toast(`Баланс абонента «${payload.user}» пополнен.`, "success");
    }

    function buildPrintableReport(snapshot) {
        const cards = metricCards(snapshot);
        return `
            <html lang="ru">
            <head>
                <meta charset="utf-8">
                <title>MTN Admin Dashboard Report</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 32px; color: #111827; }
                    h1 { margin-bottom: 8px; }
                    .meta { color: #6b7280; margin-bottom: 24px; }
                    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
                    .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px; }
                    .card strong { display: block; color: #6b7280; margin-bottom: 8px; }
                    .card span { font-size: 24px; font-weight: 700; }
                    ul { padding-left: 18px; }
                </style>
            </head>
            <body>
                <h1>MTN Admin Dashboard</h1>
                <div class="meta">Сформировано ${escapeHtml(formatDateTime(new Date().toISOString()))} · роль ${escapeHtml(state.role)}</div>
                <div class="grid">
                    ${cards.map((card) => `<div class="card"><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.value)}</span><div>${escapeHtml(card.meta)}</div></div>`).join("")}
                </div>
                <h2>Заявки высокого приоритета</h2>
                <ul>
                    ${snapshot.tickets
                        .filter((ticket) => ticket.priority === "high" && TICKET_OPEN_STATUSES.has(ticket.status))
                        .slice(0, 5)
                        .map((ticket) => `<li>№${ticket.id} · ${escapeHtml(ticket.user_name)} · ${escapeHtml(ticket.subject)}</li>`)
                        .join("") || "<li>Срочных заявок нет</li>"}
                </ul>
                <h2>Абоненты с задолженностью</h2>
                <ul>
                    ${snapshot.abonents
                        .filter((user) => Number(user.balance || 0) < 0)
                        .slice(0, 5)
                        .map((user) => `<li>${escapeHtml(user.account)} · ${escapeHtml(user.name)} · ${escapeHtml(formatCurrency(user.balance))}</li>`)
                        .join("") || "<li>Должников нет</li>"}
                </ul>
            </body>
            </html>
        `;
    }

    function exportReport(snapshot) {
        const reportWindow = window.open("", "_blank", "width=1000,height=840");
        if (!reportWindow) {
            toast("Разрешите всплывающие окна для печати отчёта.", "warning");
            return;
        }
        reportWindow.document.open();
        reportWindow.document.write(buildPrintableReport(snapshot));
        reportWindow.document.close();
        reportWindow.focus();
        reportWindow.print();
        toast("Открылся печатный отчёт. Его можно сохранить как PDF через браузер.", "success");
    }

    function applyWidgetOrder() {
        const order = readJson(STORAGE.widgets, []);
        if (!Array.isArray(order) || !order.length || !nodes.widgetGrid) return;
        const lookup = new Map(Array.from(nodes.widgetGrid.children).map((node) => [node.dataset.widgetId, node]));
        order.forEach((id) => {
            const node = lookup.get(id);
            if (node) nodes.widgetGrid.appendChild(node);
        });
    }

    function initSortable() {
        if (!nodes.widgetGrid || typeof window.Sortable === "undefined") return;
        state.sortable = new window.Sortable(nodes.widgetGrid, {
            animation: 180,
            handle: ".admin-widget-handle",
            draggable: ".admin-widget",
            onEnd() {
                const order = Array.from(nodes.widgetGrid.children).map((node) => node.dataset.widgetId);
                writeJson(STORAGE.widgets, order);
            },
        });
    }

    function renderRoleSwitch() {
        if (nodes.roleSwitch) nodes.roleSwitch.value = state.role;
    }

    function renderAll() {
        applyTheme();
        renderRoleSwitch();
        toggleRoleScopedBlocks();
        populateTariffsSelect();

        const snapshot = getSnapshot();
        renderKpis(snapshot);
        renderConnectionsChart(snapshot);
        renderTicketsChart(snapshot);
        renderProblemZones(snapshot);
        renderActivity(snapshot);
        if (!String(nodes.search?.value || "").trim()) {
            nodes.searchResults.innerHTML = emptyState("Быстрый поиск", "Введите имя, телефон или лицевой счёт абонента.");
        } else {
            searchAbonents();
        }
    }

    function mutateConnections(dashboard) {
        const series = dashboard.connections || [];
        if (!series.length) return;
        const latest = series[series.length - 1];
        const delta = [-2, -1, 0, 1, 2, 3][Math.floor(Math.random() * 6)];
        latest.count = Math.max(2, Number(latest.count || 0) + delta);
    }

    function mutateOperators() {
        const operators = getOperators();
        const current = operators.filter((item) => item.status === "active");
        if (!current.length) return;
        const target = current[Math.floor(Math.random() * current.length)];
        target.lastLogin = new Date().toISOString();
        target.activeTickets = Math.max(0, Number(target.activeTickets || 0) + (Math.random() > 0.5 ? 1 : -1));
        setOperators(operators);
    }

    function mutateAbonents(dashboard) {
        if (!dashboard.abonents?.length) return;
        const target = dashboard.abonents[Math.floor(Math.random() * dashboard.abonents.length)];
        target.speedShare = Math.max(52, Math.min(98, Number(target.speedShare || 80) + (Math.random() > 0.5 ? 3 : -4)));
        if (Number(target.balance || 0) < 0) target.debtDays = Math.min(45, Number(target.debtDays || 0) + 1);
        target.lastActivity = new Date().toISOString();
    }

    function simulateNewTicket() {
        const themes = ["Нет интернета", "Снижена скорость", "Проблема с оплатой", "Технические работы"];
        const users = getDashboardState().abonents;
        if (!users.length) return false;
        const target = users[Math.floor(Math.random() * users.length)];
        const manual = readJson(STORAGE.ticketsManual, []);
        const nextId = Math.max(123, ...defaultTickets().map((item) => item.id), ...manual.map((item) => Number(item.id || 0))) + 1;
        const priority = Math.random() > 0.65 ? "high" : Math.random() > 0.45 ? "medium" : "low";
        const ticket = {
            id: nextId,
            created_at: new Date().toISOString(),
            user_name: target.name,
            user_phone: target.phone,
            subject: themes[Math.floor(Math.random() * themes.length)],
            priority,
            status: "new",
            assigned_to_name: "",
        };
        manual.unshift(ticket);
        setManualTickets(manual.slice(0, 50));
        appendActivity({
            type: "ticket",
            title: `Новая заявка №${ticket.id}`,
            description: `${target.name} · ${ticket.subject}`,
            actor: "Система",
            at: ticket.created_at,
        });
        return true;
    }

    function simulateNewPayment() {
        const dashboard = getDashboardState();
        if (!dashboard.abonents.length) return false;
        const target = dashboard.abonents[Math.floor(Math.random() * dashboard.abonents.length)];
        const payments = getPayments();
        const nextId = Math.max(1000, ...payments.map((item) => Number(item.id || 0))) + 1;
        const amount = [300, 500, 790, 1000, 1500][Math.floor(Math.random() * 5)];
        payments.unshift({
            id: nextId,
            date: new Date().toISOString(),
            abonent: target.name,
            account: target.account,
            type: "topup",
            amount,
            method: Math.random() > 0.5 ? "sbp" : "card",
            status: "success",
            operator: "Система",
            comment: "Автоматически зафиксированное пополнение",
            phone: target.phone,
        });
        target.balance = Number(target.balance || 0) + amount;
        setPayments(payments.slice(0, 80));
        setDashboardState(dashboard);
        appendActivity({
            type: "payment",
            title: `Платёж на ${formatCurrency(amount)}`,
            description: `${target.name} · пополнение баланса`,
            actor: "Система",
            at: new Date().toISOString(),
        });
        return true;
    }

    function ticketsLastHourCount() {
        const hourAgo = Date.now() - 3600000;
        return getTickets().filter((ticket) => new Date(ticket.created_at).getTime() >= hourAgo).length;
    }

    function pollUpdate(manual = false) {
        const before = ticketsLastHourCount();
        const dashboard = getDashboardState();

        mutateConnections(dashboard);
        mutateAbonents(dashboard);
        mutateOperators();
        setDashboardState(dashboard);

        let createdTicket = false;
        if (Math.random() > 0.62) createdTicket = simulateNewTicket();
        if (state.role === "admin" && Math.random() > 0.68) simulateNewPayment();

        renderAll();

        const after = ticketsLastHourCount();
        if (!manual && before > 0 && after >= Math.ceil(before * 2) && after >= 6) {
            toast(`За последний час поступило ${after} новых заявок. Проверьте очередь.`, "warning", "Аномалия");
        } else if (!manual && createdTicket) {
            toast("Поступила новая заявка в очередь.", "info");
        }
        state.previousHourlyTickets = after;
    }

    function bindActivityFilters() {
        root.querySelectorAll("[data-activity-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                state.eventFilter = button.dataset.activityFilter || "all";
                renderActivity(getSnapshot());
            });
        });
    }

    function bindQuickActions() {
        root.querySelectorAll("[data-dashboard-action]").forEach((button) => {
            button.addEventListener("click", () => {
                const action = button.dataset.dashboardAction;
                if ((action === "new-user" || action === "manual-payment") && state.role !== "admin") {
                    toast("В режиме operator это действие недоступно.", "warning");
                    return;
                }
                if (action === "new-user") openModal("adminDashboardUserModal");
                if (action === "new-ticket") openModal("adminDashboardTicketModal");
                if (action === "manual-payment") openModal("adminDashboardPaymentModal");
                if (action === "export") exportReport(getSnapshot());
            });
        });
    }

    function bindModalClose() {
        document.querySelectorAll("[data-dashboard-close]").forEach((button) => {
            button.addEventListener("click", () => closeModal(button.dataset.dashboardClose));
        });
        document.querySelectorAll(".admin-dashboard-modal").forEach((modal) => {
            modal.addEventListener("click", (event) => {
                if (event.target === modal) closeModal(modal);
            });
        });
    }

    function bindForms() {
        nodes.userForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            createNewUser({
                name: document.getElementById("adminDashboardUserName").value.trim(),
                phone: document.getElementById("adminDashboardUserPhone").value.trim(),
                email: document.getElementById("adminDashboardUserEmail").value.trim(),
                tariff: document.getElementById("adminDashboardUserTariff").value,
                balance: Number(document.getElementById("adminDashboardUserBalance").value || 0),
            });
            nodes.userForm.reset();
            populateTariffsSelect();
            closeModal("adminDashboardUserModal");
            renderAll();
        });

        nodes.ticketForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            createManualTicket({
                user: document.getElementById("adminDashboardTicketUser").value.trim(),
                phone: document.getElementById("adminDashboardTicketPhone").value.trim(),
                subject: document.getElementById("adminDashboardTicketSubject").value.trim(),
                priority: document.getElementById("adminDashboardTicketPriority").value,
                description: document.getElementById("adminDashboardTicketDescription").value.trim(),
            });
            nodes.ticketForm.reset();
            closeModal("adminDashboardTicketModal");
            renderAll();
        });

        nodes.paymentForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            const user = document.getElementById("adminDashboardPaymentUser").value.trim();
            const amount = Number(document.getElementById("adminDashboardPaymentAmount").value || 0);
            if (!user || amount <= 0) {
                toast("Укажите абонента и корректную сумму.", "error");
                return;
            }
            if (!window.confirm(`Зачислить ${formatCurrency(amount)} абоненту ${user}?`)) return;

            createManualPayment({
                user,
                amount,
                comment: document.getElementById("adminDashboardPaymentComment").value.trim(),
            });
            nodes.paymentForm.reset();
            closeModal("adminDashboardPaymentModal");
            renderAll();
        });
    }

    function bindControls() {
        nodes.roleSwitch?.addEventListener("change", () => {
            state.role = normalizeRole(nodes.roleSwitch.value);
            window.localStorage.setItem(STORAGE.role, state.role);
            renderAll();
        });

        nodes.themeToggle?.addEventListener("click", () => {
            state.theme = state.theme === "dark" ? "light" : "dark";
            window.localStorage.setItem(STORAGE.theme, state.theme);
            renderAll();
        });

        nodes.refresh?.addEventListener("click", () => {
            pollUpdate(true);
            toast("Данные дашборда обновлены.", "success");
        });

        nodes.exportPdf?.addEventListener("click", () => exportReport(getSnapshot()));
        nodes.searchBtn?.addEventListener("click", searchAbonents);
        nodes.search?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                searchAbonents();
            }
        });
    }

    function startPolling() {
        if (state.pollTimer) window.clearInterval(state.pollTimer);
        state.previousHourlyTickets = ticketsLastHourCount();
        state.pollTimer = window.setInterval(() => pollUpdate(false), POLL_INTERVAL);
    }

    function init() {
        ensureStorageSeed();
        applyWidgetOrder();
        initSortable();
        bindActivityFilters();
        bindQuickActions();
        bindModalClose();
        bindForms();
        bindControls();
        renderAll();
        startPolling();
    }

    init();
})();
