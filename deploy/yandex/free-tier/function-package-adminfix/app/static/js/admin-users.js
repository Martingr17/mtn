(function () {
    const page = document.getElementById("adminUsersPage");
    if (!page || !window.OperatorUI) {
        return;
    }

    const FILTER_PRESETS_KEY = "mtn.admin.users.presets.v2";
    const USER_META_KEY = "mtn.admin.users.meta.v2";
    const OPEN_TICKET_STATUSES = new Set(["new", "in_progress", "waiting_customer", "escalated"]);

    const state = {
        staffUser: null,
        role: "operator",
        users: [],
        filteredUsers: [],
        details: new Map(),
        presets: [],
        meta: {},
        selection: new Set(),
        currentPageIds: [],
        page: 1,
        pageSize: 20,
        sortKey: "id",
        sortDirection: "asc",
        activeProfileUserId: null,
        activeProfileTab: "overview",
        filters: {
            search: "",
            status: "all",
            tariff: "all",
            balance: "all",
            date: "all",
        },
    };

    const nodes = {
        metricTotal: document.getElementById("adminUsersMetricTotal"),
        metricTotalNote: document.getElementById("adminUsersMetricTotalNote"),
        metricActive: document.getElementById("adminUsersMetricActive"),
        metricDebt: document.getElementById("adminUsersMetricDebt"),
        metricTickets: document.getElementById("adminUsersMetricTickets"),
        roleBadge: document.getElementById("adminUsersRoleBadge"),
        search: document.getElementById("adminUsersSearchInput"),
        status: document.getElementById("adminUsersStatusSelect"),
        tariff: document.getElementById("adminUsersTariffSelect"),
        balance: document.getElementById("adminUsersBalanceSelect"),
        date: document.getElementById("adminUsersDateSelect"),
        preset: document.getElementById("adminUsersPresetSelect"),
        pageSize: document.getElementById("adminUsersPageSizeSelect"),
        apply: document.getElementById("adminUsersApplyButton"),
        savePreset: document.getElementById("adminUsersSavePresetButton"),
        reset: document.getElementById("adminUsersResetButton"),
        export: document.getElementById("adminUsersExportButton"),
        create: document.getElementById("adminUsersCreateButton"),
        resultsText: document.getElementById("adminUsersResultsText"),
        tableBody: document.getElementById("adminUsersTableBody"),
        mobileList: document.getElementById("adminUsersMobileList"),
        selectAll: document.getElementById("adminUsersSelectAll"),
        bulkBlock: document.getElementById("adminUsersBulkBlockButton"),
        bulkUnblock: document.getElementById("adminUsersBulkUnblockButton"),
        paginationText: document.getElementById("adminUsersPaginationText"),
        pageIndicator: document.getElementById("adminUsersPageIndicator"),
        prev: document.getElementById("adminUsersPrevButton"),
        next: document.getElementById("adminUsersNextButton"),
        profileLead: document.getElementById("adminUsersProfileLead"),
        profileContent: document.getElementById("adminUsersProfileContent"),
        form: document.getElementById("adminUsersForm"),
        formTitle: document.getElementById("adminUsersFormTitle"),
        formLead: document.getElementById("adminUsersFormLead"),
        formMode: document.getElementById("adminUsersFormMode"),
        formUserId: document.getElementById("adminUsersFormUserId"),
        formLastName: document.getElementById("adminUsersLastNameInput"),
        formFirstName: document.getElementById("adminUsersFirstNameInput"),
        formMiddleName: document.getElementById("adminUsersMiddleNameInput"),
        formPhone: document.getElementById("adminUsersPhoneInput"),
        formEmail: document.getElementById("adminUsersEmailInput"),
        formBilling: document.getElementById("adminUsersBillingInput"),
        formAddress: document.getElementById("adminUsersAddressInput"),
        formTariff: document.getElementById("adminUsersCreateTariffSelect"),
        formSubmit: document.getElementById("adminUsersFormSubmit"),
        paymentForm: document.getElementById("adminUsersPaymentForm"),
        paymentUserId: document.getElementById("adminUsersPaymentUserId"),
        paymentLead: document.getElementById("adminUsersPaymentLead"),
        paymentAmount: document.getElementById("adminUsersPaymentAmountInput"),
        paymentComment: document.getElementById("adminUsersPaymentCommentInput"),
        paymentSubmit: document.getElementById("adminUsersPaymentSubmit"),
        notifyForm: document.getElementById("adminUsersNotifyForm"),
        notifyUserId: document.getElementById("adminUsersNotifyUserId"),
        notifyLead: document.getElementById("adminUsersNotifyLead"),
        notifyTitle: document.getElementById("adminUsersNotifyTitleInput"),
        notifyType: document.getElementById("adminUsersNotifyTypeSelect"),
        notifyPriority: document.getElementById("adminUsersNotifyPrioritySelect"),
        notifyMessage: document.getElementById("adminUsersNotifyMessageInput"),
        notifySubmit: document.getElementById("adminUsersNotifySubmit"),
    };

    function loadJSON(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        window.localStorage.setItem(key, JSON.stringify(value));
    }

    function normalizeRole(role) {
        const value = String(role || "").toLowerCase();
        if (value === "super_admin") return "super_admin";
        if (value === "admin") return "admin";
        return "operator";
    }

    function canManageUsers() {
        return state.role === "admin" || state.role === "super_admin";
    }

    function getRoleBadgeLabel() {
        if (state.role === "super_admin") return "Роль: суперадмин";
        if (state.role === "admin") return "Роль: администратор";
        return "Роль: оператор";
    }

    function getMeta(userId) {
        return state.meta[String(userId)] || {};
    }

    function updateMeta(userId, patch) {
        const key = String(userId);
        state.meta[key] = {
            ...(state.meta[key] || {}),
            ...patch,
        };
        saveJSON(USER_META_KEY, state.meta);
    }

    function appendMetaEntry(userId, entryKey, entry) {
        const meta = getMeta(userId);
        const items = Array.isArray(meta[entryKey]) ? [...meta[entryKey]] : [];
        items.unshift(entry);
        updateMeta(userId, { [entryKey]: items.slice(0, 20) });
    }

    function getUserById(userId) {
        return state.users.find((item) => String(item.id) === String(userId)) || null;
    }

    function digitsOnly(value) {
        return String(value || "").replace(/\D/g, "");
    }

    function normalizePhoneForSearch(value) {
        return digitsOnly(value).replace(/^8/, "7");
    }

    function maskPhone(value) {
        const digits = digitsOnly(value).replace(/^8/, "7").replace(/^9/, "79").slice(0, 11);
        const normalized = digits.startsWith("7") ? digits : `7${digits}`.slice(0, 11);
        const d = normalized.slice(1);
        let result = "+7";
        if (d.length > 0) result += ` (${d.slice(0, 3)}`;
        if (d.length >= 3) result += ")";
        if (d.length > 3) result += ` ${d.slice(3, 6)}`;
        if (d.length > 6) result += `-${d.slice(6, 8)}`;
        if (d.length > 8) result += `-${d.slice(8, 10)}`;
        return result;
    }

    function formatDate(value, includeTime = false) {
        return OperatorUI.formatDate(value, { includeTime });
    }

    function formatCurrency(value) {
        return OperatorUI.formatCurrency(Number(value || 0));
    }

    function escapeHTML(value) {
        return OperatorUI.escapeHTML(String(value ?? ""));
    }

    function buildFullName(firstName, lastName, middleName, fallback) {
        const parts = [lastName, firstName, middleName].filter(Boolean);
        return parts.join(" ").trim() || fallback || "Без имени";
    }

    function getInitials(record) {
        const parts = [record.first_name, record.last_name].filter(Boolean);
        if (!parts.length) return "MT";
        return parts
            .map((part) => String(part || "").trim().charAt(0).toUpperCase())
            .join("")
            .slice(0, 2);
    }

    function statusBadge(record) {
        if (record.status_key === "blocked") return "badge-danger";
        if (record.status_key === "suspended") return "badge-warning";
        return "badge-success";
    }

    function statusOrder(record) {
        if (record.status_key === "blocked") return 3;
        if (record.status_key === "suspended") return 2;
        return 1;
    }

    function paymentBadge(status) {
        if (status === "succeeded") return "badge-success";
        if (status === "pending") return "badge-warning";
        if (status === "failed" || status === "cancelled" || status === "canceled") return "badge-danger";
        return "badge-info";
    }

    function ticketBadge(status) {
        if (status === "resolved" || status === "closed") return "badge-success";
        if (status === "waiting_customer") return "badge-warning";
        if (status === "escalated") return "badge-danger";
        return "badge-info";
    }

    function ticketStatusLabel(status) {
        return {
            new: "Новая",
            in_progress: "В работе",
            waiting_customer: "Ожидает клиента",
            resolved: "Решена",
            closed: "Закрыта",
            escalated: "Эскалация",
        }[status] || status || "—";
    }

    function compareValues(left, right) {
        if (typeof left === "number" && typeof right === "number") {
            return left - right;
        }
        return String(left || "").localeCompare(String(right || ""), "ru", { sensitivity: "base", numeric: true });
    }

    function buildComparable(record, key) {
        switch (key) {
            case "id":
                return Number(record.id || 0);
            case "billing_id":
                return record.billing_id || "";
            case "full_name":
                return record.full_name || "";
            case "tariff_name":
                return record.tariff_name || "";
            case "balance":
                return Number(record.balance ?? -999999);
            case "open_tickets":
                return Number(record.open_tickets || 0);
            case "last_activity_at":
                return new Date(record.last_activity_at || 0).getTime();
            case "status_order":
                return statusOrder(record);
            default:
                return record[key] || "";
        }
    }

    function collectFiltersFromUI() {
        state.filters.search = String(nodes.search.value || "").trim();
        state.filters.status = nodes.status.value || "all";
        state.filters.tariff = nodes.tariff.value || "all";
        state.filters.balance = nodes.balance.value || "all";
        state.filters.date = nodes.date.value || "all";
        state.pageSize = Number(nodes.pageSize.value || 20);
    }

    function syncFiltersToUI() {
        nodes.search.value = state.filters.search;
        nodes.status.value = state.filters.status;
        nodes.tariff.value = state.filters.tariff;
        nodes.balance.value = state.filters.balance;
        nodes.date.value = state.filters.date;
        nodes.pageSize.value = String(state.pageSize);
    }

    function populatePresets() {
        const currentValue = nodes.preset.value;
        nodes.preset.innerHTML = ['<option value="">Не выбран</option>']
            .concat(
                state.presets.map(
                    (preset) => `<option value="${escapeHTML(preset.id)}">${escapeHTML(preset.name)}</option>`
                )
            )
            .join("");
        nodes.preset.value = state.presets.some((preset) => preset.id === currentValue) ? currentValue : "";
    }

    function populateTariffOptions() {
        const currentValue = state.filters.tariff;
        const tariffNames = Array.from(
            new Set(
                state.users
                    .map((user) => user.tariff_name)
                    .filter((value) => value && value !== "—")
            )
        ).sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));

        nodes.tariff.innerHTML = ['<option value="all">Все тарифы</option>']
            .concat(tariffNames.map((name) => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`))
            .join("");
        nodes.tariff.value = tariffNames.includes(currentValue) ? currentValue : "all";
    }

    function populateCreateTariffOptions() {
        const tariffs = [];
        state.users.forEach((user) => {
            (user.available_tariffs || []).forEach((tariff) => {
                if (!tariffs.some((item) => item.id === tariff.id)) {
                    tariffs.push(tariff);
                }
            });
        });

        tariffs.sort((left, right) => Number(left.price || 0) - Number(right.price || 0));
        nodes.formTariff.innerHTML = ['<option value="">По умолчанию</option>']
            .concat(
                tariffs.map(
                    (tariff) =>
                        `<option value="${tariff.id}">${escapeHTML(tariff.name)} · ${escapeHTML(tariff.speed_mbps || tariff.speed || 0)} Мбит/с · ${escapeHTML(formatCurrency(tariff.price || 0))}</option>`
                )
            )
            .join("");
    }

    function buildUserRecord(baseUser, detail) {
        const meta = getMeta(baseUser.id);
        const detailUser = detail?.user || {};
        const tariff = detail?.tariff || {};
        const accountInfo = detail?.account_info || {};
        const firstName = meta.first_name ?? detailUser.first_name ?? baseUser.first_name ?? "";
        const lastName = meta.last_name ?? detailUser.last_name ?? baseUser.last_name ?? "";
        const middleName = meta.middle_name ?? detailUser.middle_name ?? baseUser.middle_name ?? "";
        const fullName = buildFullName(firstName, lastName, middleName, detailUser.full_name || baseUser.full_name || baseUser.phone);
        const balance =
            typeof detail?.balance === "number"
                ? Number(detail.balance)
                : typeof baseUser.balance === "number"
                    ? Number(baseUser.balance)
                    : null;
        const isBlocked = Boolean(detailUser.is_blocked ?? baseUser.is_blocked);
        const isActive = Boolean(detailUser.is_active ?? baseUser.is_active);
        const statusKey = isBlocked ? "blocked" : balance !== null && balance < 0 ? "suspended" : "active";

        return {
            id: baseUser.id,
            billing_id: detailUser.billing_id || baseUser.billing_id,
            phone: detailUser.phone || baseUser.phone,
            email: meta.email ?? detailUser.email ?? baseUser.email ?? "",
            first_name: firstName,
            last_name: lastName,
            middle_name: middleName,
            full_name: fullName,
            display_name: detailUser.display_name || baseUser.display_name || fullName,
            address: meta.address || accountInfo.address || accountInfo.installation_address || "",
            created_at: detailUser.created_at || baseUser.created_at,
            last_login_at: detailUser.last_login_at || baseUser.last_login_at,
            last_payment_at: baseUser.last_payment_at || null,
            last_activity_at: detailUser.last_login_at || baseUser.last_payment_at || detailUser.created_at || baseUser.created_at,
            balance,
            has_debt: balance !== null && balance < 0,
            balanceSeverity: balance === null ? "unknown" : balance < -500 ? "critical" : balance < 0 ? "debt" : "ok",
            is_active: isActive,
            is_blocked: isBlocked,
            status_key: statusKey,
            status_label: statusKey === "blocked" ? "Заблокирован" : statusKey === "suspended" ? "Приостановлен" : "Активен",
            open_tickets: Number(detail?.recent_tickets?.filter((ticket) => OPEN_TICKET_STATUSES.has(ticket.status)).length ?? baseUser.open_tickets ?? 0),
            total_tickets: Number(detail?.total_tickets ?? baseUser.total_tickets ?? 0),
            tariff_name: tariff.name || tariff.tariff_name || "—",
            tariff_speed: Number(tariff.speed_mbps || tariff.speed || 0),
            tariff_price: Number(tariff.price || 0),
            tariff,
            current_billing_tariff_id: detail?.current_billing_tariff_id || tariff.tariff_id || null,
            account_info: accountInfo,
            available_tariffs: detail?.available_tariffs || [],
            recent_payments: detail?.recent_payments || [],
            recent_tickets: detail?.recent_tickets || [],
            activities: detail?.activities || [],
            monitoring_summary: detail?.monitoring_summary || {},
            monitoring_recent_alerts: detail?.monitoring_recent_alerts || [],
            detail: detail || null,
            status_order: statusOrder({ status_key: statusKey }),
        };
    }

    async function refreshUserDetail(userId, silent = true) {
        try {
            const detail = await OperatorUI.request(`/api/v1/admin/abonents/${userId}?silent=${silent ? "true" : "false"}`, { auth: true });
            state.details.set(String(userId), detail);
            state.users = state.users.map((record) =>
                String(record.id) === String(userId) ? buildUserRecord(detail.user || record, detail) : record
            );
            applyFilters({ preservePage: true });
            return getUserById(userId);
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось обновить карточку абонента.", "error");
            return getUserById(userId);
        }
    }

    async function loadUsers() {
        nodes.tableBody.innerHTML = `
            <tr>
                <td colspan="11"><div class="skeleton skeleton-panel-lg"></div></td>
            </tr>
        `;
        nodes.mobileList.hidden = true;

        try {
            const response = await OperatorUI.request("/api/v1/admin/abonents?page=1&page_size=100", { auth: true });
            const baseUsers = response.items || [];
            const detailResults = await Promise.all(
                baseUsers.map(async (user) => {
                    try {
                        const detail = await OperatorUI.request(`/api/v1/admin/abonents/${user.id}?silent=true`, { auth: true });
                        state.details.set(String(user.id), detail);
                        return buildUserRecord(user, detail);
                    } catch (error) {
                        state.details.set(String(user.id), null);
                        return buildUserRecord(user, null);
                    }
                })
            );

            state.users = detailResults;
            const validIds = new Set(detailResults.map((item) => String(item.id)));
            state.selection = new Set(Array.from(state.selection).filter((id) => validIds.has(String(id))));
            populateTariffOptions();
            populateCreateTariffOptions();
            applyFilters();
        } catch (error) {
            nodes.tableBody.innerHTML = `
                <tr>
                    <td colspan="11">
                        ${OperatorUI.createEmptyState("fas fa-triangle-exclamation", "Не удалось загрузить каталог", error.message || "Попробуйте обновить страницу позже.")}
                    </td>
                </tr>
            `;
            nodes.mobileList.hidden = false;
            nodes.mobileList.innerHTML = OperatorUI.createEmptyState(
                "fas fa-triangle-exclamation",
                "Ошибка загрузки",
                error.message || "Каталог абонентов пока недоступен."
            );
        }
    }

    function filterByDate(record, dateFilter) {
        if (dateFilter === "all") return true;
        const created = new Date(record.created_at || 0).getTime();
        if (!created) return false;
        const now = Date.now();
        const diff = now - created;
        if (dateFilter === "today") return diff <= 24 * 60 * 60 * 1000;
        if (dateFilter === "week") return diff <= 7 * 24 * 60 * 60 * 1000;
        if (dateFilter === "month") return diff <= 31 * 24 * 60 * 60 * 1000;
        return true;
    }

    function applyFilters({ preservePage = false } = {}) {
        collectFiltersFromUI();

        const searchTerm = state.filters.search.toLowerCase();
        const searchDigits = normalizePhoneForSearch(searchTerm);

        state.filteredUsers = state.users
            .filter((record) => {
                if (searchTerm) {
                    const haystack = [
                        record.billing_id,
                        record.phone,
                        record.email,
                        record.full_name,
                        record.first_name,
                        record.last_name,
                        record.address,
                    ]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase();
                    const phoneDigits = normalizePhoneForSearch(record.phone);
                    if (!haystack.includes(searchTerm) && (!searchDigits || !phoneDigits.includes(searchDigits))) {
                        return false;
                    }
                }

                if (state.filters.status !== "all" && record.status_key !== state.filters.status) return false;
                if (state.filters.tariff !== "all" && record.tariff_name !== state.filters.tariff) return false;
                if (state.filters.balance === "positive" && !(Number(record.balance || 0) >= 0)) return false;
                if (state.filters.balance === "debt" && !(Number(record.balance || 0) < 0)) return false;
                if (state.filters.balance === "critical" && !(Number(record.balance || 0) < -500)) return false;
                if (!filterByDate(record, state.filters.date)) return false;
                return true;
            })
            .sort((left, right) => {
                const comparison = compareValues(buildComparable(left, state.sortKey), buildComparable(right, state.sortKey));
                return state.sortDirection === "asc" ? comparison : comparison * -1;
            });

        if (!preservePage) {
            state.page = 1;
        }
        renderList();
    }

    function renderSortButtons() {
        document.querySelectorAll(".admin-users-sort").forEach((button) => {
            const key = button.dataset.sortKey || "";
            button.classList.toggle("is-active", state.sortKey === key);
            button.dataset.direction = state.sortKey === key ? state.sortDirection : "";
            const baseLabel = button.textContent.replace(/[↑↓]/g, "").trim();
            const suffix = state.sortKey === key ? (state.sortDirection === "asc" ? " ↑" : " ↓") : "";
            button.textContent = `${baseLabel}${suffix}`;
        });
    }

    function renderMetrics() {
        const total = state.filteredUsers.length;
        const active = state.filteredUsers.filter((user) => user.status_key === "active").length;
        const debt = state.filteredUsers.filter((user) => Number(user.balance || 0) < 0).length;
        const tickets = state.filteredUsers.reduce((sum, user) => sum + Number(user.open_tickets || 0), 0);

        nodes.metricTotal.textContent = String(total);
        nodes.metricTotalNote.textContent = total ? "После применения текущих фильтров" : "Нет совпадений по фильтрам";
        nodes.metricActive.textContent = String(active);
        nodes.metricDebt.textContent = String(debt);
        nodes.metricTickets.textContent = String(tickets);

        nodes.roleBadge.textContent = getRoleBadgeLabel();
        nodes.roleBadge.className = `badge ${canManageUsers() ? "badge-success" : "badge-warning"}`;
    }

    function renderSelectionInfo(pageItems) {
        const selectedOnPage = pageItems.filter((user) => state.selection.has(String(user.id))).length;
        const selectedTotal = state.selection.size;
        const pages = Math.max(1, Math.ceil(state.filteredUsers.length / state.pageSize));

        nodes.resultsText.textContent = state.filteredUsers.length
            ? `Найдено ${state.filteredUsers.length} абонентов. Выбрано: ${selectedTotal}. На странице: ${selectedOnPage}.`
            : "По текущим условиям абоненты не найдены.";
        nodes.pageIndicator.textContent = `${Math.min(state.page, pages)} / ${pages}`;
    }

    function renderPagination(pageItems) {
        const totalPages = Math.max(1, Math.ceil(state.filteredUsers.length / state.pageSize));
        const start = state.filteredUsers.length ? (state.page - 1) * state.pageSize + 1 : 0;
        const end = state.filteredUsers.length ? start + pageItems.length - 1 : 0;

        nodes.paginationText.textContent = state.filteredUsers.length
            ? `Показаны записи ${start}–${end} из ${state.filteredUsers.length}.`
            : "Нет данных для отображения.";
        nodes.prev.disabled = state.page <= 1;
        nodes.next.disabled = state.page >= totalPages;
        nodes.pageIndicator.textContent = `${Math.min(state.page, totalPages)} / ${totalPages}`;
    }

    function renderTable(pageItems) {
        state.currentPageIds = pageItems.map((item) => String(item.id));
        nodes.selectAll.checked = pageItems.length > 0 && pageItems.every((item) => state.selection.has(String(item.id)));

        if (!pageItems.length) {
            nodes.tableBody.innerHTML = `
                <tr>
                    <td colspan="11">
                        ${OperatorUI.createEmptyState("fas fa-users-slash", "Ничего не найдено", "Измените фильтры или попробуйте другой поисковый запрос.")}
                    </td>
                </tr>
            `;
            nodes.mobileList.hidden = false;
            nodes.mobileList.innerHTML = OperatorUI.createEmptyState(
                "fas fa-users-slash",
                "Список пуст",
                "Под текущие фильтры нет абонентов."
            );
            return;
        }

        nodes.tableBody.innerHTML = pageItems
            .map((user) => {
                const balanceClass =
                    user.balanceSeverity === "critical"
                        ? "admin-users-balance is-critical"
                        : user.balanceSeverity === "debt"
                            ? "admin-users-balance is-debt"
                            : "admin-users-balance";
                const rowClass =
                    user.balanceSeverity === "critical"
                        ? "admin-users-row is-critical-debt"
                        : user.balanceSeverity === "debt"
                            ? "admin-users-row is-warning-debt"
                            : "admin-users-row";

                return `
                    <tr class="${rowClass}" data-user-id="${user.id}">
                        <td class="cell-checkbox">
                            <input class="admin-users-row-checkbox" type="checkbox" value="${user.id}" ${state.selection.has(String(user.id)) ? "checked" : ""}>
                        </td>
                        <td>${escapeHTML(user.id)}</td>
                        <td><div class="table-title">${escapeHTML(user.billing_id)}</div><div class="table-copy">${escapeHTML(formatDate(user.created_at))}</div></td>
                        <td><div class="table-title">${escapeHTML(user.full_name)}</div><div class="table-copy">${escapeHTML(user.address || "Адрес не указан")}</div></td>
                        <td><div class="table-copy">${escapeHTML(maskPhone(user.phone))}</div><div class="table-copy">${escapeHTML(user.email || "Email не указан")}</div></td>
                        <td><div class="table-title">${escapeHTML(user.tariff_name || "—")}</div><div class="table-copy">${user.tariff_speed ? `${escapeHTML(user.tariff_speed)} Мбит/с` : "Скорость не указана"}</div></td>
                        <td><div class="${balanceClass}">${user.balance === null ? "—" : escapeHTML(formatCurrency(user.balance))}</div></td>
                        <td><span class="badge ${statusBadge(user)}">${escapeHTML(user.status_label)}</span></td>
                        <td><div class="table-title">${escapeHTML(user.open_tickets || 0)}</div><div class="table-copy">Всего: ${escapeHTML(user.total_tickets || 0)}</div></td>
                        <td>${escapeHTML(formatDate(user.last_activity_at, true))}</td>
                        <td>
                            <div class="action-row admin-users-row-actions">
                                <button class="btn btn-secondary btn-xs" type="button" data-action="view" data-user-id="${user.id}"><i class="fas fa-eye"></i>Карточка</button>
                                ${
                                    canManageUsers()
                                        ? `
                                            <button class="btn btn-secondary btn-xs" type="button" data-action="edit" data-user-id="${user.id}"><i class="fas fa-pen"></i>Ред.</button>
                                            <button class="btn ${user.is_blocked ? "btn-secondary" : "btn-danger"} btn-xs" type="button" data-action="${user.is_blocked ? "unblock" : "block"}" data-user-id="${user.id}">
                                                <i class="fas ${user.is_blocked ? "fa-lock-open" : "fa-lock"}"></i>${user.is_blocked ? "Разблок." : "Блок"}
                                            </button>
                                        `
                                        : ""
                                }
                            </div>
                        </td>
                    </tr>
                `;
            })
            .join("");

        nodes.mobileList.hidden = false;
        nodes.mobileList.innerHTML = pageItems
            .map(
                (user) => `
                    <article class="admin-users-mobile-card ${user.balanceSeverity === "critical" ? "is-critical-debt" : user.balanceSeverity === "debt" ? "is-warning-debt" : ""}" data-user-id="${user.id}">
                        <div class="toolbar">
                            <div>
                                <div class="table-title">${escapeHTML(user.full_name)}</div>
                                <div class="table-copy">${escapeHTML(user.billing_id)} · ${escapeHTML(maskPhone(user.phone))}</div>
                            </div>
                            <span class="badge ${statusBadge(user)}">${escapeHTML(user.status_label)}</span>
                        </div>
                        <div class="admin-users-mobile-meta">
                            <div><span>Тариф</span><strong>${escapeHTML(user.tariff_name || "—")}</strong></div>
                            <div><span>Баланс</span><strong>${user.balance === null ? "—" : escapeHTML(formatCurrency(user.balance))}</strong></div>
                            <div><span>Заявки</span><strong>${escapeHTML(user.open_tickets || 0)}</strong></div>
                            <div><span>Активность</span><strong>${escapeHTML(formatDate(user.last_activity_at, true))}</strong></div>
                        </div>
                        <div class="action-row">
                            <button class="btn btn-secondary btn-sm" type="button" data-action="view" data-user-id="${user.id}"><i class="fas fa-eye"></i>Карточка</button>
                            ${canManageUsers() ? `<button class="btn btn-secondary btn-sm" type="button" data-action="edit" data-user-id="${user.id}"><i class="fas fa-pen"></i>Редактировать</button>` : ""}
                        </div>
                    </article>
                `
            )
            .join("");
    }

    function renderList() {
        const totalPages = Math.max(1, Math.ceil(state.filteredUsers.length / state.pageSize));
        if (state.page > totalPages) {
            state.page = totalPages;
        }
        const start = (state.page - 1) * state.pageSize;
        const pageItems = state.filteredUsers.slice(start, start + state.pageSize);
        renderMetrics();
        renderSelectionInfo(pageItems);
        renderTable(pageItems);
        renderPagination(pageItems);
        renderSortButtons();
    }

    function openCreateModal() {
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор может только просматривать абонентов.", "warning");
            return;
        }
        nodes.form.reset();
        nodes.formMode.value = "create";
        nodes.formUserId.value = "";
        nodes.formTitle.textContent = "Новый абонент";
        nodes.formLead.textContent = "Создайте нового абонента и при необходимости задайте стартовый тариф.";
        nodes.formPhone.disabled = false;
        nodes.formBilling.disabled = false;
        nodes.formTariff.disabled = false;
        OperatorUI.openModal("adminUsersFormModal");
    }

    function openEditModal(userId) {
        const user = getUserById(userId);
        if (!user) return;
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор может только просматривать карточку абонента.", "warning");
            return;
        }

        nodes.form.reset();
        nodes.formMode.value = "edit";
        nodes.formUserId.value = String(user.id);
        nodes.formTitle.textContent = "Редактирование абонента";
        nodes.formLead.textContent = `Обновите контактные данные для ${user.full_name}.`;
        nodes.formLastName.value = user.last_name || "";
        nodes.formFirstName.value = user.first_name || "";
        nodes.formMiddleName.value = user.middle_name || "";
        nodes.formPhone.value = maskPhone(user.phone);
        nodes.formPhone.disabled = true;
        nodes.formEmail.value = user.email || "";
        nodes.formBilling.value = user.billing_id || "";
        nodes.formBilling.disabled = true;
        nodes.formAddress.value = user.address || "";
        nodes.formTariff.value = "";
        nodes.formTariff.disabled = true;
        OperatorUI.openModal("adminUsersFormModal");
    }

    function openPaymentModal(userId) {
        const user = getUserById(userId);
        if (!user) return;
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор не может пополнять баланс вручную.", "warning");
            return;
        }
        nodes.paymentForm.reset();
        nodes.paymentUserId.value = String(user.id);
        nodes.paymentLead.textContent = `Ручное зачисление для ${user.full_name} · ${user.billing_id}.`;
        OperatorUI.openModal("adminUsersPaymentModal");
    }

    function openNotifyModal(userId) {
        const user = getUserById(userId);
        if (!user) return;
        nodes.notifyForm.reset();
        nodes.notifyUserId.value = String(user.id);
        nodes.notifyLead.textContent = `Сообщение будет отправлено абоненту ${user.full_name}.`;
        nodes.notifyTitle.value = "Сообщение от MTN";
        OperatorUI.openModal("adminUsersNotifyModal");
    }

    async function toggleBlockState(userId, action) {
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор не может менять статус абонента.", "warning");
            return;
        }
        const user = getUserById(userId);
        if (!user) return;
        const confirmText = action === "block"
            ? `Заблокировать абонента ${user.full_name}?`
            : `Разблокировать абонента ${user.full_name}?`;
        if (!window.confirm(confirmText)) {
            return;
        }

        try {
            await OperatorUI.request(`/api/v1/admin/users/${userId}/${action}`, {
                method: "POST",
                auth: true,
            });
            OperatorUI.toast(
                action === "block" ? "Абонент заблокирован." : "Абонент разблокирован.",
                "success"
            );
            await loadUsers();
            if (state.activeProfileUserId && String(state.activeProfileUserId) === String(userId)) {
                await openProfile(userId, state.activeProfileTab);
            }
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось обновить статус абонента.", "error");
        }
    }

    async function runBulkAction(action) {
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор не может выполнять групповые действия.", "warning");
            return;
        }
        const ids = Array.from(state.selection);
        if (!ids.length) {
            OperatorUI.toast("Сначала выберите абонентов.", "warning");
            return;
        }

        try {
            await OperatorUI.request("/api/v1/admin/abonents/bulk-status", {
                method: "POST",
                auth: true,
                json: true,
                body: {
                    user_ids: ids.map((value) => Number(value)),
                    action,
                    reason:
                        action === "block"
                            ? "Массовая блокировка через административный раздел"
                            : "Массовая разблокировка через административный раздел",
                },
            });
            state.selection.clear();
            OperatorUI.toast(
                action === "block" ? "Выбранные абоненты заблокированы." : "Выбранные абоненты разблокированы.",
                "success"
            );
            await loadUsers();
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось выполнить групповое действие.", "error");
        }
    }

    async function changeTariff(userId, tariffId) {
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор не может менять тариф абонента.", "warning");
            return;
        }
        const user = getUserById(userId);
        if (!user || !tariffId) return;

        const nextTariff = (user.available_tariffs || []).find((tariff) => Number(tariff.id) === Number(tariffId));
        if (!nextTariff) {
            OperatorUI.toast("Выберите доступный тариф.", "warning");
            return;
        }
        if (String(user.current_billing_tariff_id || "") === String(nextTariff.billing_tariff_id || "")) {
            OperatorUI.toast("Этот тариф уже активен у абонента.", "warning");
            return;
        }

        try {
            await OperatorUI.request(
                `/api/v1/admin/force-tariff-change?user_id=${encodeURIComponent(userId)}&tariff_id=${encodeURIComponent(tariffId)}`,
                {
                    method: "POST",
                    auth: true,
                }
            );

            appendMetaEntry(userId, "tariffHistory", {
                at: new Date().toISOString(),
                previous: user.tariff_name || "Не определён",
                next: nextTariff.name,
                actor: state.staffUser?.full_name || state.staffUser?.phone || "Сотрудник MTN",
            });

            OperatorUI.toast(`Тариф изменён на «${nextTariff.name}».`, "success");
            await loadUsers();
            if (state.activeProfileUserId && String(state.activeProfileUserId) === String(userId)) {
                await openProfile(userId, "services");
            }
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось сменить тариф.", "error");
        }
    }

    async function submitUserForm(event) {
        event.preventDefault();
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор не может сохранять данные абонента.", "warning");
            return;
        }

        const mode = nodes.formMode.value;
        const firstName = String(nodes.formFirstName.value || "").trim();
        const lastName = String(nodes.formLastName.value || "").trim();
        const middleName = String(nodes.formMiddleName.value || "").trim();
        const email = String(nodes.formEmail.value || "").trim();
        const phone = normalizePhoneForSearch(nodes.formPhone.value);
        const billingId = String(nodes.formBilling.value || "").trim();
        const address = String(nodes.formAddress.value || "").trim();
        const tariffId = nodes.formTariff.value ? Number(nodes.formTariff.value) : null;

        if (mode === "create" && phone.length !== 11) {
            OperatorUI.toast("Введите корректный номер телефона.", "error");
            return;
        }
        if (mode === "create" && !firstName && !lastName) {
            OperatorUI.toast("Заполните имя или фамилию абонента.", "error");
            return;
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            OperatorUI.toast("Укажите корректный email.", "error");
            return;
        }

        OperatorUI.setButtonLoading(nodes.formSubmit, true, "Сохраняем...");
        try {
            if (mode === "create") {
                const payload = await OperatorUI.request("/api/v1/admin/abonents", {
                    method: "POST",
                    auth: true,
                    json: true,
                    body: {
                        phone: `+${phone}`,
                        billing_id: billingId || undefined,
                        email: email || undefined,
                        first_name: firstName || undefined,
                        last_name: lastName || undefined,
                        middle_name: middleName || undefined,
                        tariff_id: tariffId || undefined,
                    },
                });

                if (payload?.user?.id && address) {
                    updateMeta(payload.user.id, { address });
                }

                OperatorUI.closeModal("adminUsersFormModal");
                OperatorUI.toast("Абонент создан.", "success");
                await loadUsers();
                if (payload?.user?.id) {
                    await openProfile(payload.user.id, "overview");
                }
            } else {
                const userId = nodes.formUserId.value;
                await OperatorUI.request(`/api/v1/admin/abonents/${userId}`, {
                    method: "PATCH",
                    auth: true,
                    json: true,
                    body: {
                        email: email || null,
                        first_name: firstName || null,
                        last_name: lastName || null,
                        middle_name: middleName || null,
                    },
                });
                updateMeta(userId, { address });
                OperatorUI.closeModal("adminUsersFormModal");
                OperatorUI.toast("Данные абонента обновлены.", "success");
                await loadUsers();
                if (state.activeProfileUserId && String(state.activeProfileUserId) === String(userId)) {
                    await openProfile(userId, state.activeProfileTab);
                }
            }
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось сохранить данные абонента.", "error");
        } finally {
            OperatorUI.setButtonLoading(nodes.formSubmit, false);
        }
    }

    async function submitPaymentForm(event) {
        event.preventDefault();
        if (!canManageUsers()) {
            OperatorUI.toast("Оператор не может пополнять баланс вручную.", "warning");
            return;
        }

        const userId = nodes.paymentUserId.value;
        const amount = Number(nodes.paymentAmount.value || 0);
        const comment = String(nodes.paymentComment.value || "").trim();
        if (!(amount > 0)) {
            OperatorUI.toast("Введите сумму пополнения больше нуля.", "error");
            return;
        }

        OperatorUI.setButtonLoading(nodes.paymentSubmit, true, "Зачисляем...");
        try {
            const response = await OperatorUI.request(`/api/v1/admin/abonents/${userId}/manual-payment`, {
                method: "POST",
                auth: true,
                json: true,
                body: {
                    amount,
                    comment: comment || undefined,
                },
            });
            appendMetaEntry(userId, "manualPayments", {
                at: new Date().toISOString(),
                amount,
                comment: comment || "Ручное зачисление через административную панель",
            });
            OperatorUI.closeModal("adminUsersPaymentModal");
            OperatorUI.toast(response.message || "Средства зачислены.", "success");
            await loadUsers();
            if (state.activeProfileUserId && String(state.activeProfileUserId) === String(userId)) {
                await openProfile(userId, "finance");
            }
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось зачислить средства.", "error");
        } finally {
            OperatorUI.setButtonLoading(nodes.paymentSubmit, false);
        }
    }

    async function submitNotificationForm(event) {
        event.preventDefault();
        const userId = nodes.notifyUserId.value;
        const title = String(nodes.notifyTitle.value || "").trim();
        const message = String(nodes.notifyMessage.value || "").trim();
        const eventType = nodes.notifyType.value || "system";
        const priorityMap = { normal: 1, high: 2, urgent: 3 };
        const priorityValue = priorityMap[nodes.notifyPriority.value || "normal"] || 1;

        if (!title || !message) {
            OperatorUI.toast("Заполните заголовок и текст уведомления.", "error");
            return;
        }

        OperatorUI.setButtonLoading(nodes.notifySubmit, true, "Отправляем...");
        try {
            const response = await OperatorUI.request("/api/v1/admin/notifications", {
                method: "POST",
                auth: true,
                json: true,
                body: {
                    user_id: Number(userId),
                    title,
                    message,
                    event_type: eventType,
                    category: eventType,
                    priority: priorityValue,
                    delivery_type: "push",
                },
            });
            appendMetaEntry(userId, "notifications", {
                at: new Date().toISOString(),
                title,
                message,
                priority: nodes.notifyPriority.value || "normal",
            });
            OperatorUI.closeModal("adminUsersNotifyModal");
            OperatorUI.toast(
                response.created ? `Уведомление отправлено (${response.created}).` : "Уведомление отправлено.",
                "success"
            );
            if (state.activeProfileUserId && String(state.activeProfileUserId) === String(userId)) {
                await openProfile(userId, "activity");
            }
        } catch (error) {
            OperatorUI.toast(error.message || "Не удалось отправить уведомление.", "error");
        } finally {
            OperatorUI.setButtonLoading(nodes.notifySubmit, false);
        }
    }

    function buildOverviewTab(user) {
        const monitoring = user.monitoring_summary || {};
        const alerts = user.monitoring_recent_alerts || [];
        return `
            <section class="admin-users-profile-overview">
                <div class="admin-users-profile-hero">
                    <div class="admin-users-profile-avatar">${escapeHTML(getInitials(user))}</div>
                    <div class="admin-users-profile-headline">
                        <h3>${escapeHTML(user.full_name)}</h3>
                        <div class="table-copy">${escapeHTML(user.billing_id)} · ${escapeHTML(maskPhone(user.phone))}</div>
                        <div class="chip-row">
                            <span class="badge ${statusBadge(user)}">${escapeHTML(user.status_label)}</span>
                            <span class="badge badge-info">${escapeHTML(user.tariff_name || "Тариф не указан")}</span>
                            ${user.balance !== null ? `<span class="badge ${user.balance < 0 ? "badge-warning" : "badge-success"}">${escapeHTML(formatCurrency(user.balance))}</span>` : ""}
                        </div>
                    </div>
                    <div class="admin-users-profile-actions">
                        ${canManageUsers() ? `<button class="btn btn-secondary btn-sm" type="button" data-profile-action="edit" data-user-id="${user.id}"><i class="fas fa-pen"></i>Редактировать</button>` : ""}
                        ${canManageUsers() ? `<button class="btn btn-secondary btn-sm" type="button" data-profile-action="payment" data-user-id="${user.id}"><i class="fas fa-wallet"></i>Пополнить</button>` : ""}
                        <button class="btn btn-secondary btn-sm" type="button" data-profile-action="notify" data-user-id="${user.id}"><i class="fas fa-paper-plane"></i>Сообщение</button>
                        ${canManageUsers() ? `<button class="btn ${user.is_blocked ? "btn-secondary" : "btn-danger"} btn-sm" type="button" data-profile-action="${user.is_blocked ? "unblock" : "block"}" data-user-id="${user.id}"><i class="fas ${user.is_blocked ? "fa-lock-open" : "fa-lock"}"></i>${user.is_blocked ? "Разблокировать" : "Блокировать"}</button>` : ""}
                    </div>
                </div>
                <div class="admin-users-profile-grid">
                    <article class="admin-users-profile-card">
                        <div class="admin-users-section-kicker">Основные данные</div>
                        <dl class="admin-users-definition-list">
                            <div><dt>Телефон</dt><dd>${escapeHTML(maskPhone(user.phone))}</dd></div>
                            <div><dt>Email</dt><dd>${escapeHTML(user.email || "Не указан")}</dd></div>
                            <div><dt>Адрес</dt><dd>${escapeHTML(user.address || "Не указан")}</dd></div>
                            <div><dt>Регистрация</dt><dd>${escapeHTML(formatDate(user.created_at, true))}</dd></div>
                            <div><dt>Последний вход</dt><dd>${escapeHTML(formatDate(user.last_login_at, true))}</dd></div>
                            <div><dt>Открытые заявки</dt><dd>${escapeHTML(user.open_tickets || 0)}</dd></div>
                        </dl>
                    </article>
                    <article class="admin-users-profile-card">
                        <div class="admin-users-section-kicker">Линия и мониторинг</div>
                        <dl class="admin-users-definition-list">
                            <div><dt>Тариф</dt><dd>${escapeHTML(user.tariff_name || "Не указан")}</dd></div>
                            <div><dt>Скорость</dt><dd>${user.tariff_speed ? `${escapeHTML(user.tariff_speed)} Мбит/с` : "—"}</dd></div>
                            <div><dt>Качество</dt><dd>${escapeHTML(String(monitoring.quality_state || "Нет данных"))}</dd></div>
                            <div><dt>Оценка</dt><dd>${monitoring.average_quality_score ? `${escapeHTML(Math.round(monitoring.average_quality_score))}/100` : "—"}</dd></div>
                            <div><dt>Активных алертов</dt><dd>${escapeHTML(monitoring.active_alerts_count || 0)}</dd></div>
                            <div><dt>Последнее обновление</dt><dd>${escapeHTML(formatDate(monitoring.last_metric_at, true))}</dd></div>
                        </dl>
                        ${
                            alerts.length
                                ? `<div class="admin-users-inline-list">${alerts.slice(0, 3).map((alert) => `<div class="admin-users-inline-item"><strong>${escapeHTML(alert.type || "alert")}</strong><span>${escapeHTML(alert.message || "Без описания")}</span></div>`).join("")}</div>`
                                : `<div class="empty-state compact"><p>Сервисных алертов по абоненту нет.</p></div>`
                        }
                    </article>
                </div>
            </section>
        `;
    }

    function buildServicesTab(user) {
        const tariffOptions = (user.available_tariffs || [])
            .map((tariff) => `<option value="${tariff.id}" ${String(user.current_billing_tariff_id || "") === String(tariff.billing_tariff_id || "") ? "selected" : ""}>${escapeHTML(tariff.name)} · ${escapeHTML(tariff.speed_mbps || tariff.speed || 0)} Мбит/с · ${escapeHTML(formatCurrency(tariff.price || 0))}</option>`)
            .join("");
        const history = getMeta(user.id).tariffHistory || [];
        return `
            <section class="admin-users-profile-grid">
                <article class="admin-users-profile-card">
                    <div class="admin-users-section-kicker">Текущий тариф</div>
                    <div class="admin-users-tariff-head">
                        <div>
                            <h3>${escapeHTML(user.tariff_name || "Тариф не определён")}</h3>
                            <p>${user.tariff_speed ? `${escapeHTML(user.tariff_speed)} Мбит/с` : "Скорость не указана"} · ${user.tariff_price ? escapeHTML(formatCurrency(user.tariff_price)) : "Цена не указана"}</p>
                        </div>
                        <span class="badge badge-info">${escapeHTML(user.account_info.account_status || "active")}</span>
                    </div>
                    <div class="admin-users-service-grid">
                        <div class="admin-users-service-pill"><span>Безлимит</span><strong>${user.tariff?.is_unlimited === false ? "Нет" : "Да"}</strong></div>
                        <div class="admin-users-service-pill"><span>Трафик</span><strong>${user.tariff?.traffic_limit_gb ? `${escapeHTML(user.tariff.traffic_limit_gb)} ГБ` : "Безлимит"}</strong></div>
                        <div class="admin-users-service-pill"><span>Срок договора</span><strong>${escapeHTML(user.tariff?.contract_term_months || 12)} мес.</strong></div>
                    </div>
                    ${
                        canManageUsers()
                            ? `<div class="admin-users-tariff-change-box"><label class="field"><span class="field-label">Сменить тариф</span><select class="select" id="adminUsersTariffChangeSelect"><option value="">Выберите тариф</option>${tariffOptions}</select></label><button class="btn btn-primary btn-sm" type="button" data-profile-action="change-tariff" data-user-id="${user.id}"><i class="fas fa-repeat"></i>Применить тариф</button></div>`
                            : `<div class="table-copy">Оператор видит параметры тарифа, но не может их менять.</div>`
                    }
                </article>
                <article class="admin-users-profile-card">
                    <div class="admin-users-section-kicker">История смен тарифов</div>
                    ${
                        history.length
                            ? `<div class="admin-users-timeline">${history.map((item) => `<article class="admin-users-timeline-item"><div class="table-title">${escapeHTML(item.previous)} → ${escapeHTML(item.next)}</div><div class="table-copy">${escapeHTML(formatDate(item.at, true))} · ${escapeHTML(item.actor || "Сотрудник MTN")}</div></article>`).join("")}</div>`
                            : `<div class="empty-state compact"><p>История смен тарифов пока не сохранена.</p></div>`
                    }
                </article>
            </section>
        `;
    }

    function buildFinanceTab(user) {
        const metaPayments = getMeta(user.id).manualPayments || [];
        const payments = [...metaPayments.map((entry) => ({ id: `local-${entry.at}`, amount: entry.amount, status: "succeeded", payment_method: "manual_admin", description: entry.comment, created_at: entry.at, completed_at: entry.at })), ...(user.recent_payments || [])]
            .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))
            .slice(0, 10);
        return `
            <section class="admin-users-profile-grid">
                <article class="admin-users-profile-card">
                    <div class="admin-users-section-kicker">Баланс</div>
                    <div class="admin-users-finance-balance">${user.balance === null ? "—" : escapeHTML(formatCurrency(user.balance))}</div>
                    <p class="table-copy">Всего платежей: ${escapeHTML(formatCurrency(user.detail?.total_payments || 0))}</p>
                    ${canManageUsers() ? `<div class="action-row"><button class="btn btn-primary btn-sm" type="button" data-profile-action="payment" data-user-id="${user.id}"><i class="fas fa-plus"></i>Пополнить вручную</button></div>` : `<div class="table-copy">Ручные операции по балансу доступны только admin.</div>`}
                </article>
                <article class="admin-users-profile-card">
                    <div class="admin-users-section-kicker">Последние платежи</div>
                    ${
                        payments.length
                            ? `<div class="admin-users-table-mini">${payments.map((payment) => `<div class="admin-users-table-mini-row"><div><div class="table-title">${escapeHTML(formatCurrency(payment.amount || 0))}</div><div class="table-copy">${escapeHTML(payment.description || payment.payment_method || "Платёж")}</div></div><div class="admin-users-table-mini-meta"><span class="badge ${paymentBadge(payment.status)}">${escapeHTML(payment.status || "—")}</span><span>${escapeHTML(formatDate(payment.created_at, true))}</span></div></div>`).join("")}</div>`
                            : `<div class="empty-state compact"><p>История платежей пока пуста.</p></div>`
                    }
                </article>
            </section>
        `;
    }

    function buildTicketsTab(user) {
        const tickets = user.recent_tickets || [];
        return `
            <section class="admin-users-profile-card">
                <div class="admin-users-section-kicker">Связанные заявки</div>
                ${
                    tickets.length
                        ? `<div class="admin-users-table-mini">${tickets.map((ticket) => `<div class="admin-users-table-mini-row"><div><div class="table-title">#${escapeHTML(ticket.id)} · ${escapeHTML(ticket.subject || "Без темы")}</div><div class="table-copy">${escapeHTML(formatDate(ticket.created_at, true))}</div></div><div class="admin-users-table-mini-meta"><span class="badge ${ticketBadge(ticket.status)}">${escapeHTML(ticketStatusLabel(ticket.status))}</span><a class="btn btn-secondary btn-xs" href="/admin/tickets/${ticket.id}"><i class="fas fa-arrow-up-right-from-square"></i>Открыть</a></div></div>`).join("")}</div>`
                        : `<div class="empty-state compact"><p>У абонента нет недавних заявок.</p></div>`
                }
            </section>
        `;
    }

    function buildActivityTab(user) {
        const meta = getMeta(user.id);
        const activities = [
            ...(user.activities || []).map((item) => ({ created_at: item.created_at, title: item.action, copy: item.status || "Системное действие" })),
            ...((meta.tariffHistory || []).map((item) => ({ created_at: item.at, title: `Смена тарифа: ${item.previous} → ${item.next}`, copy: item.actor || "Сотрудник MTN" }))),
            ...((meta.notifications || []).map((item) => ({ created_at: item.at, title: `Отправлено уведомление: ${item.title}`, copy: item.message }))),
        ].sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)).slice(0, 20);
        return `
            <section class="admin-users-profile-card">
                <div class="admin-users-section-kicker">История действий</div>
                ${
                    activities.length
                        ? `<div class="admin-users-timeline">${activities.map((item) => `<article class="admin-users-timeline-item"><div class="table-title">${escapeHTML(item.title || "Действие")}</div><div class="table-copy">${escapeHTML(item.copy || "—")}</div><div class="table-copy">${escapeHTML(formatDate(item.created_at, true))}</div></article>`).join("")}</div>`
                        : `<div class="empty-state compact"><p>История действий пока пуста.</p></div>`
                }
            </section>
        `;
    }

    function renderProfile(user) {
        if (!user) {
            nodes.profileLead.textContent = "Абонент не найден.";
            nodes.profileContent.innerHTML = OperatorUI.createEmptyState("fas fa-user-slash", "Карточка недоступна", "Не удалось загрузить выбранного абонента.");
            return;
        }

        const tabs = [
            { key: "overview", label: "Основное" },
            { key: "services", label: "Услуги и тариф" },
            { key: "finance", label: "Финансы" },
            { key: "tickets", label: "Заявки" },
            { key: "activity", label: "История" },
        ];
        const contentMap = {
            overview: buildOverviewTab(user),
            services: buildServicesTab(user),
            finance: buildFinanceTab(user),
            tickets: buildTicketsTab(user),
            activity: buildActivityTab(user),
        };

        nodes.profileLead.textContent = `${user.full_name} · ${user.billing_id}`;
        nodes.profileContent.innerHTML = `
            <div class="admin-users-profile-tabs" role="tablist" aria-label="Разделы карточки абонента">
                ${tabs.map((tab) => `<button class="admin-users-profile-tab ${state.activeProfileTab === tab.key ? "is-active" : ""}" type="button" role="tab" data-profile-tab="${tab.key}" aria-selected="${state.activeProfileTab === tab.key ? "true" : "false"}">${escapeHTML(tab.label)}</button>`).join("")}
            </div>
            <div class="admin-users-profile-panel">${contentMap[state.activeProfileTab] || contentMap.overview}</div>
        `;
    }

    async function openProfile(userId, tab = "overview") {
        state.activeProfileUserId = userId;
        state.activeProfileTab = tab;
        nodes.profileLead.textContent = "Обновляем данные абонента...";
        nodes.profileContent.innerHTML = '<div class="skeleton skeleton-panel-lg"></div>';
        OperatorUI.openModal("adminUsersProfileModal");
        const user = await refreshUserDetail(userId, false);
        renderProfile(user);
    }

    function exportCSV() {
        const rows = [
            ["ID", "Лицевой счёт", "ФИО", "Телефон", "Email", "Тариф", "Баланс", "Статус", "Открытые заявки", "Последняя активность"],
            ...state.filteredUsers.map((user) => [
                user.id,
                user.billing_id,
                user.full_name,
                maskPhone(user.phone),
                user.email || "",
                user.tariff_name || "",
                user.balance === null ? "" : String(user.balance),
                user.status_label,
                String(user.open_tickets || 0),
                formatDate(user.last_activity_at, true),
            ]),
        ];
        const content = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
        const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "mtn_admin_users.csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function savePreset() {
        const name = window.prompt("Название фильтра");
        if (!name) return;
        collectFiltersFromUI();
        const preset = {
            id: `preset-${Date.now()}`,
            name: name.trim().slice(0, 60) || "Мой фильтр",
            filters: { ...state.filters },
            pageSize: state.pageSize,
        };
        state.presets = [preset, ...state.presets].slice(0, 12);
        saveJSON(FILTER_PRESETS_KEY, state.presets);
        populatePresets();
        nodes.preset.value = preset.id;
        OperatorUI.toast("Фильтр сохранён.", "success");
    }

    function applyPreset(presetId) {
        const preset = state.presets.find((item) => item.id === presetId);
        if (!preset) return;
        state.filters = { ...state.filters, ...(preset.filters || {}) };
        state.pageSize = Number(preset.pageSize || 20);
        syncFiltersToUI();
        applyFilters();
    }

    function resetFilters() {
        state.filters = { search: "", status: "all", tariff: "all", balance: "all", date: "all" };
        state.pageSize = 20;
        nodes.preset.value = "";
        syncFiltersToUI();
        applyFilters();
    }

    function bindEvents() {
        nodes.search.addEventListener("input", () => applyFilters());
        nodes.search.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                applyFilters();
            }
        });
        [nodes.status, nodes.tariff, nodes.balance, nodes.date, nodes.pageSize].forEach((node) => node.addEventListener("change", () => applyFilters()));
        nodes.apply.addEventListener("click", () => applyFilters());
        nodes.reset.addEventListener("click", resetFilters);
        nodes.savePreset.addEventListener("click", savePreset);
        nodes.preset.addEventListener("change", (event) => applyPreset(event.target.value));
        nodes.export.addEventListener("click", exportCSV);
        nodes.create.addEventListener("click", openCreateModal);
        nodes.prev.addEventListener("click", () => {
            if (state.page > 1) {
                state.page -= 1;
                renderList();
            }
        });
        nodes.next.addEventListener("click", () => {
            const totalPages = Math.max(1, Math.ceil(state.filteredUsers.length / state.pageSize));
            if (state.page < totalPages) {
                state.page += 1;
                renderList();
            }
        });
        nodes.selectAll.addEventListener("change", (event) => {
            state.currentPageIds.forEach((userId) => {
                if (event.target.checked) state.selection.add(String(userId));
                else state.selection.delete(String(userId));
            });
            renderList();
        });

        document.addEventListener("click", async (event) => {
            const sortButton = event.target.closest(".admin-users-sort");
            if (sortButton) {
                const key = sortButton.dataset.sortKey || "id";
                if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
                else {
                    state.sortKey = key;
                    state.sortDirection = key === "id" ? "asc" : "desc";
                }
                applyFilters({ preservePage: true });
                return;
            }

            const actionButton = event.target.closest("[data-action]");
            if (actionButton) {
                const action = actionButton.dataset.action;
                const userId = actionButton.dataset.userId;
                if (!userId) return;
                if (action === "view") await openProfile(userId, "overview");
                else if (action === "edit") openEditModal(userId);
                else if (action === "block" || action === "unblock") await toggleBlockState(userId, action);
                return;
            }

            const profileActionButton = event.target.closest("[data-profile-action]");
            if (profileActionButton) {
                const action = profileActionButton.dataset.profileAction;
                const userId = profileActionButton.dataset.userId;
                if (!userId) return;
                if (action === "edit") openEditModal(userId);
                else if (action === "payment") openPaymentModal(userId);
                else if (action === "notify") openNotifyModal(userId);
                else if (action === "block" || action === "unblock") await toggleBlockState(userId, action);
                else if (action === "change-tariff") {
                    const select = document.getElementById("adminUsersTariffChangeSelect");
                    await changeTariff(userId, select?.value);
                }
                return;
            }

            const profileTabButton = event.target.closest("[data-profile-tab]");
            if (profileTabButton && state.activeProfileUserId) {
                state.activeProfileTab = profileTabButton.dataset.profileTab || "overview";
                renderProfile(getUserById(state.activeProfileUserId));
            }
        });

        document.addEventListener("change", (event) => {
            if (event.target.classList.contains("admin-users-row-checkbox")) {
                const userId = String(event.target.value);
                if (event.target.checked) state.selection.add(userId);
                else state.selection.delete(userId);
                renderList();
            }
        });

        nodes.bulkBlock.addEventListener("click", () => runBulkAction("block"));
        nodes.bulkUnblock.addEventListener("click", () => runBulkAction("unblock"));
        nodes.form.addEventListener("submit", submitUserForm);
        nodes.paymentForm.addEventListener("submit", submitPaymentForm);
        nodes.notifyForm.addEventListener("submit", submitNotificationForm);
        nodes.formPhone.addEventListener("input", () => {
            if (nodes.formMode.value === "create") {
                nodes.formPhone.value = maskPhone(nodes.formPhone.value);
            }
        });
    }

    async function init() {
        const user = await OperatorUI.ensureAdminAccess(page, {
            errorTitle: "Не удалось открыть каталог абонентов",
        });
        if (!user) return;

        state.staffUser = user;
        state.role = normalizeRole(user.role);
        state.presets = loadJSON(FILTER_PRESETS_KEY, []);
        state.meta = loadJSON(USER_META_KEY, {});
        populatePresets();
        bindEvents();
        syncFiltersToUI();
        page.classList.toggle("is-read-only", !canManageUsers());

        if (canManageUsers()) {
            nodes.create.hidden = false;
            nodes.bulkBlock.hidden = false;
            nodes.bulkUnblock.hidden = false;
        } else {
            state.selection.clear();
            nodes.selectAll.checked = false;
        }

        await loadUsers();
    }

    init();
})();
