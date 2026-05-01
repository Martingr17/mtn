(function () {
    const page = document.getElementById("adminTicketsQueuePage");
    if (!page || !window.OperatorUI) return;

    const STORAGE_KEY = "mtn_admin_ticket_queue_manual_v1";
    const POLL_INTERVAL = 30000;

    const state = {
        staffUser: null,
        items: [],
        manualItems: readJson(STORAGE_KEY, []),
        page: 1,
        pageSize: 10,
        sort: "created_at",
        sortDir: "desc",
        selected: new Set(),
        lastCount: 0,
    };

    const nodes = {
        search: document.getElementById("adminTicketsSearch"),
        status: document.getElementById("adminTicketsStatus"),
        priority: document.getElementById("adminTicketsPriority"),
        operator: document.getElementById("adminTicketsOperator"),
        period: document.getElementById("adminTicketsPeriod"),
        reset: document.getElementById("adminTicketsReset"),
        reload: document.getElementById("adminTicketsReload"),
        create: document.getElementById("adminTicketsCreate"),
        quickChips: document.getElementById("adminTicketsQuickChips"),
        tableBody: document.getElementById("adminTicketsTableBody"),
        mobileList: document.getElementById("adminTicketsMobileList"),
        summary: document.getElementById("adminTicketsSummary"),
        paginationInfo: document.getElementById("adminTicketsPaginationInfo"),
        prev: document.getElementById("adminTicketsPrev"),
        next: document.getElementById("adminTicketsNext"),
        bulkTake: document.getElementById("adminTicketsBulkTake"),
        bulkResolve: document.getElementById("adminTicketsBulkResolve"),
        checkAll: document.getElementById("adminTicketsCheckAll"),
        createForm: document.getElementById("adminTicketsCreateForm"),
        createUser: document.getElementById("adminTicketsCreateUser"),
        createPhone: document.getElementById("adminTicketsCreatePhone"),
        createSubject: document.getElementById("adminTicketsCreateSubject"),
        createPriority: document.getElementById("adminTicketsCreatePriority"),
        createDescription: document.getElementById("adminTicketsCreateDescription"),
    };

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

    function priorityLabel(value) {
        return ({
            high: "Высокий",
            medium: "Средний",
            low: "Низкий",
        })[value] || value || "Средний";
    }

    function priorityBadge(value) {
        const cls = value === "high" ? "is-danger" : value === "medium" ? "is-warning" : "is-success";
        return `<span class="admin-suite-badge ${cls}">${priorityLabel(value)}</span>`;
    }

    function statusLabel(value) {
        return ({
            new: "Новая",
            in_progress: "В работе",
            waiting_customer: "Ожидает клиента",
            resolved: "Решена",
            closed: "Закрыта",
        })[value] || value || "Новая";
    }

    function statusBadge(value) {
        const cls = value === "new"
            ? "is-info"
            : value === "in_progress"
                ? "is-warning"
                : value === "resolved"
                    ? "is-success"
                    : "is-muted";
        return `<span class="admin-suite-badge ${cls}">${statusLabel(value)}</span>`;
    }

    function ticketAgeHours(item) {
        return (Date.now() - new Date(item.created_at).getTime()) / 3600000;
    }

    function periodMatch(value) {
        const diff = Date.now() - new Date(value).getTime();
        if (nodes.period.value === "today") return diff <= 86400000;
        if (nodes.period.value === "yesterday") return diff > 86400000 && diff <= 2 * 86400000;
        if (nodes.period.value === "week") return diff <= 7 * 86400000;
        if (nodes.period.value === "month") return diff <= 31 * 86400000;
        return true;
    }

    function mergedItems() {
        const byId = new Map();
        [...state.items, ...state.manualItems].forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
    }

    function filteredItems() {
        const currentName = state.staffUser?.full_name || state.staffUser?.phone || "";
        return mergedItems().filter((item) => {
            const haystack = `${item.id} ${item.subject} ${item.user_phone} ${item.user_name || ""}`.toLowerCase();
            const operatorMatch = nodes.operator.value === "all"
                || (nodes.operator.value === "mine" && (item.assigned_to_name || "") === currentName)
                || (nodes.operator.value === "unassigned" && !item.assigned_to_name)
                || (nodes.operator.value.startsWith("operator:") && (item.assigned_to_name || "") === nodes.operator.value.replace("operator:", ""));
            return (!nodes.search.value || haystack.includes(nodes.search.value.trim().toLowerCase()))
                && (nodes.status.value === "all" || item.status === nodes.status.value)
                && (nodes.priority.value === "all" || item.priority === nodes.priority.value)
                && operatorMatch
                && periodMatch(item.created_at);
        }).sort((a, b) => {
            const first = a[state.sort];
            const second = b[state.sort];
            const compare = first > second ? 1 : first < second ? -1 : 0;
            return state.sortDir === "asc" ? compare : -compare;
        });
    }

    function paginated(items) {
        const start = (state.page - 1) * state.pageSize;
        return items.slice(start, start + state.pageSize);
    }

    function saveManualItems() {
        writeJson(STORAGE_KEY, state.manualItems);
    }

    function renderQuickChips(items) {
        const groups = [
            { key: "new", label: "Новые", count: items.filter((item) => item.status === "new").length },
            { key: "high", label: "Высокий приоритет", count: items.filter((item) => item.priority === "high").length },
            { key: "mine", label: "Мои заявки", count: items.filter((item) => item.assigned_to_name === (state.staffUser?.full_name || state.staffUser?.phone || "")).length },
        ];
        nodes.quickChips.innerHTML = groups.map((group) => `<button class="chip" type="button" data-quick-chip="${group.key}">${group.label} (${group.count})</button>`).join("");
        document.querySelectorAll("[data-quick-chip]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.quickChip;
                if (key === "new") {
                    nodes.status.value = "new";
                    nodes.priority.value = "all";
                    nodes.operator.value = "all";
                } else if (key === "high") {
                    nodes.priority.value = "high";
                    nodes.status.value = "all";
                } else if (key === "mine") {
                    nodes.operator.value = "mine";
                }
                render();
            });
        });
    }

    function syncOperatorOptions(items) {
        const currentValue = nodes.operator.value;
        const names = Array.from(new Set(items.map((item) => item.assigned_to_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
        const baseOptions = [
            `<option value="all">Все</option>`,
            `<option value="mine">Назначенные на меня</option>`,
            `<option value="unassigned">Не назначенные</option>`,
        ];
        const namedOptions = names.map((name) => `<option value="operator:${OperatorUI.escapeHTML(name)}">${OperatorUI.escapeHTML(name)}</option>`);
        nodes.operator.innerHTML = [...baseOptions, ...namedOptions].join("");
        if (Array.from(nodes.operator.options).some((option) => option.value === currentValue)) {
            nodes.operator.value = currentValue;
        }
    }

    function render() {
        const items = filteredItems();
        syncOperatorOptions(mergedItems());
        renderQuickChips(mergedItems());
        const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
        if (state.page > totalPages) state.page = totalPages;
        const slice = paginated(items);
        nodes.tableBody.innerHTML = slice.map((item) => {
            const age = ticketAgeHours(item);
            const rowClass = item.status === "new" && age > 6 ? "is-danger" : item.status === "new" && age > 2 ? "is-warning" : "";
            const ageText = age < 1 ? `${Math.max(1, Math.round(age * 60))} мин` : `${Math.round(age)} ч`;
            return `
                <tr class="${rowClass}">
                    <td><input type="checkbox" data-ticket-check="${item.id}" ${state.selected.has(item.id) ? "checked" : ""}></td>
                    <td>#${item.id}</td>
                    <td>${OperatorUI.formatDate(item.created_at, { includeTime: true })}</td>
                    <td>${OperatorUI.escapeHTML(item.user_name || "Абонент MTN")}</td>
                    <td>${OperatorUI.escapeHTML(item.user_phone || "—")}</td>
                    <td>${OperatorUI.escapeHTML(item.subject)}</td>
                    <td>${priorityBadge(item.priority)}</td>
                    <td>${statusBadge(item.status)}</td>
                    <td>${OperatorUI.escapeHTML(item.assigned_to_name || "—")}</td>
                    <td><span title="Ожидает ${ageText}">${ageText}</span></td>
                    <td class="admin-suite-actions">
                        <a class="btn btn-secondary btn-xs" href="/admin/tickets/${item.id}">👁️</a>
                        ${item.status === "new" ? `<button class="btn btn-secondary btn-xs" type="button" data-take="${item.id}">🎯</button>` : ""}
                    </td>
                </tr>
            `;
        }).join("");

        if (nodes.mobileList) {
            nodes.mobileList.hidden = !slice.length;
            nodes.mobileList.innerHTML = slice.map((item) => {
                const age = ticketAgeHours(item);
                const ageText = age < 1 ? `${Math.max(1, Math.round(age * 60))} мин` : `${Math.round(age)} ч`;
                return `
                    <article class="admin-compact-card">
                        <div class="toolbar">
                            <div>
                                <div class="table-title">#${item.id} · ${OperatorUI.escapeHTML(item.subject)}</div>
                                <div class="table-copy">${OperatorUI.escapeHTML(item.user_name || "Абонент MTN")} · ${OperatorUI.escapeHTML(item.user_phone || "—")}</div>
                            </div>
                            ${statusBadge(item.status)}
                        </div>
                        <div class="action-row">
                            ${priorityBadge(item.priority)}
                            <span class="table-copy">SLA: ${ageText}</span>
                            <span class="table-copy">${OperatorUI.escapeHTML(item.assigned_to_name || "Не назначена")}</span>
                        </div>
                        <div class="admin-suite-actions">
                            <a class="btn btn-secondary btn-sm" href="/admin/tickets/${item.id}">Открыть</a>
                            ${item.status === "new" ? `<button class="btn btn-secondary btn-sm" type="button" data-take="${item.id}">Взять</button>` : ""}
                        </div>
                    </article>
                `;
            }).join("");
        }

        nodes.summary.textContent = `Показано ${items.length} заявок. Выбрано: ${state.selected.size}.`;
        nodes.paginationInfo.textContent = `Страница ${state.page} из ${totalPages}`;
        nodes.checkAll.checked = slice.length > 0 && slice.every((item) => state.selected.has(item.id));

        document.querySelectorAll("[data-ticket-check]").forEach((input) => {
            input.addEventListener("change", () => {
                const id = Number(input.dataset.ticketCheck);
                if (input.checked) state.selected.add(id);
                else state.selected.delete(id);
            });
        });
        document.querySelectorAll("[data-take]").forEach((button) => {
            button.addEventListener("click", () => {
                assignToCurrent(Number(button.dataset.take));
            });
        });
    }

    function assignToCurrent(id) {
        const currentName = state.staffUser?.full_name || state.staffUser?.phone || "Оператор";
        const ticket = mergedItems().find((item) => Number(item.id) === Number(id));
        if (!ticket) return;
        ticket.assigned_to_name = currentName;
        ticket.status = ticket.status === "new" ? "in_progress" : ticket.status;
        persistLocalTicket(ticket);
        render();
        OperatorUI.toast(`Заявка #${ticket.id} назначена на ${currentName}.`, "success");
    }

    function resolveSelected() {
        if (!state.selected.size) {
            OperatorUI.toast("Сначала выберите заявки.", "warning");
            return;
        }
        mergedItems().forEach((item) => {
            if (state.selected.has(item.id)) {
                item.status = "resolved";
                persistLocalTicket(item);
            }
        });
        render();
        OperatorUI.toast("Выбранные заявки переведены в статус «Решена».", "success");
    }

    function takeSelected() {
        if (!state.selected.size) {
            OperatorUI.toast("Сначала выберите заявки.", "warning");
            return;
        }
        Array.from(state.selected).forEach((id) => assignToCurrent(id));
    }

    function persistLocalTicket(ticket) {
        const index = state.manualItems.findIndex((item) => item.id === ticket.id);
        if (index >= 0) state.manualItems.splice(index, 1, ticket);
        else state.manualItems.push(ticket);
        saveManualItems();
    }

    function createLocalTicket() {
        const userName = nodes.createUser.value.trim();
        const phone = nodes.createPhone.value.trim();
        const subject = nodes.createSubject.value.trim();
        const description = nodes.createDescription.value.trim();
        if (!userName || !phone || !subject || description.length < 10) {
            OperatorUI.toast("Заполните абонента, телефон, тему и описание минимум на 10 символов.", "error");
            return;
        }
        const maxServerId = Math.max(0, ...mergedItems().map((item) => Number(item.id) || 0));
        const ticket = {
            id: maxServerId + 1,
            user_id: 0,
            user_phone: phone,
            user_name: userName,
            subject,
            status: "new",
            priority: nodes.createPriority.value,
            created_at: new Date().toISOString(),
            assigned_to: null,
            assigned_to_name: null,
            description,
        };
        state.manualItems.unshift(ticket);
        saveManualItems();
        OperatorUI.closeModal("adminTicketsCreateModal");
        nodes.createForm.reset();
        render();
        OperatorUI.toast(`Заявка #${ticket.id} создана.`, "success");
    }

    async function loadTickets(silent = false) {
        const user = state.staffUser || await OperatorUI.ensureAdminAccess(page, {
            errorTitle: "Не удалось открыть очередь заявок",
        });
        if (!user) return;
        state.staffUser = user;

        try {
            const data = await OperatorUI.request("/api/v1/admin/tickets?page=1&page_size=100", { auth: true });
            const items = (data.items || []).map((item) => ({
                ...item,
                user_name: item.user_phone ? `Абонент ${item.user_phone.slice(-4)}` : "Абонент MTN",
            }));
            if (state.lastCount && items.length > state.lastCount && !silent) {
                OperatorUI.toast(`В очереди появились новые заявки: +${items.length - state.lastCount}.`, "warning");
            }
            state.lastCount = items.length;
            state.items = items;
            render();
        } catch (error) {
            nodes.tableBody.innerHTML = `<tr><td colspan="11">${OperatorUI.createEmptyState("fas fa-triangle-exclamation", "Не удалось загрузить очередь", error.message || "Попробуйте обновить страницу позже.")}</td></tr>`;
        }
    }

    document.querySelectorAll("[data-sort]", page).forEach((cell) => {
        cell.style.cursor = "pointer";
        cell.addEventListener("click", () => {
            const key = cell.dataset.sort;
            if (state.sort === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
            else {
                state.sort = key;
                state.sortDir = "asc";
            }
            render();
        });
    });

    [nodes.search, nodes.status, nodes.priority, nodes.operator, nodes.period].forEach((node) => {
        node?.addEventListener("input", () => {
            state.page = 1;
            render();
        });
    });
    nodes.reset?.addEventListener("click", () => {
        nodes.search.value = "";
        nodes.status.value = "all";
        nodes.priority.value = "all";
        nodes.operator.value = "all";
        nodes.period.value = "all";
        state.page = 1;
        render();
    });
    nodes.reload?.addEventListener("click", () => loadTickets());
    nodes.prev?.addEventListener("click", () => {
        state.page = Math.max(1, state.page - 1);
        render();
    });
    nodes.next?.addEventListener("click", () => {
        state.page += 1;
        render();
    });
    nodes.bulkTake?.addEventListener("click", takeSelected);
    nodes.bulkResolve?.addEventListener("click", resolveSelected);
    nodes.checkAll?.addEventListener("change", () => {
        const items = filteredItems();
        if (nodes.checkAll.checked) items.forEach((item) => state.selected.add(item.id));
        else items.forEach((item) => state.selected.delete(item.id));
        render();
    });
    nodes.create?.addEventListener("click", () => OperatorUI.openModal("adminTicketsCreateModal"));
    nodes.createForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        createLocalTicket();
    });

    loadTickets(true);
    window.setInterval(() => loadTickets(true), POLL_INTERVAL);
})();
