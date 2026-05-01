(function () {
    const ui = window.OperatorUI || null;

    const STORAGE = {
        dashboard: "mtn-dashboard-store-v2",
        supportTickets: "mtn_support_tickets_v1",
        supportChat: "mtn_support_chat_v1",
        supportDraft: "mtn_support_draft_v1",
        notifications: "mtn_notifications_v1",
        notificationsPins: "mtn_notifications_pins_v1",
        notificationsReminders: "mtn_notifications_reminders_v1",
        notificationsPush: "mtn_notifications_push_v1",
        speedtestHistory: "mtn_speedtest_history_v1",
        speedtestServer: "mtn_speedtest_server_v1",
        paymentsCard: "mtn_payments_saved_card_v1",
        paymentsAutopay: "mtn_payments_autopay_v1",
        paymentsBonus: "mtn_payments_bonus_v1",
        paymentsSpendProfile: "mtn_payments_spend_profile_v1",
        profileAvatar: "mtn_profile_avatar_v1",
        profileLoginHistory: "mtn_profile_login_history_v1",
    };

    const SPEEDTEST_SERVERS = {
        moscow: { id: "moscow", label: "MTN (Москва)", latency: [9, 16], downloadFactor: 1, uploadFactor: 1 },
        spb: { id: "spb", label: "Санкт-Петербург", latency: [14, 24], downloadFactor: 0.94, uploadFactor: 0.92 },
        amsterdam: { id: "amsterdam", label: "Европа (Амстердам)", latency: [26, 48], downloadFactor: 0.82, uploadFactor: 0.8 },
    };

    const FAQ_ITEMS = [
        {
            question: "Как узнать свой лицевой счёт?",
            answer: "Лицевой счёт указан в шапке дашборда, в карточке баланса и на странице профиля. Для копирования используйте иконку рядом с номером счёта.",
        },
        {
            question: "Что делать, если нет интернета?",
            answer: "Перезагрузите роутер, проверьте кабель и индикатор PON/Link. Если индикатор не горит, воспользуйтесь диагностическим помощником и создайте заявку.",
        },
        {
            question: "Как сменить тарифный план?",
            answer: "Откройте страницу «Тарифы», сравните предложения и нажмите «Выбрать». Новый тариф начнёт действовать с 1 числа следующего месяца или сегодня с доплатой, если услуга доступна.",
        },
        {
            question: "Как пополнить баланс без комиссии?",
            answer: "Пополняйте счёт через СБП или банковскую карту в разделе «Оплата». Комиссия MTN за пополнение не взимается.",
        },
        {
            question: "Как подключить роутер?",
            answer: "Подключите кабель провайдера к WAN-порту, включите питание и дождитесь стабильного индикатора сети. Затем настройте Wi-Fi через приложение или веб-интерфейс роутера.",
        },
        {
            question: "Как заблокировать услугу?",
            answer: "Временную блокировку услуги можно запросить через поддержку. Укажите номер лицевого счёта и желаемый период приостановки.",
        },
        {
            question: "Как подключить ТВ-пакет?",
            answer: "Откройте раздел тарифов или обратитесь в поддержку. Мы подскажем, какие ТВ-пакеты совместимы с вашим тарифом и оборудованием.",
        },
    ];

    const CHAT_TEMPLATES = {
        internet_down: "У меня нет доступа к интернету. Роутер перезагружал, не помогло. Индикаторы: PON горит, LAN не горит.",
        speed_low: "Скорость ниже ожидаемой. Последний speedtest показывает снижение, прошу помочь с диагностикой линии.",
        payment_issue: "Не вижу поступивший платёж или есть вопрос по списанию. Проверьте, пожалуйста, историю операций.",
        tariff_change: "Хочу изменить тарифный план и уточнить, когда начнёт действовать новый тариф.",
    };

    const SUPPORT_FORECAST = {
        new: "Оператор назначен. Ответ в течение 30 минут.",
        in_progress: "Среднее время решения: 2 часа.",
        resolved: "Проблема решена. Заявка будет закрыта через 3 дня.",
        closed: "Заявка закрыта. При необходимости можно создать новую.",
    };

    function qs(selector, root = document) {
        return root.querySelector(selector);
    }

    function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
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
        if (ui?.toast) {
            ui.toast(message, type, title);
            return;
        }
        console.log(`[${type}] ${title ? `${title}: ` : ""}${message}`);
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
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function formatDateShort(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function startOfDay(date) {
        const result = new Date(date);
        result.setHours(0, 0, 0, 0);
        return result;
    }

    function relativeDateGroup(value) {
        const date = new Date(value);
        const today = startOfDay(new Date());
        const target = startOfDay(date);
        const diffDays = Math.round((today - target) / 86400000);
        if (diffDays <= 0) return "Сегодня";
        if (diffDays === 1) return "Вчера";
        if (diffDays <= 7) return "На этой неделе";
        return "Ранее";
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

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function uid(prefix) {
        return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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

    function getDashboardStore() {
        const fallback = {
            selectedServiceId: "internet-home",
            services: [
                {
                    id: "internet-home",
                    accountLabel: "Интернет (DEMO77777)",
                    billingId: "DEMO77777",
                    ownerName: "Мартин",
                    balance: 1470,
                    debt: 450,
                    tariff: { name: "Город 300", speed: 300, price: 790 },
                    charges: [
                        { date: "1 апреля", label: "Абонентская плата", amount: 790 },
                        { date: "15 апреля", label: "ТВ-пакет", amount: 200 },
                    ],
                },
            ],
        };
        const store = readJson(STORAGE.dashboard, fallback);
        const service = (store.services || []).find((item) => item.id === store.selectedServiceId) || store.services?.[0] || fallback.services[0];
        return { store, service };
    }

    function getSpeedtestHistory() {
        return readJson(STORAGE.speedtestHistory, []);
    }

    function setSpeedtestHistory(items) {
        writeJson(STORAGE.speedtestHistory, items);
    }

    function seedSupportTickets() {
        const existing = readJson(STORAGE.supportTickets, null);
        if (Array.isArray(existing) && existing.length) return existing;
        const seeded = [
            {
                id: 123,
                createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
                topic: "Отсутствует доступ к интернету",
                description: "После перезагрузки роутера интернет не появился. PON мигает, подключение нестабильное.",
                status: "in_progress",
                forecast: SUPPORT_FORECAST.in_progress,
                files: [],
                messages: [
                    { author: "user", text: "После перезагрузки роутера интернет не появился. PON мигает.", createdAt: new Date(Date.now() - 4 * 86400000).toISOString() },
                    { author: "operator", text: "Здравствуйте! Проверяем линию. Если индикатор PON мигает, возможно, проблема на участке.", createdAt: new Date(Date.now() - 4 * 86400000 + 3600000).toISOString() },
                ],
                history: [
                    { createdAt: new Date(Date.now() - 4 * 86400000).toISOString(), text: "Заявка создана" },
                    { createdAt: new Date(Date.now() - 4 * 86400000 + 3600000).toISOString(), text: "Оператор взял заявку в работу" },
                ],
            },
            {
                id: 122,
                createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
                topic: "Вопрос по оплате",
                description: "Не вижу пополнение, которое делал вчера вечером через СБП.",
                status: "resolved",
                forecast: SUPPORT_FORECAST.resolved,
                files: [],
                messages: [
                    { author: "user", text: "Не вижу пополнение через СБП.", createdAt: new Date(Date.now() - 8 * 86400000).toISOString() },
                    { author: "operator", text: "Проверили платёж, он успешно зачислен. Баланс обновлён.", createdAt: new Date(Date.now() - 8 * 86400000 + 5400000).toISOString() },
                ],
                history: [
                    { createdAt: new Date(Date.now() - 8 * 86400000).toISOString(), text: "Заявка создана" },
                    { createdAt: new Date(Date.now() - 7 * 86400000).toISOString(), text: "Статус изменён на «Решена»" },
                ],
            },
        ];
        writeJson(STORAGE.supportTickets, seeded);
        return seeded;
    }

    function seedSupportChat() {
        const existing = readJson(STORAGE.supportChat, null);
        if (Array.isArray(existing) && existing.length) return existing;
        const seeded = [
            {
                id: uid("chat"),
                author: "operator",
                text: "Здравствуйте! Я рядом и помогу разобраться. Опишите, пожалуйста, ситуацию.",
                createdAt: new Date(Date.now() - 600000).toISOString(),
            },
        ];
        writeJson(STORAGE.supportChat, seeded);
        return seeded;
    }

    function seedNotifications() {
        const existing = readJson(STORAGE.notifications, null);
        if (Array.isArray(existing) && existing.length) return existing;
        const now = Date.now();
        const items = [
            { id: "n1", type: "charge", title: "Списание абонентской платы", body: "Списано 790 ₽ за тариф «Город 300». Баланс: 1 470 ₽.", createdAt: new Date(now - 90 * 60000).toISOString(), unread: true },
            { id: "n2", type: "topup", title: "Пополнение баланса", body: "Баланс пополнен на 500 ₽. Спасибо!", createdAt: new Date(now - 150 * 60000).toISOString(), unread: false },
            { id: "n3", type: "support", title: "Новый ответ в заявке №123", body: "Оператор ответил на вашу заявку «Нет интернета». Перейти к диалогу.", createdAt: new Date(now - 27 * 3600000).toISOString(), unread: true },
            { id: "n4", type: "promo", title: "Специальное предложение", body: "При пополнении от 1 000 ₽ получите 100 бонусов. Успейте до 31 марта!", createdAt: new Date(now - 3 * 86400000).toISOString(), unread: false, promoCode: "MTN100" },
            { id: "n5", type: "maintenance", title: "Плановые технические работы", body: "25 марта с 02:00 до 06:00 возможны перебои в доступе в районе Южный. Приносим извинения.", createdAt: new Date(now - 4 * 86400000).toISOString(), unread: true },
            { id: "n6", type: "charge", title: "Списание за ТВ-пакет", body: "Списано 200 ₽ за пакет «Кино». Баланс: 1 270 ₽.", createdAt: new Date(now - 9 * 86400000).toISOString(), unread: false },
            { id: "n7", type: "support", title: "Заявка №120 закрыта", body: "Ваша заявка «Вопрос по оплате» решена. Спасибо, что пользуетесь MTN.", createdAt: new Date(now - 12 * 86400000).toISOString(), unread: false },
            { id: "n8", type: "topup", title: "Пополнение баланса", body: "Баланс пополнен на 1 000 ₽ через СБП.", createdAt: new Date(now - 15 * 86400000).toISOString(), unread: false },
            { id: "n9", type: "promo", title: "Бонусы начислены", body: "Вам начислено 50 бонусов за пополнение от 1 000 ₽.", createdAt: new Date(now - 20 * 86400000).toISOString(), unread: false, promoCode: "BONUS50" },
            { id: "n10", type: "maintenance", title: "Технические работы завершены", body: "Работы в районе Южный завершены. Интернет доступен в полном объёме.", createdAt: new Date(now - 26 * 86400000).toISOString(), unread: false },
        ];
        writeJson(STORAGE.notifications, items);
        return items;
    }

    function renderSupportPage() {
        if (!document.body.classList.contains("mtn-support-page")) return;

        const els = {
            tabs: qsa("[data-support-tab]"),
            tabOpeners: qsa("[data-support-tab-open]"),
            panels: qsa("[data-support-panel]"),
            faqInput: qs("#mtnFaqSearchInput"),
            faqList: qs("#mtnFaqList"),
            faqEmpty: qs("#mtnFaqEmptyState"),
            wizard: qs("#mtnDiagnosticWizard"),
            topic: qs("#mtnTicketTopicInput"),
            description: qs("#mtnTicketDescriptionInput"),
            files: qs("#mtnTicketFilesInput"),
            filesList: qs("#mtnTicketFilesList"),
            form: qs("#mtnTicketCreateForm"),
            ticketsList: qs("#mtnSupportTicketsList"),
            ticketsEmpty: qs("#mtnSupportTicketsEmpty"),
            speedContext: qs("#mtnSupportSpeedContext"),
            draftBanner: qs("#mtnSupportRestoreDraft"),
            restoreDraft: qs("#mtnSupportRestoreDraftButton"),
            dropDraft: qs("#mtnSupportDropDraftButton"),
            runSpeedtest: qs("#mtnSupportRunSpeedtest"),
            chatMessages: qs("#mtnChatMessages"),
            chatForm: qs("#mtnChatForm"),
            chatInput: qs("#mtnChatInput"),
            templateButtons: qsa("[data-chat-template]"),
            ticketModal: qs("#mtnSupportTicketModal"),
            ticketModalTitle: qs("#mtnSupportTicketModalTitle"),
            ticketModalMeta: qs("#mtnSupportTicketModalMeta"),
            ticketModalBody: qs("#mtnSupportTicketModalBody"),
            callbackOpen: qs("#mtnSupportCallbackOpen"),
            callbackModal: qs("#mtnSupportCallbackModal"),
            callbackForm: qs("#mtnSupportCallbackForm"),
        };

        const state = {
            activeTab: window.location.hash.replace("#", "") || "faq",
            tickets: seedSupportTickets(),
            chat: seedSupportChat(),
            attachedFiles: [],
        };

        function saveTickets() {
            writeJson(STORAGE.supportTickets, state.tickets);
        }

        function saveChat() {
            writeJson(STORAGE.supportChat, state.chat);
        }

        function persistDraft() {
            const draft = {
                topic: els.topic?.value || "",
                description: els.description?.value || "",
                files: state.attachedFiles.map((file) => file.name),
            };
            if (draft.topic || draft.description) writeJson(STORAGE.supportDraft, draft);
            else window.localStorage.removeItem(STORAGE.supportDraft);
        }

        function renderTabs() {
            els.tabs.forEach((tab) => {
                const active = tab.dataset.supportTab === state.activeTab;
                tab.classList.toggle("is-active", active);
                tab.setAttribute("aria-selected", String(active));
            });
            els.panels.forEach((panel) => {
                const active = panel.dataset.supportPanel === state.activeTab;
                panel.hidden = !active;
                panel.classList.toggle("is-active", active);
            });
            window.history.replaceState({}, "", `#${state.activeTab}`);
        }

        function renderFaq() {
            const query = String(els.faqInput?.value || "").trim().toLowerCase();
            const items = FAQ_ITEMS.filter((item) => {
                const haystack = `${item.question} ${item.answer}`.toLowerCase();
                return !query || haystack.includes(query);
            });
            if (els.faqEmpty) els.faqEmpty.hidden = items.length > 0;
            if (!els.faqList) return;
            els.faqList.innerHTML = items.map((item, index) => `
                <article class="mtn-faq-item">
                    <button class="mtn-faq-item__question" type="button" data-faq-toggle="${index}" aria-expanded="false">
                        <span>${escapeHtml(item.question)}</span>
                        <i class="fas fa-chevron-down" aria-hidden="true"></i>
                    </button>
                    <div class="mtn-faq-item__answer" hidden>${escapeHtml(item.answer)}</div>
                </article>
            `).join("");
            qsa("[data-faq-toggle]", els.faqList).forEach((button) => {
                button.addEventListener("click", () => {
                    const answer = button.nextElementSibling;
                    const expanded = button.getAttribute("aria-expanded") === "true";
                    button.setAttribute("aria-expanded", String(!expanded));
                    answer.hidden = expanded;
                });
            });
        }

        function renderWizard(step = 0) {
            if (!els.wizard) return;
            const steps = [
                {
                    title: "Перезагружали роутер?",
                    options: [
                        { label: "Да", next: 1, helper: "Переходим к проверке линии." },
                        { label: "Нет", next: 1, helper: "Выключите роутер на 30 секунд и включите снова, затем переходите к следующему шагу." },
                    ],
                },
                {
                    title: "Горит ли индикатор PON / Link?",
                    options: [
                        { label: "Да", next: 2, helper: "Линия выглядит активной, проверим локальную сеть." },
                        { label: "Нет", next: "ticket", helper: "Похоже, проблема на линии. Лучше сразу создать заявку." },
                    ],
                },
                {
                    title: "Проблема решилась?",
                    options: [
                        { label: "Да", next: "done", helper: "Отлично. Если ситуация повторится, вернитесь к помощнику." },
                        { label: "Нет", next: "ticket", helper: "Подготовим заявку с уже заполненным описанием." },
                    ],
                },
            ];
            if (step === "done") {
                els.wizard.innerHTML = `
                    <div class="mtn-diagnostic-step">
                        <strong>Соединение восстановлено</strong>
                        <p>Если проблема повторится, запустите speedtest и откройте чат с оператором.</p>
                    </div>
                `;
                return;
            }
            if (step === "ticket") {
                els.wizard.innerHTML = `
                    <div class="mtn-diagnostic-step">
                        <strong>Пора создать заявку</strong>
                        <p>Мы подставим тему и базовое описание, чтобы оператор быстрее начал диагностику.</p>
                        <button class="btn btn-primary btn-sm" type="button" id="mtnWizardCreateTicket">Создать заявку</button>
                    </div>
                `;
                qs("#mtnWizardCreateTicket", els.wizard)?.addEventListener("click", () => {
                    state.activeTab = "tickets";
                    renderTabs();
                    if (els.topic) els.topic.value = "Отсутствует доступ к интернету";
                    if (els.description && !els.description.value.trim()) {
                        els.description.value = "Нет доступа к интернету. Роутер перезагружал, индикатор PON / Link не горит стабильно.";
                    }
                    persistDraft();
                });
                return;
            }
            const current = steps[step];
            els.wizard.innerHTML = `
                <div class="mtn-diagnostic-step">
                    <strong>${escapeHtml(current.title)}</strong>
                    <div class="mtn-chip-row">
                        ${current.options.map((option, index) => `
                            <button class="btn btn-secondary btn-sm" type="button" data-wizard-option="${index}">${escapeHtml(option.label)}</button>
                        `).join("")}
                    </div>
                    <p class="table-copy" id="mtnWizardHelper">Выберите вариант ответа.</p>
                </div>
            `;
            qsa("[data-wizard-option]", els.wizard).forEach((button) => {
                button.addEventListener("click", () => {
                    const option = current.options[Number(button.dataset.wizardOption)];
                    const helper = qs("#mtnWizardHelper", els.wizard);
                    if (helper) helper.textContent = option.helper;
                    window.setTimeout(() => renderWizard(option.next), 450);
                });
            });
        }

        function renderFiles() {
            if (!els.filesList) return;
            if (!state.attachedFiles.length) {
                els.filesList.innerHTML = "";
                return;
            }
            els.filesList.innerHTML = state.attachedFiles.map((file, index) => `
                <div class="mtn-file-chip">
                    <span>${escapeHtml(file.name)}</span>
                    <button type="button" data-file-remove="${index}" aria-label="Удалить файл">×</button>
                </div>
            `).join("");
            qsa("[data-file-remove]", els.filesList).forEach((button) => {
                button.addEventListener("click", () => {
                    state.attachedFiles.splice(Number(button.dataset.fileRemove), 1);
                    renderFiles();
                    persistDraft();
                });
            });
        }

        function renderDraftBanner() {
            const draft = readJson(STORAGE.supportDraft, null);
            if (els.draftBanner) els.draftBanner.hidden = !draft?.description && !draft?.topic;
        }

        function statusLabel(status) {
            return ({
                new: "Новая",
                in_progress: "В работе",
                resolved: "Решена",
                closed: "Закрыта",
            })[status] || "Новая";
        }

        function renderTickets() {
            if (!els.ticketsList) return;
            const sorted = [...state.tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            if (els.ticketsEmpty) els.ticketsEmpty.hidden = sorted.length > 0;
            els.ticketsList.innerHTML = sorted.map((ticket) => `
                <article class="mtn-ticket-card" data-ticket-id="${ticket.id}">
                    <div class="mtn-ticket-card__head">
                        <div>
                            <strong>Заявка №${ticket.id}</strong>
                            <p>${escapeHtml(ticket.topic)}</p>
                        </div>
                        <span class="mtn-ticket-status mtn-ticket-status--${ticket.status}">${statusLabel(ticket.status)}</span>
                    </div>
                    <p>${escapeHtml(ticket.description)}</p>
                    <div class="mtn-ticket-card__meta">
                        <span>${formatDateTime(ticket.createdAt)}</span>
                        <span>${escapeHtml(ticket.forecast || SUPPORT_FORECAST[ticket.status] || SUPPORT_FORECAST.new)}</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" type="button" data-ticket-open="${ticket.id}">Открыть</button>
                </article>
            `).join("");
            qsa("[data-ticket-open]", els.ticketsList).forEach((button) => {
                button.addEventListener("click", () => openTicketModal(Number(button.dataset.ticketOpen)));
            });
        }

        function openTicketModal(id) {
            const ticket = state.tickets.find((item) => Number(item.id) === Number(id));
            if (!ticket || !els.ticketModal || !els.ticketModalBody) return;
            if (els.ticketModalTitle) els.ticketModalTitle.textContent = `Заявка №${ticket.id}`;
            if (els.ticketModalMeta) els.ticketModalMeta.textContent = `${statusLabel(ticket.status)} · ${ticket.forecast || SUPPORT_FORECAST[ticket.status] || ""}`;
            els.ticketModalBody.innerHTML = `
                <div class="mtn-modal-section">
                    <strong>${escapeHtml(ticket.topic)}</strong>
                    <p>${escapeHtml(ticket.description)}</p>
                </div>
                <div class="mtn-modal-section">
                    <strong>Переписка</strong>
                    <div class="mtn-history-list">
                        ${ticket.messages.map((message) => `
                            <article class="mtn-history-item">
                                <strong>${message.author === "operator" ? "Оператор" : "Вы"}</strong>
                                <p>${escapeHtml(message.text)}</p>
                                <small>${formatDateTime(message.createdAt)}</small>
                            </article>
                        `).join("")}
                    </div>
                </div>
                <div class="mtn-modal-section">
                    <strong>История изменений</strong>
                    <div class="mtn-history-list">
                        ${ticket.history.map((entry) => `
                            <article class="mtn-history-item">
                                <p>${escapeHtml(entry.text)}</p>
                                <small>${formatDateTime(entry.createdAt)}</small>
                            </article>
                        `).join("")}
                    </div>
                </div>
            `;
            els.ticketModal.hidden = false;
            document.body.classList.add("modal-open");
        }

        function closeModal(modal) {
            if (!modal) return;
            modal.hidden = true;
            document.body.classList.remove("modal-open");
        }

        function renderChat() {
            if (!els.chatMessages) return;
            els.chatMessages.innerHTML = state.chat.map((message) => `
                <article class="mtn-chat-bubble ${message.author === "user" ? "is-user" : "is-operator"}">
                    <div>${escapeHtml(message.text)}</div>
                    <small>${formatDateShort(message.createdAt)}</small>
                </article>
            `).join("");
            els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
        }

        function addOperatorReply(customText) {
            state.chat.push({
                id: uid("chat"),
                author: "operator",
                text: customText || "Здравствуйте! Мы получили ваше сообщение. Оператор скоро подключится и уточнит детали.",
                createdAt: new Date().toISOString(),
            });
            saveChat();
            renderChat();
        }

        function maybeInjectSpeedContext() {
            if (!els.topic || !els.speedContext) return;
            const latest = getSpeedtestHistory()[0];
            const isSpeed = els.topic.value === "Снижена скорость соединения";
            if (!isSpeed || !latest) {
                els.speedContext.hidden = true;
                els.speedContext.innerHTML = "";
                return;
            }
            const percent = Math.round((latest.download / 300) * 100);
            els.speedContext.hidden = false;
            els.speedContext.innerHTML = `
                <strong>Последний speedtest</strong>
                <p>Ваша скорость: ${Math.round(latest.download)} Мбит/с | Тариф: 300 Мбит/с.</p>
                ${percent < 80 ? `<p class="mtn-text-danger">Скорость ниже 80% от тарифа. Этот контекст будет добавлен в заявку.</p>` : ""}
            `;
            if (els.description && !els.description.value.includes("speedtest")) {
                els.description.value = `${els.description.value.trim()}\n\nПоследний speedtest: ${Math.round(latest.download)} Мбит/с download, ${Math.round(latest.upload)} Мбит/с upload, ping ${latest.ping} мс.`.trim();
            }
        }

        els.tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                state.activeTab = tab.dataset.supportTab || "faq";
                renderTabs();
            });
        });
        els.tabOpeners.forEach((button) => {
            button.addEventListener("click", () => {
                state.activeTab = button.dataset.supportTabOpen || "tickets";
                renderTabs();
            });
        });
        els.faqInput?.addEventListener("input", renderFaq);
        els.topic?.addEventListener("change", () => {
            maybeInjectSpeedContext();
            persistDraft();
        });
        els.description?.addEventListener("input", persistDraft);
        els.files?.addEventListener("change", (event) => {
            state.attachedFiles = Array.from(event.target.files || []).slice(0, 5).map((file) => ({ name: file.name, size: file.size }));
            renderFiles();
            persistDraft();
        });
        els.restoreDraft?.addEventListener("click", () => {
            const draft = readJson(STORAGE.supportDraft, null);
            if (!draft) return;
            if (els.topic) els.topic.value = draft.topic || "";
            if (els.description) els.description.value = draft.description || "";
            state.attachedFiles = (draft.files || []).map((name) => ({ name }));
            renderFiles();
            renderDraftBanner();
            toast("Черновик восстановлен.", "success");
        });
        els.dropDraft?.addEventListener("click", () => {
            window.localStorage.removeItem(STORAGE.supportDraft);
            renderDraftBanner();
            toast("Черновик удалён.", "success");
        });
        els.runSpeedtest?.addEventListener("click", () => {
            window.location.href = "/speedtest";
        });
        els.form?.addEventListener("submit", (event) => {
            event.preventDefault();
            const topic = String(els.topic?.value || "").trim();
            const description = String(els.description?.value || "").trim();
            if (!topic || description.length < 10) {
                toast("Заполните тему заявки и опишите проблему минимум в 10 символов.", "error");
                return;
            }
            const nextId = Math.max(120, ...state.tickets.map((item) => Number(item.id) || 0)) + 1;
            state.tickets.unshift({
                id: nextId,
                createdAt: new Date().toISOString(),
                topic,
                description,
                status: "new",
                forecast: SUPPORT_FORECAST.new,
                files: state.attachedFiles.map((file) => file.name),
                messages: [{ author: "user", text: description, createdAt: new Date().toISOString() }],
                history: [{ createdAt: new Date().toISOString(), text: "Заявка создана" }],
            });
            saveTickets();
            renderTickets();
            state.activeTab = "tickets";
            renderTabs();
            els.form.reset();
            state.attachedFiles = [];
            renderFiles();
            maybeInjectSpeedContext();
            window.localStorage.removeItem(STORAGE.supportDraft);
            renderDraftBanner();
            toast(`Заявка №${nextId} отправлена. Мы уже начали обработку.`, "success");
        });
        els.templateButtons.forEach((button) => {
            button.addEventListener("click", () => {
                const text = CHAT_TEMPLATES[button.dataset.chatTemplate] || "";
                if (els.chatInput) {
                    els.chatInput.value = text;
                    els.chatInput.focus();
                }
                state.activeTab = "chat";
                renderTabs();
            });
        });
        els.chatForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            const text = String(els.chatInput?.value || "").trim();
            if (!text) return;
            state.chat.push({ id: uid("chat"), author: "user", text, createdAt: new Date().toISOString() });
            saveChat();
            renderChat();
            if (els.chatInput) els.chatInput.value = "";
            window.setTimeout(() => addOperatorReply(), 1100);
        });
        els.chatInput?.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                els.chatForm?.requestSubmit();
            }
        });
        els.callbackOpen?.addEventListener("click", () => {
            if (els.callbackModal) {
                els.callbackModal.hidden = false;
                document.body.classList.add("modal-open");
            }
        });
        els.callbackForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            closeModal(els.callbackModal);
            toast("Оператор перезвонит вам в ближайшее время.", "success");
        });
        qsa("[data-support-modal-close]").forEach((button) => button.addEventListener("click", () => closeModal(els.ticketModal)));
        qsa("[data-support-callback-close]").forEach((button) => button.addEventListener("click", () => closeModal(els.callbackModal)));
        [els.ticketModal, els.callbackModal].forEach((modal) => {
            modal?.addEventListener("click", (event) => {
                if (event.target === modal) closeModal(modal);
            });
        });

        renderTabs();
        renderFaq();
        renderWizard();
        renderFiles();
        renderTickets();
        renderChat();
        renderDraftBanner();
        maybeInjectSpeedContext();
    }

    function renderNotificationsPage() {
        if (!document.body.classList.contains("mtn-notifications-page")) return;

        const els = {
            unreadBadge: qs("#mtnNotificationsUnreadBadge"),
            typeFilters: qsa("[data-type-filter]", qs("#mtnNotificationsTypeFilters")),
            searchInput: qs("#mtnNotificationsSearchInput"),
            dateFilter: qs("#mtnNotificationsDateFilter"),
            enablePush: qs("#mtnNotificationsEnablePush"),
            markAll: qs("#mtnNotificationsMarkAll"),
            export: qs("#mtnNotificationsExport"),
            pinnedSection: qs("#mtnNotificationsPinnedSection"),
            pinnedList: qs("#mtnNotificationsPinnedList"),
            emptyState: qs("#mtnNotificationsEmptyState"),
            content: qs("#mtnNotificationsContent"),
            loadMore: qs("#mtnNotificationsLoadMore"),
        };

        const state = {
            type: "all",
            search: "",
            date: "all",
            visibleCount: 6,
            items: seedNotifications(),
            pins: new Set(readJson(STORAGE.notificationsPins, [])),
            reminders: readJson(STORAGE.notificationsReminders, []),
            pushEnabled: window.localStorage.getItem(STORAGE.notificationsPush) === "true",
        };

        function saveItems() {
            writeJson(STORAGE.notifications, state.items);
        }

        function savePins() {
            writeJson(STORAGE.notificationsPins, Array.from(state.pins));
        }

        function saveReminders() {
            writeJson(STORAGE.notificationsReminders, state.reminders);
        }

        function syncReminderReturns() {
            const now = Date.now();
            const due = state.reminders.filter((entry) => new Date(entry.remindAt).getTime() <= now);
            if (!due.length) return;
            due.forEach((entry) => {
                const item = state.items.find((candidate) => candidate.id === entry.id);
                if (item) item.unread = true;
            });
            state.reminders = state.reminders.filter((entry) => new Date(entry.remindAt).getTime() > now);
            saveReminders();
            saveItems();
        }

        function matchesDate(item) {
            const createdAt = new Date(item.createdAt).getTime();
            const now = Date.now();
            const diff = now - createdAt;
            if (state.date === "today") return diff <= 86400000;
            if (state.date === "week") return diff <= 7 * 86400000;
            if (state.date === "month") return diff <= 31 * 86400000;
            return true;
        }

        function filteredItems() {
            const hiddenByReminder = new Set(state.reminders.map((entry) => entry.id));
            return state.items.filter((item) => {
                const haystack = `${item.title} ${item.body}`.toLowerCase();
                return (state.type === "all" || item.type === state.type)
                    && (!state.search || haystack.includes(state.search))
                    && matchesDate(item)
                    && !hiddenByReminder.has(item.id);
            }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        function markRead(id, silent = false) {
            const item = state.items.find((entry) => entry.id === id);
            if (!item) return;
            item.unread = false;
            saveItems();
            render();
            if (!silent) toast("Уведомление отмечено как прочитанное.", "success");
        }

        function copyPromo(code) {
            if (!code) return;
            navigator.clipboard?.writeText(code);
            toast("Промокод скопирован.", "success");
        }

        function reminderTimestamp(mode) {
            const now = new Date();
            if (mode === "hour") return new Date(now.getTime() + 3600000).toISOString();
            if (mode === "tomorrow") return new Date(now.getTime() + 86400000).toISOString();
            if (mode === "weekend") return new Date(now.getTime() + 2 * 86400000).toISOString();
            return new Date(now.getTime() + 3 * 86400000).toISOString();
        }

        function groupItems(items) {
            const groups = [];
            const counts = {};
            items.forEach((item) => {
                const monthKey = new Date(item.createdAt).toISOString().slice(0, 7);
                const clusterKey = `${item.type}_${monthKey}`;
                counts[clusterKey] = counts[clusterKey] || [];
                counts[clusterKey].push(item);
            });
            const collapsed = new Set();
            Object.values(counts).forEach((cluster) => {
                if (cluster.length >= 3 && (cluster[0].type === "charge" || cluster[0].type === "topup")) {
                    groups.push({
                        kind: "group",
                        id: `group_${cluster[0].type}_${cluster[0].createdAt}`,
                        title: `${cluster.length} ${cluster[0].type === "charge" ? "списания" : "пополнения"} за месяц`,
                        items: cluster,
                        createdAt: cluster[0].createdAt,
                    });
                    cluster.forEach((item) => collapsed.add(item.id));
                }
            });
            items.forEach((item) => {
                if (!collapsed.has(item.id)) groups.push({ kind: "item", ...item });
            });
            return groups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        function notificationActions(item) {
            if (item.type === "charge") return `<button class="btn btn-ghost btn-sm" type="button" data-route="/payments">Подробнее</button>`;
            if (item.type === "topup") return `<button class="btn btn-ghost btn-sm" type="button" data-route="/payments">Пополнить снова</button>`;
            if (item.type === "promo") return `<button class="btn btn-ghost btn-sm" type="button" data-copy-promo="${escapeHtml(item.promoCode || "MTN100")}">Скопировать промокод</button>`;
            if (item.type === "maintenance") return `<button class="btn btn-ghost btn-sm" type="button" data-subscribe-maintenance="${item.id}">Подписаться на завершение</button>`;
            if (item.type === "support") return `<button class="btn btn-ghost btn-sm" type="button" data-route="/tickets#tickets">Перейти к диалогу</button>`;
            return "";
        }

        function renderCard(item) {
            return `
                <article class="mtn-notification-card ${item.unread ? "is-unread" : ""}" data-notification-id="${item.id}">
                    <div class="mtn-notification-card__head">
                        <div>
                            <strong>${escapeHtml(item.title)}</strong>
                            <span>${formatDateTime(item.createdAt)}</span>
                        </div>
                        <div class="mtn-chip-row">
                            <button class="icon-btn" type="button" data-pin-id="${item.id}" aria-label="Закрепить">${state.pins.has(item.id) ? "📌" : "📍"}</button>
                            <button class="icon-btn" type="button" data-reminder-target="${item.id}" data-reminder-mode="hour" aria-label="Напомнить позже">⏰</button>
                        </div>
                    </div>
                    <p>${escapeHtml(item.body)}</p>
                    <div class="mtn-chip-row">
                        ${notificationActions(item)}
                        <button class="btn btn-ghost btn-sm" type="button" data-mark-read="${item.id}">Прочитано</button>
                        <button class="btn btn-ghost btn-sm" type="button" data-reminder-target="${item.id}" data-reminder-mode="tomorrow">Завтра</button>
                    </div>
                </article>
            `;
        }

        function render() {
            syncReminderReturns();
            const items = filteredItems();
            const unreadCount = state.items.filter((item) => item.unread).length;
            if (els.unreadBadge) els.unreadBadge.textContent = `${unreadCount} непрочитанных`;
            const headerBadge = qs("#headerUnreadBadge");
            if (headerBadge) {
                headerBadge.hidden = unreadCount === 0;
                headerBadge.textContent = String(unreadCount);
            }
            els.typeFilters.forEach((button) => button.classList.toggle("is-active", button.dataset.typeFilter === state.type));

            const pinned = items.filter((item) => state.pins.has(item.id));
            if (els.pinnedSection) els.pinnedSection.hidden = pinned.length === 0;
            if (els.pinnedList) els.pinnedList.innerHTML = pinned.map(renderCard).join("");

            const nonPinned = items.filter((item) => !state.pins.has(item.id)).slice(0, state.visibleCount);
            const groups = groupItems(nonPinned);
            if (els.emptyState) els.emptyState.hidden = items.length > 0;
            if (els.content) {
                const groupedByDate = groups.reduce((acc, item) => {
                    const label = relativeDateGroup(item.createdAt);
                    acc[label] = acc[label] || [];
                    acc[label].push(item);
                    return acc;
                }, {});
                els.content.innerHTML = Object.entries(groupedByDate).map(([label, group]) => `
                    <section class="mtn-notifications-group">
                        <div class="mtn-section-head"><h2 class="mtn-section-title">${escapeHtml(label)}</h2></div>
                        <div class="mtn-notifications-list">
                            ${group.map((item) => item.kind === "group" ? `
                                <article class="mtn-notification-card">
                                    <div class="mtn-notification-card__head">
                                        <strong>${escapeHtml(item.title)}</strong>
                                        <span>${formatDateTime(item.createdAt)}</span>
                                    </div>
                                    <p>Собрали похожие уведомления в один блок, чтобы не перегружать ленту.</p>
                                    <details>
                                        <summary>Показать все</summary>
                                        <div class="mtn-history-list">${item.items.map(renderCard).join("")}</div>
                                    </details>
                                </article>
                            ` : renderCard(item)).join("")}
                        </div>
                    </section>
                `).join("");
            }

            if (els.loadMore) els.loadMore.hidden = nonPinned.length >= items.filter((item) => !state.pins.has(item.id)).length;

            qsa("[data-mark-read]", document).forEach((button) => button.addEventListener("click", () => markRead(button.dataset.markRead)));
            qsa("[data-pin-id]", document).forEach((button) => {
                button.addEventListener("click", () => {
                    const id = button.dataset.pinId;
                    if (state.pins.has(id)) state.pins.delete(id);
                    else state.pins.add(id);
                    savePins();
                    render();
                });
            });
            qsa("[data-reminder-target]", document).forEach((button) => {
                button.addEventListener("click", () => {
                    const id = button.dataset.reminderTarget;
                    const mode = button.dataset.reminderMode;
                    state.reminders = state.reminders.filter((entry) => entry.id !== id);
                    state.reminders.push({ id, remindAt: reminderTimestamp(mode) });
                    saveReminders();
                    toast("Напоминание отложено.", "success");
                    render();
                });
            });
            qsa("[data-copy-promo]", document).forEach((button) => button.addEventListener("click", () => copyPromo(button.dataset.copyPromo)));
            qsa("[data-subscribe-maintenance]", document).forEach((button) => button.addEventListener("click", () => toast("Напоминание о завершении работ включено.", "success")));
            qsa("[data-route]", document).forEach((button) => {
                button.addEventListener("click", () => {
                    const parent = button.closest("[data-notification-id]");
                    if (parent) markRead(parent.dataset.notificationId, true);
                    window.location.href = button.dataset.route;
                });
            });
        }

        els.typeFilters.forEach((button) => button.addEventListener("click", () => {
            state.type = button.dataset.typeFilter || "all";
            state.visibleCount = 6;
            render();
        }));
        els.searchInput?.addEventListener("input", () => {
            state.search = String(els.searchInput.value || "").trim().toLowerCase();
            render();
        });
        els.dateFilter?.addEventListener("change", () => {
            state.date = els.dateFilter.value || "all";
            render();
        });
        els.markAll?.addEventListener("click", () => {
            filteredItems().forEach((item) => {
                const target = state.items.find((entry) => entry.id === item.id);
                if (target) target.unread = false;
            });
            saveItems();
            toast("Все уведомления отмечены как прочитанные.", "success");
            render();
        });
        els.export?.addEventListener("click", () => {
            downloadFile("mtn-notifications.json", JSON.stringify(filteredItems(), null, 2), "application/json;charset=utf-8");
            toast("Экспорт уведомлений подготовлен.", "success");
        });
        els.loadMore?.addEventListener("click", () => {
            state.visibleCount += 6;
            render();
        });
        els.enablePush?.addEventListener("click", async () => {
            if (!("Notification" in window)) {
                toast("Браузер не поддерживает push-уведомления.", "warning");
                return;
            }
            const result = await Notification.requestPermission();
            if (result === "granted") {
                state.pushEnabled = true;
                window.localStorage.setItem(STORAGE.notificationsPush, "true");
                toast("Браузерные уведомления включены.", "success");
            } else {
                toast("Разрешение на push не получено.", "warning");
            }
        });

        render();

        if (state.pushEnabled && "Notification" in window) {
            window.setInterval(() => {
                const item = {
                    id: uid("notif"),
                    type: "support",
                    title: "Новое уведомление от MTN",
                    body: "Напоминаем проверить новые ответы поддержки и состояние ваших услуг.",
                    createdAt: new Date().toISOString(),
                    unread: true,
                };
                state.items.unshift(item);
                saveItems();
                render();
                try {
                    new Notification(item.title, { body: item.body });
                } catch (error) {
                    console.warn("Notification failed", error);
                }
            }, 30000);
        }
    }

    function renderSpeedtestPage() {
        if (!document.body.classList.contains("mtn-speedtest-page")) return;

        const els = {
            run: qs("#mtnSpeedtestRun"),
            stability: qs("#mtnSpeedtestStability"),
            server: qs("#mtnSpeedtestServerSelect"),
            poorLink: qs("#mtnSpeedtestPoorLink"),
            export: qs("#mtnSpeedtestExport"),
            dial: qs("#mtnSpeedtestDialValue"),
            stageLabel: qs("#mtnSpeedtestStageLabel"),
            progressBar: qs("#mtnSpeedtestProgressBar"),
            ping: qs("#mtnSpeedtestPing"),
            download: qs("#mtnSpeedtestDownload"),
            upload: qs("#mtnSpeedtestUpload"),
            comparisonText: qs("#mtnSpeedtestComparisonText"),
            comparisonBar: qs("#mtnSpeedtestComparisonBar"),
            supportLink: qs("#mtnSpeedtestSupportLink"),
            neighborText: qs("#mtnSpeedtestNeighborText"),
            diagnosis: qs("#mtnSpeedtestDiagnosis"),
            diagnosisList: qs("#mtnSpeedtestDiagnosisList"),
            trendText: qs("#mtnSpeedtestTrendText"),
            historyCanvas: qs("#mtnSpeedtestHistoryChart"),
            historyEmpty: qs("#mtnSpeedtestHistoryEmpty"),
            historyList: qs("#mtnSpeedtestHistoryList"),
            advice: qs("#mtnSpeedtestAdvice"),
            adviceList: qs("#mtnSpeedtestAdviceList"),
        };

        const { service } = getDashboardStore();
        const state = {
            history: getSpeedtestHistory(),
            running: false,
            server: window.localStorage.getItem(STORAGE.speedtestServer) || "moscow",
            chart: null,
        };

        function ensureServerOptions() {
            if (!els.server) return;
            els.server.innerHTML = Object.values(SPEEDTEST_SERVERS).map((item) => `
                <option value="${item.id}">${escapeHtml(item.label)}</option>
            `).join("");
            els.server.value = state.server;
        }

        function saveHistory() {
            setSpeedtestHistory(state.history.slice(0, 30));
        }

        function metricColor(percent) {
            if (percent >= 90) return "#10B981";
            if (percent >= 70) return "#F59E0B";
            return "#EF4444";
        }

        function renderComparison(last) {
            if (!last || !els.comparisonText || !els.comparisonBar) return;
            const tariffSpeed = Number(service?.tariff?.speed || 300);
            const percent = Math.round((last.download / tariffSpeed) * 100);
            els.comparisonBar.style.width = `${Math.min(percent, 100)}%`;
            els.comparisonBar.style.background = metricColor(percent);
            els.comparisonText.textContent = percent < 70
                ? `Ваша скорость составляет ${percent}% от заявленной. Рекомендуем проверить оборудование или обратиться в поддержку.`
                : `Ваша скорость составляет ${percent}% от заявленной. Хороший результат!`;
        }

        function renderNeighbors(last) {
            if (!els.neighborText) return;
            const districtAverage = 210;
            if (!last) {
                els.neighborText.textContent = "Средняя скорость по району: 210 Мбит/с.";
                return;
            }
            els.neighborText.textContent = last.download >= districtAverage
                ? `Ваша скорость ${Math.round(last.download)} Мбит/с против средней ${districtAverage} Мбит/с. Вы выше среднего!`
                : `Ваша скорость ${Math.round(last.download)} Мбит/с против средней ${districtAverage} Мбит/с. Ниже среднего, возможно, проблема в оборудовании.`;
        }

        function renderDiagnosis(last) {
            if (!els.diagnosis || !els.diagnosisList) return;
            if (!last) {
                els.diagnosis.hidden = true;
                return;
            }
            const findings = [];
            const tariffSpeed = Number(service?.tariff?.speed || 300);
            if (last.ping > 50) findings.push("Высокая задержка. Перезагрузите роутер.");
            if (last.download < tariffSpeed * 0.5) findings.push("Скорость ниже заявленной. Создайте заявку в поддержку.");
            if (last.upload < 10) findings.push("Низкая скорость отдачи. Это может влиять на видеозвонки и облачные сервисы.");
            if (!findings.length) findings.push("Серьёзных отклонений не обнаружено. Соединение выглядит стабильным.");
            els.diagnosis.hidden = false;
            els.diagnosisList.innerHTML = findings.map((item) => `<div class="mtn-history-item">${escapeHtml(item)}</div>`).join("");
        }

        function renderAdvice(last) {
            if (!els.advice || !els.adviceList) return;
            const tariffSpeed = Number(service?.tariff?.speed || 300);
            const show = last && last.download < tariffSpeed * 0.8;
            els.advice.hidden = !show;
            if (!show) return;
            els.adviceList.innerHTML = [
                "Перезагрузите роутер и дождитесь полной синхронизации.",
                "Подключитесь к сети 5 ГГц, если роутер её поддерживает.",
                "Проверьте кабель Ethernet или исключите промежуточные переходники.",
                "Уберите роутер ближе к центру квартиры.",
                "Отключите лишние устройства от Wi-Fi во время теста.",
            ].map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        }

        function renderTrend() {
            if (!els.trendText) return;
            if (state.history.length < 2) {
                els.trendText.textContent = "Пока нет данных. Запустите первый тест, чтобы увидеть график.";
                return;
            }
            const recent = state.history.slice(0, 7);
            const older = state.history.slice(7, 14);
            if (!older.length) {
                els.trendText.textContent = "Данных ещё мало для полноценного тренда.";
                return;
            }
            const avgRecent = recent.reduce((sum, item) => sum + item.download, 0) / recent.length;
            const avgOlder = older.reduce((sum, item) => sum + item.download, 0) / older.length;
            const diff = ((avgRecent - avgOlder) / Math.max(avgOlder, 1)) * 100;
            if (diff > 5) els.trendText.textContent = `За последние 30 дней скорость выросла на ${Math.round(diff)}%.`;
            else if (diff < -5) els.trendText.textContent = `За последние 30 дней скорость снизилась на ${Math.abs(Math.round(diff))}%.`;
            else els.trendText.textContent = "Скорость стабильна за последние недели.";
        }

        function renderChart() {
            if (!els.historyCanvas || typeof window.Chart === "undefined") return;
            const labels = [...state.history].slice(0, 10).reverse().map((item) => formatDateShort(item.createdAt));
            const downloadData = [...state.history].slice(0, 10).reverse().map((item) => Math.round(item.download));
            const uploadData = [...state.history].slice(0, 10).reverse().map((item) => Math.round(item.upload));
            if (state.chart) state.chart.destroy();
            state.chart = new window.Chart(els.historyCanvas, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        { label: "Загрузка", data: downloadData, borderColor: "#2563EB", backgroundColor: "rgba(37,99,235,0.12)", tension: 0.35, fill: true },
                        { label: "Отдача", data: uploadData, borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.12)", tension: 0.35, fill: true },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { callback: (value) => `${value} Мбит/с` } },
                    },
                },
            });
        }

        function renderHistory() {
            const items = state.history.slice(0, 10);
            if (els.historyEmpty) els.historyEmpty.hidden = items.length > 0;
            if (els.historyList) {
                els.historyList.innerHTML = items.map((item) => `
                    <article class="mtn-history-item">
                        <strong>${escapeHtml(item.serverLabel)}${item.mode === "stability" ? " · стабильность" : ""}</strong>
                        <p>${formatDateTime(item.createdAt)}</p>
                        <small>Пинг ${item.ping} мс · Загрузка ${Math.round(item.download)} Мбит/с · Отдача ${Math.round(item.upload)} Мбит/с</small>
                    </article>
                `).join("");
            }
            renderTrend();
            renderChart();
            const last = state.history[0];
            renderComparison(last);
            renderNeighbors(last);
            renderDiagnosis(last);
            renderAdvice(last);
        }

        function animateValue(target, value) {
            if (!target) return;
            const start = Number(target.textContent.replace(/[^\d]/g, "")) || 0;
            const delta = value - start;
            const steps = 18;
            let frame = 0;
            const tick = () => {
                frame += 1;
                const current = start + (delta * frame / steps);
                target.textContent = `${Math.round(current)}`;
                if (frame < steps) window.requestAnimationFrame(tick);
            };
            tick();
        }

        function maybeWarnAboutDrop(last) {
            const previous = state.history[1];
            if (!previous) return;
            const drop = ((previous.download - last.download) / Math.max(previous.download, 1)) * 100;
            if (drop > 30) toast(`Скорость упала на ${Math.round(drop)}% по сравнению с предыдущим замером.`, "warning");
        }

        async function runTest(mode = "quick") {
            if (state.running) return;
            state.running = true;
            const server = SPEEDTEST_SERVERS[state.server] || SPEEDTEST_SERVERS.moscow;
            const tariffSpeed = Number(service?.tariff?.speed || 300);
            const poorFactor = els.poorLink?.checked ? 0.58 : 1;
            const steps = [
                { label: "Пинг...", duration: 900 },
                { label: mode === "stability" ? "Тест стабильности..." : "Загрузка...", duration: mode === "stability" ? 3000 : 1700 },
                { label: "Отдача...", duration: 1400 },
            ];
            for (let index = 0; index < steps.length; index += 1) {
                const step = steps[index];
                if (els.stageLabel) els.stageLabel.textContent = step.label;
                if (els.progressBar) els.progressBar.style.width = `${((index + 1) / steps.length) * 100}%`;
                await new Promise((resolve) => window.setTimeout(resolve, step.duration));
            }
            const ping = randomInt(server.latency[0], server.latency[1]) + (els.poorLink?.checked ? 18 : 0);
            const download = Math.max(8, randomInt(Math.round(tariffSpeed * 0.7), Math.round(tariffSpeed * 0.98)) * server.downloadFactor * poorFactor);
            const upload = Math.max(3, randomInt(40, 110) * server.uploadFactor * poorFactor);
            const record = {
                id: uid("speed"),
                mode,
                server: server.id,
                serverLabel: server.label,
                ping,
                download,
                upload,
                createdAt: new Date().toISOString(),
            };
            state.history.unshift(record);
            saveHistory();
            animateValue(els.dial, Math.round(record.download));
            if (els.ping) els.ping.textContent = `${record.ping} мс`;
            if (els.download) els.download.textContent = `${Math.round(record.download)} Мбит/с`;
            if (els.upload) els.upload.textContent = `${Math.round(record.upload)} Мбит/с`;
            if (els.stageLabel) els.stageLabel.textContent = mode === "stability" ? "Тест стабильности завершён" : "Измерение завершено";
            renderHistory();
            maybeWarnAboutDrop(record);
            state.running = false;
        }

        els.run?.addEventListener("click", () => runTest("quick"));
        els.stability?.addEventListener("click", () => runTest("stability"));
        els.server?.addEventListener("change", () => {
            state.server = els.server.value || "moscow";
            window.localStorage.setItem(STORAGE.speedtestServer, state.server);
        });
        els.export?.addEventListener("click", () => {
            const rows = [
                ["Дата", "Сервер", "Пинг", "Загрузка", "Отдача"],
                ...state.history.map((item) => [formatDateTime(item.createdAt), item.serverLabel, item.ping, Math.round(item.download), Math.round(item.upload)]),
            ];
            downloadFile("mtn-speedtest.csv", `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`, "text/csv;charset=utf-8");
            toast("История замеров экспортирована.", "success");
        });
        els.supportLink?.addEventListener("click", (event) => {
            event.preventDefault();
            window.location.href = "/tickets#tickets";
        });

        ensureServerOptions();
        renderHistory();
    }

    function enhancePaymentsPage() {
        if (!document.body.classList.contains("payments-page-v2")) return;

        const els = {
            quickCard: qs("#paymentsQuickPayCard"),
            quickContent: qs("#paymentsQuickPayContent"),
            recommendationTitle: qs("#paymentsRecommendationTitle"),
            recommendationText: qs("#paymentsRecommendationText"),
            recommendationAction: qs("#paymentsRecommendationAction"),
            amountInput: qs("#paymentAmountInput"),
            daysHint: qs("#paymentsDaysHint"),
            debtWrap: qs("#paymentsDebtPresetWrap"),
            bonusHint: qs("#paymentsBonusHint"),
            saveCard: qs("#paymentSaveCard"),
            cardNumber: qs("#paymentCardNumber"),
            cardExpiry: qs("#paymentCardExpiry"),
            autopayTitle: qs("#paymentsAutopayTitle"),
            autopayStatus: qs("#paymentsAutopayStatus"),
            autopayEnabled: qs("#paymentsAutopayEnabled"),
            autopayThreshold: qs("#paymentsAutopayThreshold"),
            autopayAmount: qs("#paymentsAutopayAmount"),
            autopaySave: qs("#paymentsAutopaySave"),
            resetData: qs("#paymentsResetDemoData"),
            submitButton: qs("#paymentSubmitButton"),
        };

        const { service } = getDashboardStore();
        const spendProfile = readJson(STORAGE.paymentsSpendProfile, { monthly: 790, recommended: 1000 });
        const autopay = readJson(STORAGE.paymentsAutopay, { enabled: false, threshold: 200, amount: 500 });
        const bonuses = readJson(STORAGE.paymentsBonus, { current: 150 });

        function currentAmount() {
            return Math.max(0, Number(els.amountInput?.value || 0));
        }

        function updateRecommendation() {
            if (!els.recommendationTitle || !els.recommendationText || !els.recommendationAction) return;
            els.recommendationTitle.textContent = `Рекомендуем пополнить на ${formatCompactCurrency(spendProfile.recommended)}`;
            els.recommendationText.textContent = `Обычно вы тратите около ${formatCompactCurrency(spendProfile.monthly)} в месяц. Пополнение на ${formatCompactCurrency(spendProfile.recommended)} хватит на месяц с запасом.`;
            els.recommendationAction.textContent = `Пополнить ${formatCompactCurrency(spendProfile.recommended)}`;
        }

        function updateDaysHint() {
            if (!els.daysHint) return;
            const amount = currentAmount();
            const monthly = Number(service?.tariff?.price || 790) + 200;
            if (!amount) {
                els.daysHint.textContent = "С учётом ваших услуг сумма пополнения пересчитается автоматически.";
                return;
            }
            const days = Math.round(amount / (monthly / 30.5));
            els.daysHint.textContent = `${formatCompactCurrency(amount)} хватит примерно на ${days} дней с учётом ваших услуг (интернет ${formatCompactCurrency(service?.tariff?.price || 790)} + ТВ 200 ₽).`;
        }

        function updateBonusHint() {
            if (!els.bonusHint) return;
            const amount = currentAmount();
            const gained = amount >= 2000 ? 120 : amount >= 1000 ? 50 : amount >= 500 ? 20 : 0;
            els.bonusHint.innerHTML = `
                <strong>Бонусная программа</strong>
                <p>У вас ${bonuses.current} бонусов. При текущем пополнении вы получите ещё ${gained}. 500 бонусов = скидка 10% на месяц.</p>
            `;
        }

        function renderDebtPreset() {
            if (!els.debtWrap) return;
            const debt = Math.max(0, Number(service?.debt || 0));
            if (!debt) {
                els.debtWrap.innerHTML = "";
                return;
            }
            const reserve = Math.ceil(debt / 100) * 100 + 50;
            els.debtWrap.innerHTML = `
                <button class="mtn-quick-chip" type="button" data-debt-amount="${debt}">Погасить долг ${formatCompactCurrency(debt)}</button>
                <button class="mtn-quick-chip" type="button" data-debt-amount="${reserve}">Долг + запас ${formatCompactCurrency(reserve)}</button>
            `;
            qsa("[data-debt-amount]", els.debtWrap).forEach((button) => {
                button.addEventListener("click", () => {
                    if (els.amountInput) {
                        els.amountInput.value = String(Number(button.dataset.debtAmount));
                        els.amountInput.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                    toast("После оплаты задолженность будет закрыта.", "success");
                });
            });
        }

        function renderQuickCard() {
            const card = readJson(STORAGE.paymentsCard, null);
            if (!els.quickCard || !els.quickContent) return;
            if (!card?.last4) {
                els.quickCard.hidden = true;
                return;
            }
            els.quickCard.hidden = false;
            els.quickContent.innerHTML = `
                <div>
                    <strong>${escapeHtml((card.brand || "card").toUpperCase())} •••• ${escapeHtml(card.last4)}</strong>
                    <p>Срок действия ${escapeHtml(card.expiry || "—")}</p>
                </div>
                <div class="mtn-chip-row">
                    <button class="mtn-quick-chip" type="button" data-quick-amount="100">100 ₽</button>
                    <button class="mtn-quick-chip" type="button" data-quick-amount="300">300 ₽</button>
                    <button class="mtn-quick-chip" type="button" data-quick-amount="500">500 ₽</button>
                </div>
                <button class="btn btn-primary btn-sm" type="button" id="paymentsQuickPayAction">Пополнить</button>
            `;
            let quickAmount = 100;
            qsa("[data-quick-amount]", els.quickContent).forEach((button) => {
                button.addEventListener("click", () => {
                    quickAmount = Number(button.dataset.quickAmount || 100);
                    qsa("[data-quick-amount]", els.quickContent).forEach((chip) => chip.classList.toggle("is-active", chip === button));
                    const action = qs("#paymentsQuickPayAction", els.quickContent);
                    if (action) action.textContent = `Пополнить ${formatCompactCurrency(quickAmount)}`;
                });
            });
            qs("#paymentsQuickPayAction", els.quickContent)?.addEventListener("click", () => {
                if (els.amountInput) {
                    els.amountInput.value = String(quickAmount);
                    els.amountInput.dispatchEvent(new Event("input", { bubbles: true }));
                }
                toast(`Быстрое пополнение на ${formatCompactCurrency(quickAmount)} подготовлено.`, "success");
            });
        }

        function renderAutopay() {
            if (els.autopayTitle) {
                els.autopayTitle.textContent = autopay.enabled ? "Автопополнение включено" : "Настроить автопополнение";
            }
            if (els.autopayStatus) {
                els.autopayStatus.textContent = autopay.enabled
                    ? `При остатке менее ${formatCompactCurrency(autopay.threshold)} спишется ${formatCompactCurrency(autopay.amount)}.`
                    : "Включите автопополнение, чтобы не переживать из-за блокировки при низком балансе.";
            }
            if (els.autopayEnabled) els.autopayEnabled.checked = Boolean(autopay.enabled);
            if (els.autopayThreshold) els.autopayThreshold.value = String(autopay.threshold);
            if (els.autopayAmount) els.autopayAmount.value = String(autopay.amount);
        }

        updateRecommendation();
        updateDaysHint();
        updateBonusHint();
        renderDebtPreset();
        renderQuickCard();
        renderAutopay();

        els.amountInput?.addEventListener("input", () => {
            updateDaysHint();
            updateBonusHint();
        });
        els.recommendationAction?.addEventListener("click", () => {
            if (!els.amountInput) return;
            els.amountInput.value = String(spendProfile.recommended);
            els.amountInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        els.autopaySave?.addEventListener("click", () => {
            autopay.enabled = Boolean(els.autopayEnabled?.checked);
            autopay.threshold = Number(els.autopayThreshold?.value || 200);
            autopay.amount = Number(els.autopayAmount?.value || 500);
            writeJson(STORAGE.paymentsAutopay, autopay);
            renderAutopay();
            toast("Настройки автопополнения сохранены.", "success");
        });
        els.resetData?.addEventListener("click", () => {
            [
                STORAGE.paymentsCard,
                STORAGE.paymentsAutopay,
                STORAGE.paymentsBonus,
                STORAGE.paymentsSpendProfile,
                STORAGE.supportDraft,
                STORAGE.supportTickets,
                STORAGE.supportChat,
                STORAGE.notifications,
                STORAGE.notificationsPins,
                STORAGE.notificationsReminders,
                STORAGE.speedtestHistory,
                STORAGE.profileAvatar,
            ].forEach((key) => window.localStorage.removeItem(key));
            toast("Сохранённые демо-данные очищены. Обновите страницу, чтобы увидеть базовое состояние.", "success");
        });
        if (els.submitButton) {
            const observer = new MutationObserver(() => {
                if (els.submitButton.disabled && els.saveCard?.checked) {
                    const digits = String(els.cardNumber?.value || "").replace(/\D/g, "");
                    const brand = digits.startsWith("4") ? "visa" : digits.startsWith("2") || digits.startsWith("5") ? "mastercard" : "mir";
                    if (digits.length >= 4) {
                        writeJson(STORAGE.paymentsCard, {
                            last4: digits.slice(-4),
                            brand,
                            expiry: els.cardExpiry?.value || "",
                        });
                    }
                }
            });
            observer.observe(els.submitButton, { attributes: true, attributeFilter: ["disabled"] });
        }
    }

    function enhanceProfilePage() {
        if (!document.body.classList.contains("profile-page")) return;

        const els = {
            avatarPreview: qs("#mtnProfileAvatarPreview"),
            avatarInput: qs("#mtnProfileAvatarInput"),
            strengthBar: qs("#mtnPasswordStrengthBar"),
            strengthText: qs("#mtnPasswordStrengthText"),
            newPassword: qs("#newPassword"),
            backupCodes: qs("#twoFactorBackupCodes"),
            downloadBackupCodes: qs("#mtnProfileDownloadBackupCodes"),
            loginHistory: qs("#mtnProfileLoginHistory"),
            exportJson: qs("#mtnProfileExportJson"),
            exportCsv: qs("#mtnProfileExportCsv"),
            exportPdf: qs("#mtnProfileExportPdf"),
        };

        const existingHistory = readJson(STORAGE.profileLoginHistory, null);
        const loginHistory = existingHistory || [
            { createdAt: new Date(Date.now() - 3600000).toISOString(), device: "Chrome на Windows", ip: "192.168.1.10", city: "Москва", suspicious: false },
            { createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), device: "Chrome на Android", ip: "192.168.1.12", city: "Москва", suspicious: false },
            { createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), device: "Safari на iPhone", ip: "77.88.21.4", city: "Санкт-Петербург", suspicious: true },
        ];
        writeJson(STORAGE.profileLoginHistory, loginHistory);

        function renderAvatar() {
            if (!els.avatarPreview) return;
            const avatar = window.localStorage.getItem(STORAGE.profileAvatar);
            if (avatar) {
                els.avatarPreview.innerHTML = `<img src="${avatar}" alt="Аватар профиля">`;
                const userChip = qs(".user-chip-avatar");
                if (userChip) userChip.innerHTML = `<img src="${avatar}" alt="">`;
                const sidebarAvatar = qs(".sidebar-avatar");
                if (sidebarAvatar) sidebarAvatar.innerHTML = `<img src="${avatar}" alt="">`;
                return;
            }
            const firstName = qs("#profileFirstName")?.value?.trim() || document.body.dataset.currentUserName?.trim() || "М";
            els.avatarPreview.textContent = firstName.charAt(0).toUpperCase();
        }

        function updatePasswordStrength() {
            if (!els.newPassword || !els.strengthBar || !els.strengthText) return;
            const value = els.newPassword.value;
            let level = "Слабый";
            let progress = 20;
            let color = "#EF4444";
            if (value.length >= 8 && /\d/.test(value)) {
                level = "Средний";
                progress = 60;
                color = "#F59E0B";
            }
            if (value.length >= 10 && /\d/.test(value) && /[A-ZА-Я]/.test(value)) {
                level = "Сильный";
                progress = 100;
                color = "#10B981";
            }
            els.strengthBar.style.width = `${progress}%`;
            els.strengthBar.style.background = color;
            els.strengthText.textContent = value ? `Сила пароля: ${level}` : "Сила пароля появится во время ввода.";
        }

        function renderLoginHistory() {
            if (!els.loginHistory) return;
            els.loginHistory.innerHTML = loginHistory.map((entry) => `
                <article class="mtn-history-item ${entry.suspicious ? "is-alert" : ""}">
                    <strong>${escapeHtml(entry.device)}</strong>
                    <p>${escapeHtml(entry.city)} · IP ${escapeHtml(entry.ip)}</p>
                    <small>${formatDateTime(entry.createdAt)}${entry.suspicious ? " · отличается от обычного города" : ""}</small>
                </article>
            `).join("");
        }

        function collectProfileData() {
            return {
                profile: {
                    firstName: qs("#profileFirstName")?.value || "",
                    lastName: qs("#profileLastName")?.value || "",
                    middleName: qs("#profileMiddleName")?.value || "",
                    email: qs("#profileEmail")?.value || "",
                    phone: qs("#profilePhone")?.value || "",
                },
                loginHistory,
                speedtest: getSpeedtestHistory(),
                notifications: readJson(STORAGE.notifications, []),
                tickets: readJson(STORAGE.supportTickets, []),
            };
        }

        els.avatarInput?.addEventListener("change", (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (!/^image\/(png|jpeg|jpg)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
                toast("Загрузите JPG или PNG размером до 2 МБ.", "error");
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                window.localStorage.setItem(STORAGE.profileAvatar, String(reader.result));
                renderAvatar();
                toast("Аватар обновлён.", "success");
            };
            reader.readAsDataURL(file);
        });
        els.newPassword?.addEventListener("input", updatePasswordStrength);
        els.downloadBackupCodes?.addEventListener("click", () => {
            const text = (els.backupCodes?.textContent || "").trim();
            downloadFile("mtn-backup-codes.txt", text || "Коды появятся после включения 2FA.");
            toast("Файл с резервными кодами подготовлен.", "success");
        });
        els.exportJson?.addEventListener("click", () => {
            downloadFile("mtn-profile-export.json", JSON.stringify(collectProfileData(), null, 2), "application/json;charset=utf-8");
            toast("Экспорт профиля в JSON готов.", "success");
        });
        els.exportCsv?.addEventListener("click", () => {
            const data = collectProfileData();
            const rows = [
                ["Раздел", "Поле", "Значение"],
                ["Профиль", "Имя", data.profile.firstName],
                ["Профиль", "Фамилия", data.profile.lastName],
                ["Профиль", "Email", data.profile.email],
                ["Профиль", "Телефон", data.profile.phone],
            ];
            downloadFile("mtn-profile-export.csv", `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`, "text/csv;charset=utf-8");
            toast("Экспорт профиля в CSV готов.", "success");
        });
        els.exportPdf?.addEventListener("click", () => {
            const data = collectProfileData();
            const content = [
                "MTN Profile Export",
                "",
                `Имя: ${data.profile.firstName} ${data.profile.lastName}`.trim(),
                `Email: ${data.profile.email}`,
                `Телефон: ${data.profile.phone}`,
                "",
                "Это демо-экспорт PDF. В реальном режиме здесь будет полноценный PDF-документ.",
            ].join("\n");
            downloadFile("mtn-profile-export.pdf.txt", content);
            toast("Демо-экспорт PDF подготовлен.", "success");
        });

        renderAvatar();
        renderLoginHistory();
        updatePasswordStrength();
    }

    function init() {
        renderSupportPage();
        renderNotificationsPage();
        renderSpeedtestPage();
        enhancePaymentsPage();
        enhanceProfilePage();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
