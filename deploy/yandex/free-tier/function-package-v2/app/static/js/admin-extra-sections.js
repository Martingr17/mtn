(function () {
    const ui = window.OperatorUI || null;
    const PAGE = document.querySelector("[data-admin-page]");
    if (!PAGE) return;

    const STORAGE = {
        tariffs: "mtn_admin_tariffs_v1",
        tariffsView: "mtn_admin_tariffs_view_v1",
        payments: "mtn_admin_payments_v1",
        paymentFilters: "mtn_admin_payment_filters_v1",
        operators: "mtn_admin_operators_v1",
    };

    function qs(selector, root = document) {
        return root.querySelector(selector);
    }

    function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
    }

    function toast(message, type = "info", title = "") {
        if (ui?.toast) ui.toast(message, type, title);
        else console.log(`[${type}] ${title ? `${title}: ` : ""}${message}`);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
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

    function formatCompactCurrency(value) {
        return formatCurrency(value).replace(/\s?₽/, " ₽");
    }

    function formatDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function uid(prefix) {
        return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function downloadFile(filename, content, mime = "text/plain;charset=utf-8") {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
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

    qsa("[data-admin-modal-close]").forEach((button) => {
        button.addEventListener("click", () => closeModal(button.dataset.adminModalClose));
    });
    qsa(".admin-suite-modal").forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal(modal);
        });
    });

    function seedTariffs() {
        const existing = readJson(STORAGE.tariffs, null);
        if (Array.isArray(existing) && existing.length) return existing;
        const items = [
            { id: 1, name: "Старт 100", type: "home", speed: 100, price: 490, popularity: 15, status: "active", description: "Базовый тариф для квартиры.", features: ["Безлимит", "Роутер за 1 ₽"], services: ["router"], sortOrder: 1 },
            { id: 2, name: "Город 300", type: "home", speed: 300, price: 790, popularity: 45, status: "active", description: "Сбалансированный тариф для семьи.", features: ["Безлимит", "Роутер в подарок", "ТВ 50 каналов"], services: ["router", "tv50"], sortOrder: 2 },
            { id: 3, name: "Смена 500", type: "work", speed: 500, price: 1090, popularity: 25, status: "active", description: "Для удалённой работы и стабильного VPN.", features: ["Безлимит", "Приоритетный трафик", "Статический IP"], services: ["ip"], sortOrder: 3 },
            { id: 4, name: "Семья 700 + ТВ", type: "home", speed: 700, price: 1490, popularity: 8, status: "active", description: "Для насыщенного цифрового дома.", features: ["Безлимит", "ТВ 150 каналов", "Кинотеатр"], services: ["tv150", "router"], sortOrder: 4 },
            { id: 5, name: "Бизнес 1000", type: "business", speed: 1000, price: 2490, popularity: 4, status: "active", description: "SLA и приоритетная поддержка 24/7.", features: ["SLA 99.9%", "Приоритетная поддержка"], services: ["ip"], sortOrder: 5 },
            { id: 6, name: "Удалённый PRO", type: "work", speed: 400, price: 1290, popularity: 3, status: "hidden", description: "Для удалённой команды и видеозвонков.", features: ["VPN", "Облачное хранилище 100 ГБ"], services: [], sortOrder: 6 },
        ];
        writeJson(STORAGE.tariffs, items);
        return items;
    }

    function typeLabel(type) {
        return ({
            home: "Для дома",
            work: "Для работы",
            business: "Для бизнеса",
        })[type] || "Все";
    }

    function badge(status) {
        const config = {
            active: { text: "Активен", cls: "is-success" },
            hidden: { text: "Скрыт", cls: "is-muted" },
            admin: { text: "Admin", cls: "is-info" },
            operator: { text: "Operator", cls: "is-muted" },
            home: { text: "Для дома", cls: "is-info" },
            work: { text: "Для работы", cls: "is-warning" },
            business: { text: "Для бизнеса", cls: "is-muted" },
            topup: { text: "Пополнение", cls: "is-success" },
            charge: { text: "Списание", cls: "is-danger" },
            manual: { text: "Ручное", cls: "is-info" },
            adjustment: { text: "Корректировка", cls: "is-warning" },
            bonus: { text: "Бонус", cls: "is-success" },
            blocked: { text: "Заблокирован", cls: "is-danger" },
            success: { text: "Успешно", cls: "is-success" },
            error: { text: "Ошибка", cls: "is-danger" },
            processing: { text: "В обработке", cls: "is-warning" },
            canceled: { text: "Отменён", cls: "is-muted" },
        }[status] || { text: status, cls: "is-info" };
        return `<span class="admin-suite-badge ${config.cls}">${escapeHtml(config.text)}</span>`;
    }

    function initTariffsPage() {
        if (PAGE.dataset.adminPage !== "tariffs") return;

        const els = {
            search: qs("#adminTariffsSearch"),
            status: qs("#adminTariffsStatus"),
            type: qs("#adminTariffsType"),
            speed: qs("#adminTariffsSpeed"),
            tableView: qs("#adminTariffsTableView"),
            cardsView: qs("#adminTariffsCardsView"),
            tableBody: qs("#adminTariffsTableBody"),
            summary: qs("#adminTariffsSummary"),
            paginationInfo: qs("#adminTariffsPaginationInfo"),
            prev: qs("#adminTariffsPrev"),
            next: qs("#adminTariffsNext"),
            create: qs("#adminTariffsCreate"),
            export: qs("#adminTariffsExport"),
            viewTable: qs("#adminTariffsViewTable"),
            viewCards: qs("#adminTariffsViewCards"),
            bulkHide: qs("#adminTariffsBulkHide"),
            bulkShow: qs("#adminTariffsBulkShow"),
            checkAll: qs("#adminTariffsCheckAll"),
            modal: qs("#adminTariffsModal"),
            modalTitle: qs("#adminTariffsModalTitle"),
            form: qs("#adminTariffsForm"),
            id: qs("#adminTariffsId"),
            name: qs("#adminTariffsName"),
            typeInput: qs("#adminTariffsTypeInput"),
            speedInput: qs("#adminTariffsSpeedInput"),
            priceInput: qs("#adminTariffsPriceInput"),
            description: qs("#adminTariffsDescription"),
            features: qs("#adminTariffsFeatures"),
            sortOrder: qs("#adminTariffsSortOrder"),
            statusInput: qs("#adminTariffsStatusInput"),
            pricePreview: qs("#adminTariffsPricePreview"),
            validation: qs("#adminTariffsValidation"),
            delete: qs("#adminTariffsDelete"),
            previewModal: qs("#adminTariffsPreviewModal"),
            previewBody: qs("#adminTariffsPreviewBody"),
        };

        const state = {
            items: seedTariffs(),
            page: 1,
            pageSize: 5,
            sort: "sortOrder",
            sortDir: "asc",
            view: window.localStorage.getItem(STORAGE.tariffsView) || "table",
            selected: new Set(),
        };

        function save() {
            writeJson(STORAGE.tariffs, state.items);
        }

        function filtered() {
            return state.items
                .filter((item) => {
                    const speed = Number(item.speed);
                    const matchesSpeed = els.speed?.value === "all"
                        || (els.speed.value === "100" && speed <= 100)
                        || (els.speed.value === "300" && speed > 100 && speed <= 300)
                        || (els.speed.value === "500" && speed > 300 && speed <= 500)
                        || (els.speed.value === "501" && speed > 500);
                    const haystack = `${item.name} ${item.speed} ${item.price}`.toLowerCase();
                    return (!els.search?.value || haystack.includes(els.search.value.trim().toLowerCase()))
                        && (els.status?.value === "all" || item.status === els.status.value)
                        && (els.type?.value === "all" || item.type === els.type.value)
                        && matchesSpeed;
                })
                .sort((a, b) => {
                    const first = a[state.sort];
                    const second = b[state.sort];
                    if (first === second) return 0;
                    const compare = first > second ? 1 : -1;
                    return state.sortDir === "asc" ? compare : -compare;
                });
        }

        function paginated(items) {
            const start = (state.page - 1) * state.pageSize;
            return items.slice(start, start + state.pageSize);
        }

        function renderViewToggle() {
            const table = state.view === "table";
            els.tableView.hidden = !table;
            els.cardsView.hidden = table;
            els.viewTable.classList.toggle("btn-primary", table);
            els.viewCards.classList.toggle("btn-primary", !table);
        }

        function renderTable(items) {
            if (!els.tableBody) return;
            els.tableBody.innerHTML = items.map((item) => `
                <tr>
                    <td><input type="checkbox" data-row-check="${item.id}" ${state.selected.has(item.id) ? "checked" : ""}></td>
                    <td>${item.id}</td>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(typeLabel(item.type))}</td>
                    <td>${item.speed} Мбит/с</td>
                    <td>${formatCompactCurrency(item.price)}</td>
                    <td>
                        <div class="admin-suite-progress"><span style="width:${item.popularity}%"></span></div>
                        <small>${item.popularity}%</small>
                    </td>
                    <td>${badge(item.status)}</td>
                    <td class="admin-suite-actions">
                        <button class="btn btn-secondary btn-xs" type="button" data-edit="${item.id}">✏️</button>
                        <button class="btn btn-secondary btn-xs" type="button" data-copy="${item.id}">📋</button>
                        <button class="btn btn-secondary btn-xs" type="button" data-preview="${item.id}">👁️</button>
                        <button class="btn btn-secondary btn-xs" type="button" data-toggle="${item.id}">${item.status === "active" ? "🔒" : "🔓"}</button>
                    </td>
                </tr>
            `).join("");
        }

        function renderCards(items) {
            if (!els.cardsView) return;
            els.cardsView.innerHTML = items.map((item) => `
                <article class="admin-suite-card">
                    <div class="admin-suite-inline">
                        ${badge(item.status)}
                        ${badge(item.type)}
                    </div>
                    <div>
                        <h3>${escapeHtml(item.name)}</h3>
                        <div class="admin-suite-meta">${item.speed} Мбит/с · ${formatCompactCurrency(item.price)}</div>
                    </div>
                    <p>${escapeHtml(item.description)}</p>
                    <div class="admin-suite-progress"><span style="width:${item.popularity}%"></span></div>
                    <small>${item.popularity}% абонентов на тарифе</small>
                    <div class="admin-suite-actions">
                        <button class="btn btn-secondary btn-sm" type="button" data-edit="${item.id}">Редактировать</button>
                        <button class="btn btn-secondary btn-sm" type="button" data-copy="${item.id}">Копировать</button>
                        <button class="btn btn-secondary btn-sm" type="button" data-preview="${item.id}">Предпросмотр</button>
                        <button class="btn btn-secondary btn-sm" type="button" data-toggle="${item.id}">${item.status === "active" ? "Скрыть" : "Показать"}</button>
                    </div>
                </article>
            `).join("");
        }

        function render() {
            const items = filtered();
            const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
            if (state.page > totalPages) state.page = totalPages;
            const slice = paginated(items);
            renderViewToggle();
            renderTable(slice);
            renderCards(slice);
            if (els.summary) els.summary.textContent = `Найдено ${items.length} тарифов.`;
            if (els.paginationInfo) els.paginationInfo.textContent = `Страница ${state.page} из ${totalPages}`;
            bindRowActions();
        }

        function currentServices() {
            return qsa("[data-service-check]", els.modal).filter((input) => input.checked).map((input) => input.value);
        }

        function fillForm(item, isCopy = false) {
            els.modalTitle.textContent = isCopy ? "Копировать тариф" : item ? "Редактировать тариф" : "Добавить тариф";
            els.id.value = isCopy ? "" : item?.id || "";
            els.name.value = isCopy ? `Копия — ${item.name}` : item?.name || "";
            els.typeInput.value = item?.type || "home";
            els.speedInput.value = item?.speed || 100;
            els.priceInput.value = item?.price || 490;
            els.description.value = item?.description || "";
            els.features.value = (item?.features || []).join(", ");
            els.sortOrder.value = item?.sortOrder || state.items.length + 1;
            els.statusInput.value = item?.status || "active";
            qsa("[data-service-check]", els.modal).forEach((input) => {
                input.checked = Boolean(item?.services?.includes(input.value));
            });
            updatePricePreview();
            openModal("adminTariffsModal");
        }

        function updatePricePreview() {
            if (els.pricePreview) els.pricePreview.textContent = `${Number(els.priceInput.value || 0)} ₽/мес`;
        }

        function validate() {
            const name = els.name.value.trim().toLowerCase();
            const duplicate = state.items.find((item) => item.name.trim().toLowerCase() === name && String(item.id) !== String(els.id.value || ""));
            if (!name) return "Введите название тарифа.";
            if (duplicate) return "Такое название уже используется.";
            if (Number(els.priceInput.value || 0) <= 0) return "Цена должна быть больше нуля.";
            if (Number(els.speedInput.value || 0) < 10 || Number(els.speedInput.value || 0) > 10000) return "Скорость должна быть в диапазоне 10–10000 Мбит/с.";
            return "";
        }

        function openPreview(id) {
            const item = state.items.find((entry) => entry.id === id);
            if (!item || !els.previewBody) return;
            els.previewBody.innerHTML = `
                <article class="admin-suite-card" style="max-width:420px">
                    <div class="admin-suite-inline">${badge(item.type)} ${badge(item.status)}</div>
                    <div>
                        <h3>${escapeHtml(item.name)}</h3>
                        <div class="admin-suite-meta">${item.speed} Мбит/с · ${formatCompactCurrency(item.price)}</div>
                    </div>
                    <p>${escapeHtml(item.description)}</p>
                    <ul>${item.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
                    <button class="btn btn-primary btn-sm" type="button">Выбрать</button>
                </article>
            `;
            openModal("adminTariffsPreviewModal");
        }

        function bindRowActions() {
            qsa("[data-row-check]", PAGE).forEach((input) => {
                input.addEventListener("change", () => {
                    const id = Number(input.dataset.rowCheck);
                    if (input.checked) state.selected.add(id);
                    else state.selected.delete(id);
                });
            });
            qsa("[data-edit]", PAGE).forEach((button) => button.addEventListener("click", () => fillForm(state.items.find((item) => item.id === Number(button.dataset.edit)))));
            qsa("[data-copy]", PAGE).forEach((button) => button.addEventListener("click", () => fillForm(state.items.find((item) => item.id === Number(button.dataset.copy)), true)));
            qsa("[data-preview]", PAGE).forEach((button) => button.addEventListener("click", () => openPreview(Number(button.dataset.preview))));
            qsa("[data-toggle]", PAGE).forEach((button) => button.addEventListener("click", () => {
                const item = state.items.find((entry) => entry.id === Number(button.dataset.toggle));
                if (!item) return;
                item.status = item.status === "active" ? "hidden" : "active";
                save();
                render();
                toast(`Тариф «${item.name}» обновлён.`, "success");
            }));
        }

        qsa("[data-sort]", PAGE).forEach((cell) => {
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

        [els.search, els.status, els.type, els.speed].forEach((control) => control?.addEventListener("input", () => {
            state.page = 1;
            render();
        }));
        els.prev?.addEventListener("click", () => {
            state.page = Math.max(1, state.page - 1);
            render();
        });
        els.next?.addEventListener("click", () => {
            state.page += 1;
            render();
        });
        els.viewTable?.addEventListener("click", () => {
            state.view = "table";
            window.localStorage.setItem(STORAGE.tariffsView, state.view);
            render();
        });
        els.viewCards?.addEventListener("click", () => {
            state.view = "cards";
            window.localStorage.setItem(STORAGE.tariffsView, state.view);
            render();
        });
        els.create?.addEventListener("click", () => fillForm(null));
        els.export?.addEventListener("click", () => {
            const rows = [
                ["ID", "Название", "Тип", "Скорость", "Цена", "Популярность", "Статус"],
                ...filtered().map((item) => [item.id, item.name, typeLabel(item.type), item.speed, item.price, item.popularity, item.status]),
            ];
            downloadFile("mtn-admin-tariffs.csv", `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`, "text/csv;charset=utf-8");
            toast("Экспорт тарифов готов.", "success");
        });
        els.checkAll?.addEventListener("change", () => {
            const ids = filtered().map((item) => item.id);
            if (els.checkAll.checked) ids.forEach((id) => state.selected.add(id));
            else ids.forEach((id) => state.selected.delete(id));
            render();
        });
        els.bulkHide?.addEventListener("click", () => {
            state.items.forEach((item) => {
                if (state.selected.has(item.id)) item.status = "hidden";
            });
            save();
            render();
            toast("Выбранные тарифы скрыты.", "success");
        });
        els.bulkShow?.addEventListener("click", () => {
            state.items.forEach((item) => {
                if (state.selected.has(item.id)) item.status = "active";
            });
            save();
            render();
            toast("Выбранные тарифы опубликованы.", "success");
        });
        els.priceInput?.addEventListener("input", updatePricePreview);
        els.form?.addEventListener("submit", (event) => {
            event.preventDefault();
            const error = validate();
            if (els.validation) els.validation.textContent = error;
            if (error) return;
            const payload = {
                id: els.id.value ? Number(els.id.value) : Math.max(0, ...state.items.map((item) => item.id)) + 1,
                name: els.name.value.trim(),
                type: els.typeInput.value,
                speed: Number(els.speedInput.value || 0),
                price: Number(els.priceInput.value || 0),
                description: els.description.value.trim(),
                features: els.features.value.split(",").map((item) => item.trim()).filter(Boolean),
                services: currentServices(),
                sortOrder: Number(els.sortOrder.value || state.items.length + 1),
                status: els.statusInput.value,
                popularity: els.id.value ? (state.items.find((item) => item.id === Number(els.id.value))?.popularity || 0) : 0,
            };
            const existing = state.items.findIndex((item) => item.id === payload.id);
            if (existing >= 0) state.items.splice(existing, 1, payload);
            else state.items.push(payload);
            save();
            closeModal("adminTariffsModal");
            render();
            toast(`Тариф «${payload.name}» сохранён.`, "success");
        });
        els.delete?.addEventListener("click", () => {
            if (!els.id.value) return closeModal("adminTariffsModal");
            const target = state.items.find((item) => item.id === Number(els.id.value));
            if (!target) return;
            state.items = state.items.filter((item) => item.id !== target.id);
            save();
            closeModal("adminTariffsModal");
            render();
            toast(`Тариф «${target.name}» удалён.`, "success");
        });

        render();
    }

    function seedPayments() {
        const existing = readJson(STORAGE.payments, null);
        if (Array.isArray(existing) && existing.length) return existing;
        const items = [
            { id: 1001, date: "2026-03-15T14:32:00", abonent: "Мартин Григорян", account: "DEMO77777", type: "topup", amount: 1000, method: "card", status: "success", operator: "Система", comment: "—", phone: "+7 999 123-45-67" },
            { id: 1002, date: "2026-03-15T10:15:00", abonent: "Анна Смирнова", account: "DEMO77778", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Тариф Город 300", phone: "+7 999 123-45-68" },
            { id: 1003, date: "2026-03-14T18:20:00", abonent: "Пётр Иванов", account: "DEMO77779", type: "manual", amount: 500, method: "manual", status: "success", operator: "Иван Иванов", comment: "Ошибочное списание", phone: "+7 999 123-45-69" },
            { id: 1004, date: "2026-03-14T09:00:00", abonent: "Елена Петрова", account: "DEMO77780", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Тариф Город 300", phone: "+7 999 123-45-70" },
            { id: 1005, date: "2026-03-13T22:40:00", abonent: "Алексей Сидоров", account: "DEMO77781", type: "topup", amount: 500, method: "sbp", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-71" },
            { id: 1006, date: "2026-03-13T15:30:00", abonent: "Ольга Козлова", account: "DEMO77782", type: "charge", amount: -1490, method: "auto", status: "error", operator: "Система", comment: "Недостаточно средств", phone: "+7 999 123-45-72" },
            { id: 1007, date: "2026-03-12T11:00:00", abonent: "Дмитрий Морозов", account: "DEMO77783", type: "topup", amount: 2000, method: "card", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-73" },
            { id: 1008, date: "2026-03-12T08:15:00", abonent: "Наталья Власова", account: "DEMO77784", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Абонентская плата", phone: "+7 999 123-45-74" },
            { id: 1009, date: "2026-03-11T16:45:00", abonent: "Сергей Тихонов", account: "DEMO77785", type: "manual", amount: 200, method: "manual", status: "success", operator: "Мария Петрова", comment: "Компенсация за сбой", phone: "+7 999 123-45-75" },
            { id: 1010, date: "2026-03-11T10:00:00", abonent: "Ирина Соколова", account: "DEMO77786", type: "topup", amount: 1500, method: "sbp", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-76" },
            { id: 1011, date: "2026-03-10T14:00:00", abonent: "Мартин Григорян", account: "DEMO77777", type: "charge", amount: -790, method: "auto", status: "success", operator: "Система", comment: "Абонентская плата", phone: "+7 999 123-45-67" },
            { id: 1012, date: "2026-03-10T09:30:00", abonent: "Анна Смирнова", account: "DEMO77778", type: "topup", amount: 300, method: "card", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-68" },
            { id: 1013, date: "2026-03-09T20:15:00", abonent: "Пётр Иванов", account: "DEMO77779", type: "charge", amount: -1090, method: "auto", status: "success", operator: "Система", comment: "Тариф Смена 500", phone: "+7 999 123-45-69" },
            { id: 1014, date: "2026-03-09T12:00:00", abonent: "Елена Петрова", account: "DEMO77780", type: "topup", amount: 1000, method: "sbp", status: "success", operator: "Система", comment: "Пополнение", phone: "+7 999 123-45-70" },
            { id: 1015, date: "2026-03-08T18:30:00", abonent: "Алексей Сидоров", account: "DEMO77781", type: "charge", amount: -490, method: "auto", status: "error", operator: "Система", comment: "Сбой списания", phone: "+7 999 123-45-71" },
        ];
        writeJson(STORAGE.payments, items);
        return items;
    }

    function initPaymentsPage() {
        if (PAGE.dataset.adminPage !== "payments") return;

        const els = {
            quickChips: qs("#adminPaymentsQuickChips"),
            search: qs("#adminPaymentsSearch"),
            period: qs("#adminPaymentsPeriod"),
            type: qs("#adminPaymentsType"),
            status: qs("#adminPaymentsStatus"),
            method: qs("#adminPaymentsMethod"),
            amount: qs("#adminPaymentsAmount"),
            savedFilters: qs("#adminPaymentsSavedFilters"),
            reset: qs("#adminPaymentsReset"),
            saveFilter: qs("#adminPaymentsSaveFilter"),
            revenue: qs("#adminPaymentsRevenue"),
            average: qs("#adminPaymentsAverage"),
            count: qs("#adminPaymentsCount"),
            manual: qs("#adminPaymentsManual"),
            summary: qs("#adminPaymentsSummary"),
            tableBody: qs("#adminPaymentsTableBody"),
            paginationInfo: qs("#adminPaymentsPaginationInfo"),
            prev: qs("#adminPaymentsPrev"),
            next: qs("#adminPaymentsNext"),
            exportCsv: qs("#adminPaymentsExportCsv"),
            exportExcel: qs("#adminPaymentsExportExcel"),
            create: qs("#adminPaymentsCreate"),
            detailBody: qs("#adminPaymentsDetailBody"),
            manualForm: qs("#adminPaymentsManualForm"),
            manualUser: qs("#adminPaymentsManualUser"),
            manualAmount: qs("#adminPaymentsManualAmount"),
            manualType: qs("#adminPaymentsManualType"),
            manualComment: qs("#adminPaymentsManualComment"),
        };

        const state = {
            items: seedPayments(),
            page: 1,
            pageSize: 8,
            sort: "date",
            sortDir: "desc",
            savedFilters: readJson(STORAGE.paymentFilters, []),
        };

        function save() {
            writeJson(STORAGE.payments, state.items);
        }

        function savePresets() {
            writeJson(STORAGE.paymentFilters, state.savedFilters);
        }

        function withinPeriod(date) {
            const now = Date.now();
            const diff = now - new Date(date).getTime();
            if (els.period.value === "today") return diff <= 86400000;
            if (els.period.value === "week") return diff <= 7 * 86400000;
            if (els.period.value === "month") return diff <= 31 * 86400000;
            if (els.period.value === "quarter") return diff <= 93 * 86400000;
            return true;
        }

        function amountMatch(value) {
            const abs = Math.abs(value);
            if (els.amount.value === "up500") return abs <= 500;
            if (els.amount.value === "500-1000") return abs > 500 && abs <= 1000;
            if (els.amount.value === "1000-3000") return abs > 1000 && abs <= 3000;
            if (els.amount.value === "3000+") return abs > 3000;
            return true;
        }

        function filtered() {
            return state.items.filter((item) => {
                const haystack = `${item.id} ${item.abonent} ${item.account} ${item.comment}`.toLowerCase();
                return (!els.search.value || haystack.includes(els.search.value.trim().toLowerCase()))
                    && (els.type.value === "all" || item.type === els.type.value)
                    && (els.status.value === "all" || item.status === els.status.value)
                    && (els.method.value === "all" || item.method === els.method.value)
                    && withinPeriod(item.date)
                    && amountMatch(item.amount);
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

        function renderQuickChips(items) {
            if (!els.quickChips) return;
            const groups = [
                { key: "all", label: "Все", list: items },
                { key: "topup", label: "Пополнения", list: items.filter((item) => item.type === "topup") },
                { key: "charge", label: "Списания", list: items.filter((item) => item.type === "charge") },
                { key: "manual", label: "Ручные", list: items.filter((item) => item.type === "manual" || item.type === "adjustment") },
                { key: "error", label: "Ошибки", list: items.filter((item) => item.status === "error") },
            ];
            els.quickChips.innerHTML = groups.map((group) => {
                const total = group.list.reduce((sum, item) => sum + Math.abs(item.amount), 0);
                return `<button class="chip" type="button" data-quick-type="${group.key}">${group.label} (${group.list.length}) — ${formatCompactCurrency(total)}</button>`;
            }).join("");
            qsa("[data-quick-type]", els.quickChips).forEach((button) => {
                button.addEventListener("click", () => {
                    els.type.value = button.dataset.quickType === "error" ? "all" : button.dataset.quickType;
                    els.status.value = button.dataset.quickType === "error" ? "error" : "all";
                    render();
                });
            });
        }

        function renderKpi(items) {
            const revenue = items.filter((item) => item.amount > 0 && item.status === "success").reduce((sum, item) => sum + item.amount, 0);
            const average = items.filter((item) => item.amount > 0 && item.status === "success");
            const manual = items.filter((item) => item.type === "manual" || item.type === "adjustment").reduce((sum, item) => sum + item.amount, 0);
            if (els.revenue) els.revenue.textContent = formatCompactCurrency(revenue);
            if (els.average) els.average.textContent = formatCompactCurrency(average.length ? revenue / average.length : 0);
            if (els.count) els.count.textContent = String(items.length);
            if (els.manual) els.manual.textContent = formatCompactCurrency(manual);
        }

        function typeLabel(value) {
            return ({
                topup: "Пополнение",
                charge: "Списание",
                manual: "Ручное",
                adjustment: "Корректировка",
                bonus: "Бонус",
            })[value] || value;
        }

        function methodLabel(value) {
            return ({
                card: "Карта",
                sbp: "СБП",
                auto: "Авто",
                manual: "Ручное",
            })[value] || value;
        }

        function renderTable(items) {
            els.tableBody.innerHTML = items.map((item) => {
                const warningClass = Math.abs(item.amount) > 10000 ? "is-warning" : item.status === "error" ? "is-danger" : "";
                return `
                    <tr class="${warningClass}">
                        <td>${item.id}</td>
                        <td>${formatDateTime(item.date)}</td>
                        <td><button class="btn btn-ghost btn-sm is-clickable" type="button" data-filter-user="${escapeHtml(item.abonent)}">${escapeHtml(item.abonent)}</button></td>
                        <td>${escapeHtml(item.account)}</td>
                        <td>${badge(item.type)}</td>
                        <td>${item.amount > 0 ? "+" : ""}${formatCompactCurrency(item.amount)}</td>
                        <td>${escapeHtml(methodLabel(item.method))}</td>
                        <td>${badge(item.status)}</td>
                        <td>${escapeHtml(item.operator)}</td>
                        <td>${escapeHtml(item.comment)}</td>
                        <td class="admin-suite-actions">
                            <button class="btn btn-secondary btn-xs" type="button" data-detail="${item.id}">👁️</button>
                            ${item.type !== "charge" ? `<button class="btn btn-secondary btn-xs" type="button" data-repeat="${item.id}">🔄</button>` : ""}
                        </td>
                    </tr>
                `;
            }).join("");
            qsa("[data-detail]", PAGE).forEach((button) => button.addEventListener("click", () => openDetail(Number(button.dataset.detail))));
            qsa("[data-repeat]", PAGE).forEach((button) => button.addEventListener("click", () => repeatPayment(Number(button.dataset.repeat))));
            qsa("[data-filter-user]", PAGE).forEach((button) => button.addEventListener("click", () => {
                els.search.value = button.dataset.filterUser;
                render();
            }));
        }

        function openDetail(id) {
            const item = state.items.find((entry) => entry.id === id);
            if (!item || !els.detailBody) return;
            els.detailBody.innerHTML = `
                <div class="admin-suite-log">
                    <div class="admin-suite-log-item"><strong>Транзакция</strong><p>ID ${item.id} · ${formatDateTime(item.date)}</p></div>
                    <div class="admin-suite-log-item"><strong>Абонент</strong><p>${escapeHtml(item.abonent)} · ${escapeHtml(item.account)} · ${escapeHtml(item.phone)}</p></div>
                    <div class="admin-suite-log-item"><strong>Операция</strong><p>${escapeHtml(typeLabel(item.type))} · ${formatCompactCurrency(item.amount)} · ${escapeHtml(methodLabel(item.method))}</p></div>
                    <div class="admin-suite-log-item"><strong>Комментарий</strong><p>${escapeHtml(item.comment)}</p></div>
                    <div class="admin-suite-actions">
                        <button class="btn btn-secondary btn-sm" type="button" id="adminPaymentsPrint">Распечатать чек</button>
                    </div>
                </div>
            `;
            qs("#adminPaymentsPrint", els.detailBody)?.addEventListener("click", () => {
                const printWindow = window.open("", "_blank", "width=760,height=720");
                if (!printWindow) return;
                printWindow.document.write(`<h1>Квитанция MTN</h1><p>ID ${item.id}</p><p>${escapeHtml(item.abonent)}</p><p>${formatCompactCurrency(item.amount)}</p><p>${formatDateTime(item.date)}</p>`);
                printWindow.document.close();
                printWindow.print();
            });
            openModal("adminPaymentsDetailModal");
        }

        function repeatPayment(id) {
            const item = state.items.find((entry) => entry.id === id);
            if (!item) return;
            const nextId = Math.max(...state.items.map((entry) => entry.id)) + 1;
            state.items.unshift({ ...item, id: nextId, date: new Date().toISOString(), comment: `Повтор операции ${item.id}` });
            save();
            render();
            toast(`Операция ${item.id} повторена.`, "success");
        }

        function render() {
            const items = filtered();
            const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
            if (state.page > totalPages) state.page = totalPages;
            renderQuickChips(state.items);
            renderKpi(items);
            renderTable(paginated(items));
            if (els.summary) els.summary.textContent = `Показано ${items.length} операций по текущим фильтрам.`;
            if (els.paginationInfo) els.paginationInfo.textContent = `Страница ${state.page} из ${totalPages}`;
        }

        function currentFilterPreset() {
            return {
                search: els.search.value,
                period: els.period.value,
                type: els.type.value,
                status: els.status.value,
                method: els.method.value,
                amount: els.amount.value,
            };
        }

        function applyPreset(preset) {
            if (!preset) return;
            els.search.value = preset.search || "";
            els.period.value = preset.period || "all";
            els.type.value = preset.type || "all";
            els.status.value = preset.status || "all";
            els.method.value = preset.method || "all";
            els.amount.value = preset.amount || "all";
            render();
        }

        function renderSavedFilters() {
            els.savedFilters.innerHTML = `<option value="">Выберите фильтр</option>${state.savedFilters.map((item, index) => `<option value="${index}">${escapeHtml(item.name)}</option>`).join("")}`;
        }

        [els.search, els.period, els.type, els.status, els.method, els.amount].forEach((control) => control?.addEventListener("input", () => {
            state.page = 1;
            render();
        }));
        els.prev?.addEventListener("click", () => {
            state.page = Math.max(1, state.page - 1);
            render();
        });
        els.next?.addEventListener("click", () => {
            state.page += 1;
            render();
        });
        els.reset?.addEventListener("click", () => {
            applyPreset({ search: "", period: "all", type: "all", status: "all", method: "all", amount: "all" });
        });
        els.saveFilter?.addEventListener("click", () => {
            const name = window.prompt("Название фильтра", "Платежи за период");
            if (!name) return;
            state.savedFilters.push({ name, ...currentFilterPreset() });
            savePresets();
            renderSavedFilters();
            toast("Фильтр сохранён.", "success");
        });
        els.savedFilters?.addEventListener("change", () => {
            const preset = state.savedFilters[Number(els.savedFilters.value)];
            applyPreset(preset);
        });
        els.exportCsv?.addEventListener("click", () => {
            const items = filtered();
            const rows = [
                ["ID", "Дата", "Абонент", "Лицевой счёт", "Тип", "Сумма", "Способ", "Статус", "Комментарий"],
                ...items.map((item) => [item.id, formatDateTime(item.date), item.abonent, item.account, typeLabel(item.type), item.amount, methodLabel(item.method), item.status, item.comment]),
                [],
                ["Итого пополнений", items.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0)],
                ["Итого списаний", items.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0)],
            ];
            downloadFile("mtn-admin-payments.csv", `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`, "text/csv;charset=utf-8");
            toast("CSV-отчёт подготовлен.", "success");
        });
        els.exportExcel?.addEventListener("click", () => {
            toast("Демо-Excel отчёт подготовлен как CSV-совместимый файл.", "info");
            els.exportCsv.click();
        });
        els.create?.addEventListener("click", () => openModal("adminPaymentsManualModal"));
        els.manualForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            const amount = Number(els.manualAmount.value || 0);
            if (!amount || !els.manualUser.value.trim()) {
                toast("Укажите абонента и сумму.", "error");
                return;
            }
            const ok = window.confirm(`Зачислить ${formatCompactCurrency(amount)} абоненту ${els.manualUser.value.trim()}?`);
            if (!ok) return;
            const nextId = Math.max(...state.items.map((item) => item.id)) + 1;
            state.items.unshift({
                id: nextId,
                date: new Date().toISOString(),
                abonent: els.manualUser.value.trim(),
                account: `MANUAL${nextId}`,
                type: els.manualType.value === "bonus" ? "manual" : els.manualType.value,
                amount,
                method: "manual",
                status: "success",
                operator: "Иван Иванов",
                comment: els.manualComment.value.trim() || "Ручная операция",
                phone: "—",
            });
            save();
            closeModal("adminPaymentsManualModal");
            els.manualForm.reset();
            render();
            toast("Баланс абонента успешно пополнен.", "success");
        });

        renderSavedFilters();
        render();
    }

    function seedOperators() {
        const existing = readJson(STORAGE.operators, null);
        if (Array.isArray(existing) && existing.length) return existing;
        const items = [
            { id: 1, name: "Иван Иванов", email: "ivan@mtn.ru", role: "admin", status: "active", lastLogin: new Date(Date.now() - 42 * 60000).toISOString(), activeTickets: 0, activities: [{ date: new Date(Date.now() - 42 * 60000).toISOString(), action: "Вход в систему", ip: "192.168.1.1", details: "Успешный вход" }] },
            { id: 2, name: "Мария Петрова", email: "maria@mtn.ru", role: "operator", status: "active", lastLogin: new Date(Date.now() - 3 * 60000).toISOString(), activeTickets: 3, activities: [{ date: new Date(Date.now() - 10 * 60000).toISOString(), action: "Ответ в заявке №122", ip: "192.168.1.15", details: "Проблема с оплатой" }] },
            { id: 3, name: "Алексей Смирнов", email: "alex@mtn.ru", role: "operator", status: "active", lastLogin: new Date(Date.now() - 2 * 3600000).toISOString(), activeTickets: 5, activities: [{ date: new Date(Date.now() - 2 * 3600000).toISOString(), action: "Изменение статуса заявки №123", ip: "192.168.1.44", details: "Новая → В работе" }] },
            { id: 4, name: "Елена Козлова", email: "elena@mtn.ru", role: "operator", status: "blocked", lastLogin: new Date(Date.now() - 5 * 86400000).toISOString(), activeTickets: 0, activities: [{ date: new Date(Date.now() - 10 * 86400000).toISOString(), action: "Выход из системы", ip: "192.168.1.33", details: "—" }] },
            { id: 5, name: "Дмитрий Морозов", email: "dmitry@mtn.ru", role: "operator", status: "active", lastLogin: new Date(Date.now() - 90 * 60000).toISOString(), activeTickets: 1, activities: [{ date: new Date(Date.now() - 90 * 60000).toISOString(), action: "Вход в систему", ip: "192.168.1.55", details: "Успешный вход" }] },
        ];
        writeJson(STORAGE.operators, items);
        return items;
    }

    function initOperatorsPage() {
        if (PAGE.dataset.adminPage !== "operators") return;

        const els = {
            search: qs("#adminOperatorsSearch"),
            role: qs("#adminOperatorsRole"),
            status: qs("#adminOperatorsStatus"),
            reset: qs("#adminOperatorsReset"),
            export: qs("#adminOperatorsExport"),
            create: qs("#adminOperatorsCreate"),
            summary: qs("#adminOperatorsSummary"),
            tableBody: qs("#adminOperatorsTableBody"),
            paginationInfo: qs("#adminOperatorsPaginationInfo"),
            prev: qs("#adminOperatorsPrev"),
            next: qs("#adminOperatorsNext"),
            modalTitle: qs("#adminOperatorsModalTitle"),
            form: qs("#adminOperatorsForm"),
            id: qs("#adminOperatorsId"),
            name: qs("#adminOperatorsName"),
            email: qs("#adminOperatorsEmail"),
            roleInput: qs("#adminOperatorsRoleInput"),
            statusInput: qs("#adminOperatorsStatusInput"),
            password: qs("#adminOperatorsPassword"),
            generatePassword: qs("#adminOperatorsGeneratePassword"),
            validation: qs("#adminOperatorsValidation"),
            delete: qs("#adminOperatorsDelete"),
            passwordBody: qs("#adminOperatorsPasswordBody"),
            logBody: qs("#adminOperatorsLogBody"),
        };

        const state = {
            items: seedOperators(),
            page: 1,
            pageSize: 5,
            sort: "id",
            sortDir: "asc",
        };

        function save() {
            writeJson(STORAGE.operators, state.items);
        }

        function initials(name) {
            return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        }

        function isOnline(lastLogin) {
            return Date.now() - new Date(lastLogin).getTime() <= 5 * 60000;
        }

        function filtered() {
            return state.items.filter((item) => {
                const haystack = `${item.name} ${item.email} ${item.role}`.toLowerCase();
                return (!els.search.value || haystack.includes(els.search.value.trim().toLowerCase()))
                    && (els.role.value === "all" || item.role === els.role.value)
                    && (els.status.value === "all" || item.status === els.status.value);
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

        function generatePassword() {
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
            let result = "";
            for (let i = 0; i < 12; i += 1) result += chars[Math.floor(Math.random() * chars.length)];
            return result;
        }

        function validate() {
            const email = els.email.value.trim().toLowerCase();
            const duplicate = state.items.find((item) => item.email.toLowerCase() === email && String(item.id) !== String(els.id.value || ""));
            if (!els.name.value.trim()) return "Введите имя оператора.";
            if (!email) return "Введите email.";
            if (duplicate) return "Этот email уже используется.";
            if (!els.id.value && String(els.password.value || "").length < 8) return "Пароль должен быть не короче 8 символов.";
            return "";
        }

        function fillForm(item) {
            els.modalTitle.textContent = item ? "Редактировать оператора" : "Добавить оператора";
            els.id.value = item?.id || "";
            els.name.value = item?.name || "";
            els.email.value = item?.email || "";
            els.roleInput.value = item?.role || "operator";
            els.statusInput.value = item?.status || "active";
            els.password.value = "";
            els.validation.textContent = "";
            openModal("adminOperatorsModal");
        }

        function bindActions() {
            qsa("[data-edit-operator]", PAGE).forEach((button) => button.addEventListener("click", () => fillForm(state.items.find((item) => item.id === Number(button.dataset.editOperator)))));
            qsa("[data-toggle-operator]", PAGE).forEach((button) => button.addEventListener("click", () => {
                const item = state.items.find((entry) => entry.id === Number(button.dataset.toggleOperator));
                if (!item) return;
                item.status = item.status === "active" ? "blocked" : "active";
                item.activities.unshift({ date: new Date().toISOString(), action: item.status === "active" ? "Разблокировка" : "Блокировка", ip: "192.168.1.1", details: "Статус доступа изменён" });
                save();
                render();
                toast(`Статус оператора «${item.name}» обновлён.`, "success");
            }));
            qsa("[data-reset-password]", PAGE).forEach((button) => button.addEventListener("click", () => {
                const item = state.items.find((entry) => entry.id === Number(button.dataset.resetPassword));
                if (!item || !els.passwordBody) return;
                const password = generatePassword();
                item.activities.unshift({ date: new Date().toISOString(), action: "Сброс пароля", ip: "192.168.1.1", details: `Временный пароль: ${password}` });
                save();
                els.passwordBody.innerHTML = `
                    <div class="admin-suite-log">
                        <div class="admin-suite-log-item"><strong>${escapeHtml(item.name)}</strong><p>Новый временный пароль: <code>${escapeHtml(password)}</code></p></div>
                        <div class="admin-suite-actions"><button class="btn btn-secondary btn-sm" type="button" id="adminOperatorsCopyPassword">Скопировать пароль</button></div>
                    </div>
                `;
                qs("#adminOperatorsCopyPassword", els.passwordBody)?.addEventListener("click", () => {
                    navigator.clipboard?.writeText(password);
                    toast("Пароль скопирован в буфер обмена.", "success");
                });
                openModal("adminOperatorsPasswordModal");
            }));
            qsa("[data-operator-log]", PAGE).forEach((button) => button.addEventListener("click", () => {
                const item = state.items.find((entry) => entry.id === Number(button.dataset.operatorLog));
                if (!item || !els.logBody) return;
                els.logBody.innerHTML = `
                    <div class="admin-suite-actions" style="margin-bottom:16px"><button class="btn btn-secondary btn-sm" type="button" id="adminOperatorsExportLog">Экспорт CSV</button></div>
                    <div class="admin-suite-log">
                        ${item.activities.map((activity) => `
                            <article class="admin-suite-log-item">
                                <strong>${escapeHtml(activity.action)}</strong>
                                <p>${escapeHtml(activity.details)}</p>
                                <small>${formatDateTime(activity.date)} · ${escapeHtml(activity.ip)}</small>
                            </article>
                        `).join("")}
                    </div>
                `;
                qs("#adminOperatorsExportLog", els.logBody)?.addEventListener("click", () => {
                    const rows = [["Дата", "Действие", "IP", "Детали"], ...item.activities.map((entry) => [formatDateTime(entry.date), entry.action, entry.ip, entry.details])];
                    downloadFile(`mtn-operator-${item.id}-log.csv`, `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`, "text/csv;charset=utf-8");
                });
                openModal("adminOperatorsLogModal");
            }));
        }

        function render() {
            const items = filtered();
            const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
            if (state.page > totalPages) state.page = totalPages;
            els.tableBody.innerHTML = paginated(items).map((item) => `
                <tr>
                    <td>${item.id}</td>
                    <td><span class="admin-suite-badge ${item.role === "admin" ? "is-info" : "is-muted"}">${initials(item.name)}</span></td>
                    <td>${escapeHtml(item.name)} ${isOnline(item.lastLogin) ? '<span class="admin-suite-badge is-success">онлайн</span>' : ""}</td>
                    <td>${escapeHtml(item.email)}</td>
                    <td>${badge(item.role)}</td>
                    <td>${badge(item.status)}</td>
                    <td>${formatDateTime(item.lastLogin)}</td>
                    <td><div class="admin-suite-progress"><span style="width:${Math.min(100, item.activeTickets * 20)}%"></span></div><small>${item.activeTickets} активных заявок</small></td>
                    <td class="admin-suite-actions">
                        <button class="btn btn-secondary btn-xs" type="button" data-edit-operator="${item.id}">✏️</button>
                        <button class="btn btn-secondary btn-xs" type="button" data-toggle-operator="${item.id}">${item.status === "active" ? "🔒" : "🔓"}</button>
                        <button class="btn btn-secondary btn-xs" type="button" data-reset-password="${item.id}">🔄</button>
                        <button class="btn btn-secondary btn-xs" type="button" data-operator-log="${item.id}">📋</button>
                    </td>
                </tr>
            `).join("");
            if (els.summary) els.summary.textContent = `Найдено ${items.length} сотрудников.`;
            if (els.paginationInfo) els.paginationInfo.textContent = `Страница ${state.page} из ${totalPages}`;
            bindActions();
        }

        qsa("[data-sort]", PAGE).forEach((cell) => {
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

        [els.search, els.role, els.status].forEach((control) => control?.addEventListener("input", () => {
            state.page = 1;
            render();
        }));
        els.prev?.addEventListener("click", () => {
            state.page = Math.max(1, state.page - 1);
            render();
        });
        els.next?.addEventListener("click", () => {
            state.page += 1;
            render();
        });
        els.reset?.addEventListener("click", () => {
            els.search.value = "";
            els.role.value = "all";
            els.status.value = "all";
            render();
        });
        els.export?.addEventListener("click", () => {
            const rows = [["ID", "Имя", "Email", "Роль", "Статус", "Последний вход", "Активные заявки"], ...filtered().map((item) => [item.id, item.name, item.email, item.role, item.status, formatDateTime(item.lastLogin), item.activeTickets])];
            downloadFile("mtn-admin-operators.csv", `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`, "text/csv;charset=utf-8");
            toast("Экспорт операторов подготовлен.", "success");
        });
        els.create?.addEventListener("click", () => fillForm(null));
        els.generatePassword?.addEventListener("click", () => {
            els.password.value = generatePassword();
        });
        els.email?.addEventListener("input", () => {
            els.validation.textContent = validate();
        });
        els.form?.addEventListener("submit", (event) => {
            event.preventDefault();
            const error = validate();
            els.validation.textContent = error;
            if (error) return;
            const payload = {
                id: els.id.value ? Number(els.id.value) : Math.max(0, ...state.items.map((item) => item.id)) + 1,
                name: els.name.value.trim(),
                email: els.email.value.trim(),
                role: els.roleInput.value,
                status: els.statusInput.value,
                lastLogin: new Date().toISOString(),
                activeTickets: els.id.value ? (state.items.find((item) => item.id === Number(els.id.value))?.activeTickets || 0) : 0,
                activities: els.id.value ? (state.items.find((item) => item.id === Number(els.id.value))?.activities || []) : [],
            };
            const existing = state.items.findIndex((item) => item.id === payload.id);
            if (existing >= 0) state.items.splice(existing, 1, payload);
            else state.items.push(payload);
            save();
            closeModal("adminOperatorsModal");
            render();
            toast(`Сотрудник «${payload.name}» сохранён.`, "success");
        });
        els.delete?.addEventListener("click", () => {
            const id = Number(els.id.value || 0);
            if (!id) return closeModal("adminOperatorsModal");
            const item = state.items.find((entry) => entry.id === id);
            if (!item) return;
            const adminsLeft = state.items.filter((entry) => entry.role === "admin" && entry.id !== id).length;
            if (item.role === "admin" && adminsLeft === 0) {
                els.validation.textContent = "Нельзя удалить последнего admin.";
                return;
            }
            state.items = state.items.filter((entry) => entry.id !== id);
            save();
            closeModal("adminOperatorsModal");
            render();
            toast(`Сотрудник «${item.name}» удалён.`, "success");
        });

        render();
    }

    initTariffsPage();
    initPaymentsPage();
    initOperatorsPage();
})();
