(function () {
    const root = document.querySelector("[data-mtn-dashboard]");
    if (!root) return;

    const body = document.body;
    const STORAGE_KEY = "mtn-dashboard-store-v2";
    const PRIMARY_SERVICE_ID = "internet-home";
    const OPEN_TICKET_STATUSES = new Set(["new", "in_progress", "waiting_customer", "escalated"]);
    const TARIFF_CATALOG = [
        { name: "Старт 100", speed: 100, price: 490 },
        { name: "Город 300", speed: 300, price: 790 },
        { name: "Смена 500", speed: 500, price: 1090 },
    ];

    const toast = document.getElementById("mtnDashboardToast");
    const toastText = document.getElementById("mtnDashboardToastText");
    const toastRetry = document.getElementById("mtnDashboardRetryToast");
    const serviceSwitcherWrap = document.getElementById("mtnHeaderServiceSwitcher");
    const serviceSwitcher = document.getElementById("mtnHeaderServiceSelect");
    const bonusModal = document.getElementById("mtnBonusModal");
    const bonusModalClose = document.getElementById("mtnBonusModalClose");
    const recommendationButton = document.getElementById("mtnRecommendationButton");
    const bonusButton = document.getElementById("mtnBonusButton");
    const retryHandlers = new Set();
    let toastTimer = null;

    // Локальное демо-хранилище поддерживает несколько услуг и переживает перезагрузку страницы.
    function createDefaultStore() {
        return {
            version: 2,
            selectedServiceId: PRIMARY_SERVICE_ID,
            services: [
                {
                    id: PRIMARY_SERVICE_ID,
                    accountLabel: "Интернет (DEMO77777)",
                    billingId: "DEMO77777",
                    ownerName: "Мартин",
                    balance: 1470,
                    debt: 0,
                    tariff: { name: "Город 300", speed: 300, price: 790 },
                    currentSpeed: 271,
                    avgSpeed7d: 142,
                    support: { openTickets: 0, oldestOpenDays: 0, ticketId: null },
                    metrics: { availability: "99.8%", availabilityEvents: 0, responseTime: "3 мин", homes: "5 200+" },
                    charges: [
                        { date: "1 апреля", label: "Абонентская плата", amount: 790 },
                        { date: "15 апреля", label: "ТВ-пакет", amount: 200 },
                    ],
                    bonus: {
                        current: 350,
                        target: 500,
                        options: [
                            { title: "Скидка на абонентскую плату", description: "Списать бонусы при следующем платеже." },
                            { title: "Ускорение на 7 дней", description: "Поднять скорость на ступень выше до конца недели." },
                            { title: "Аренда роутера", description: "Потратить бонусы на бесплатный месяц аренды." },
                        ],
                    },
                    digest: { monthLabel: "Сводка за март", spend: 1790, traffic: "450 ГБ", ticketsTotal: 2, ticketsOpen: 1, ticketsResolved: 1 },
                    balanceHistory: [
                        { date: "1 марта", balance: 760, type: "charge", label: "Абонентская плата", delta: -790 },
                        { date: "5 марта", balance: 1660, type: "topup", label: "Пополнение", delta: 900 },
                        { date: "10 марта", balance: 1510, type: "charge", label: "Подписка ТВ", delta: -150 },
                        { date: "15 марта", balance: 2310, type: "topup", label: "Пополнение", delta: 800 },
                        { date: "22 марта", balance: 1870, type: "charge", label: "Абонентская плата", delta: -440 },
                        { date: "28 марта", balance: 1650, type: "charge", label: "Подписка сервиса", delta: -220 },
                        { date: "31 марта", balance: 1470, type: "charge", label: "Абонентская плата", delta: -180 },
                    ],
                },
                {
                    id: "mobile-line",
                    accountLabel: "Мобильный +7 999 123-45-67",
                    billingId: "MOB1234567",
                    ownerName: "Мартин",
                    balance: 620,
                    debt: 650,
                    tariff: { name: "Старт 100", speed: 100, price: 490 },
                    currentSpeed: 58,
                    avgSpeed7d: 86,
                    support: { openTickets: 1, oldestOpenDays: 4, ticketId: 123 },
                    metrics: { availability: "98.9%", availabilityEvents: 2, responseTime: "7 мин", homes: "5 200+" },
                    charges: [
                        { date: "1 апреля", label: "Абонентская плата", amount: 490 },
                        { date: "10 апреля", label: "Межгород", amount: 160 },
                    ],
                    bonus: {
                        current: 420,
                        target: 500,
                        options: [
                            { title: "Скидка на пакет минут", description: "Компенсировать часть мобильного тарифа бонусами." },
                            { title: "Роуминг на выходные", description: "Подключить пакет поездки по бонусному счёту." },
                            { title: "Подарок близкому", description: "Перевести бонусы на семейный номер в MTN." },
                        ],
                    },
                    digest: { monthLabel: "Сводка за март", spend: 980, traffic: "96 ГБ", ticketsTotal: 3, ticketsOpen: 1, ticketsResolved: 2 },
                    balanceHistory: [
                        { date: "1 марта", balance: 420, type: "charge", label: "Абонентская плата", delta: -490 },
                        { date: "6 марта", balance: 920, type: "topup", label: "Пополнение", delta: 500 },
                        { date: "12 марта", balance: 810, type: "charge", label: "Подписка", delta: -110 },
                        { date: "18 марта", balance: 1110, type: "topup", label: "Пополнение", delta: 300 },
                        { date: "23 марта", balance: 910, type: "charge", label: "Пакет минут", delta: -200 },
                        { date: "28 марта", balance: 780, type: "charge", label: "Роуминг", delta: -130 },
                        { date: "31 марта", balance: 620, type: "charge", label: "Абонентская плата", delta: -160 },
                    ],
                },
            ],
        };
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function readStore() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn("Failed to read MTN dashboard store", error);
            return null;
        }
    }

    function saveStore(store) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function ensureStore() {
        const persisted = readStore();
        if (persisted?.version === 2 && Array.isArray(persisted.services) && persisted.services.length > 0) {
            return persisted;
        }

        const fallback = createDefaultStore();
        saveStore(fallback);
        return fallback;
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            maximumFractionDigits: 0,
        }).format(Number(value || 0));
    }

    function formatBalanceLabel(value) {
        return formatCurrency(value).replace(/\s?₽/, " ₽");
    }

    function firstNameFrom(value) {
        const source = String(value || "").trim();
        return source ? source.split(/\s+/)[0] : "";
    }

    function setText(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
    }

    function setHTML(id, value) {
        const node = document.getElementById(id);
        if (node) node.innerHTML = value;
    }

    function setHidden(id, hidden) {
        const node = document.getElementById(id);
        if (node) node.hidden = hidden;
    }

    function showToast(message) {
        if (!toast || !toastText) return;
        toastText.textContent = message;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(hideToast, 5200);
    }

    function hideToast() {
        if (!toast) return;
        toast.hidden = true;
        window.clearTimeout(toastTimer);
    }

    function registerRetry(handler) {
        retryHandlers.clear();
        retryHandlers.add(handler);
    }

    function setViewState(state) {
        root.dataset.viewState = state;
        root.setAttribute("aria-busy", state === "loading" ? "true" : "false");
        document.querySelectorAll("[data-dashboard-card], [data-dashboard-metric]").forEach((node) => {
            node.classList.toggle("is-loading", state === "loading");
        });
    }

    function setFooterDemoBadge(visible) {
        const badge = document.getElementById("footerDemoBadge");
        if (badge) badge.hidden = !visible;
    }

    function resolvePrivateHref(path) {
        const normalized = path.startsWith("/") ? path : `/${path}`;
        const isAuthenticated = body.dataset.authenticated === "true" || Boolean(window.OperatorUI?.isAuthenticated?.());
        return isAuthenticated ? normalized : `/login?next=${encodeURIComponent(normalized)}`;
    }

    function getSelectedService(store) {
        return store.services.find((service) => service.id === store.selectedServiceId) || store.services[0];
    }

    function computeQualityPercent(service) {
        return Math.max(0, Math.min(100, Math.round((Number(service.currentSpeed || 0) / Number(service.tariff?.speed || 1)) * 100)));
    }

    function findCurrentTariffIndex(service) {
        return TARIFF_CATALOG.findIndex((tariff) => tariff.name === service.tariff?.name);
    }

    function getRecommendation(service) {
        const currentIndex = Math.max(0, findCurrentTariffIndex(service));
        const loadRatio = Number(service.avgSpeed7d || 0) / Number(service.tariff?.speed || 1);
        const currentTariff = TARIFF_CATALOG[currentIndex];

        if (loadRatio > 0.8 && currentIndex < TARIFF_CATALOG.length - 1) {
            const nextTariff = TARIFF_CATALOG[currentIndex + 1];
            return {
                type: "upgrade",
                badge: "Больше скорости",
                title: `Вам подойдёт тариф «${nextTariff.name}»`,
                text: `Вам подойдёт тариф «${nextTariff.name}»: ${nextTariff.speed} Мбит/с за ${formatBalanceLabel(nextTariff.price)}/мес. Доплата ${formatBalanceLabel(nextTariff.price - currentTariff.price)}/мес.`,
                tariff: nextTariff,
            };
        }

        if (loadRatio < 0.5 && currentIndex > 0) {
            const previousTariff = TARIFF_CATALOG[currentIndex - 1];
            return {
                type: "save",
                badge: "Экономия",
                title: `Вам подойдёт тариф «${previousTariff.name}»`,
                text: `Вам подойдёт тариф «${previousTariff.name}»: ${previousTariff.speed} Мбит/с за ${formatBalanceLabel(previousTariff.price)}/мес. Экономия ${formatBalanceLabel(currentTariff.price - previousTariff.price)}/мес.`,
                tariff: previousTariff,
            };
        }

        return {
            type: "keep",
            badge: "Оптимально",
            title: `Ваш тариф «${currentTariff.name}» подходит вам`,
            text: `Средняя скорость за 7 дней комфортна для текущего плана: ${currentTariff.speed} Мбит/с за ${formatBalanceLabel(currentTariff.price)}/мес.`,
            tariff: currentTariff,
        };
    }

    // Рендер-блоки обновляют независимые зоны дашборда без тяжёлых перерисовок всего экрана.
    function renderServiceSwitcher(store) {
        if (!serviceSwitcher || !serviceSwitcherWrap) return;

        const shouldShow = store.services.length > 1;
        serviceSwitcherWrap.hidden = !shouldShow;
        if (!shouldShow) return;

        serviceSwitcher.innerHTML = store.services
            .map((service) => `<option value="${service.id}">${service.accountLabel}</option>`)
            .join("");
        serviceSwitcher.value = store.selectedServiceId;
    }

    function renderHero(service, isDemo) {
        const rawName = firstNameFrom(service.ownerName) || "Мартин";
        setText("mtnHeroTitle", isDemo ? "Добро пожаловать" : `${rawName}, всё главное по вашей связи — на одном экране.`);
        setText(
            "mtnHeroSubtitle",
            isDemo
                ? "Войдите, чтобы увидеть свой баланс, тариф и скорость"
                : "Баланс, тариф, скорость и поддержка — всё под рукой."
        );
        setHidden("mtnHeroLoginWrap", !isDemo);
    }

    function renderQuickActions(isDemo) {
        const links = [
            ["mtnQuickPayments", "/payments"],
            ["mtnQuickTariff", "/tariffs"],
            ["mtnQuickSpeedtest", "/speedtest"],
            ["mtnQuickSupport", "/tickets"],
            ["mtnQuickHistory", "/payments?tab=history"],
            ["mtnBalanceButton", "/payments"],
            ["mtnTariffButton", "/tariffs"],
            ["mtnSpeedButton", "/speedtest"],
            ["mtnSupportButton", "/tickets"],
            ["mtnChargesButton", "/payments?filter=charges"],
            ["mtnDigestButton", "/statistics"],
        ];

        links.forEach(([id, path]) => {
            const node = document.getElementById(id);
            if (node) node.setAttribute("href", isDemo ? `/login?next=${encodeURIComponent(path)}` : resolvePrivateHref(path));
        });
    }

    function renderBalanceSparkline(service) {
        const svg = document.getElementById("mtnBalanceSparkline");
        const detail = document.getElementById("mtnBalancePointDetail");
        if (!svg || !detail) return;

        const history = Array.isArray(service.balanceHistory) ? service.balanceHistory : [];
        if (!history.length) {
            svg.innerHTML = "";
            detail.textContent = "Нет данных о динамике баланса.";
            return;
        }

        const width = 280;
        const height = 72;
        const minBalance = Math.min(...history.map((point) => point.balance));
        const maxBalance = Math.max(...history.map((point) => point.balance));
        const range = Math.max(1, maxBalance - minBalance);
        const step = history.length > 1 ? width / (history.length - 1) : width;

        const points = history.map((point, index) => {
            const x = index * step;
            const y = height - ((point.balance - minBalance) / range) * (height - 8) - 4;
            return { ...point, x, y };
        });

        const pathData = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
        svg.innerHTML = `
            <path d="${pathData}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path>
            ${points
                .map((point, index) => {
                    const color = point.type === "topup" ? "var(--color-success)" : "var(--color-error)";
                    return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" style="fill:${color};" data-point-index="${index}" tabindex="0" role="button" aria-label="${point.date}: ${point.label}, ${point.delta > 0 ? "+" : ""}${point.delta} рублей"></circle>`;
                })
                .join("")}
        `;

        const updateDetail = (point) => {
            detail.textContent = `${point.date} · ${point.label} ${point.delta > 0 ? "+" : ""}${point.delta} ₽`;
        };

        updateDetail(points[0]);
        svg.querySelectorAll("circle").forEach((node) => {
            const point = points[Number(node.getAttribute("data-point-index"))];
            const activate = () => updateDetail(point);
            node.addEventListener("mouseenter", activate);
            node.addEventListener("focus", activate);
            node.addEventListener("click", activate);
            node.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                }
            });
        });
    }

    function renderActionCards(service, isDemo) {
        setText("mtnBalanceValue", formatBalanceLabel(service.balance));
        setText("mtnBalanceMeta", `Лицевой счёт ${service.billingId}`);
        setText("mtnTariffValue", service.tariff.name);
        setText("mtnTariffMeta", `До ${service.tariff.speed} Мбит/с · ${formatBalanceLabel(service.tariff.price)}`);
        setText("mtnSpeedValue", `${Math.round(Number(service.currentSpeed || 0))} Мбит/с`);

        const qualityPercent = computeQualityPercent(service);
        const qualityBar = document.getElementById("mtnSpeedQualityBar");
        const qualityText = document.getElementById("mtnSpeedQualityText");
        const qualityTone = qualityPercent >= 90 ? "var(--color-success)" : qualityPercent >= 70 ? "var(--color-warning)" : "var(--color-error)";
        if (qualityBar) {
            qualityBar.style.width = `${qualityPercent}%`;
            qualityBar.style.background = qualityTone;
        }
        if (qualityText) {
            qualityText.textContent = `Скорость соответствует тарифу на ${qualityPercent}%`;
        }
        setText("mtnSpeedMeta", `Средняя скорость за 7 дней: ${Math.round(Number(service.avgSpeed7d || 0))} Мбит/с`);

        setText("mtnSupportValue", `${service.support.openTickets} открытых`);
        setText(
            "mtnSupportMeta",
            service.support.openTickets > 0 ? "Оператор уже работает по вашему обращению" : "Чат доступен 24/7"
        );
        setHidden("mtnSupportEmpty", service.support.openTickets > 0);

        document.querySelectorAll(".mtn-auth-only").forEach((node) => {
            node.hidden = isDemo;
        });

        renderBalanceSparkline(service);
        return qualityPercent;
    }

    function renderRecommendation(store, service) {
        const recommendation = getRecommendation(service);
        setText("mtnRecommendationTitle", recommendation.title);
        setText("mtnRecommendationBadge", recommendation.badge);
        setText("mtnRecommendationText", recommendation.text);

        if (!recommendationButton) return;
        recommendationButton.disabled = recommendation.type === "keep";
        recommendationButton.textContent = recommendation.type === "keep" ? "Текущий тариф подходит" : "Выбрать";
        recommendationButton.onclick = () => {
            if (recommendation.type === "keep") return;
            const draft = clone(store);
            const selected = getSelectedService(draft);
            selected.tariff = clone(recommendation.tariff);
            selected.currentSpeed = Math.min(selected.currentSpeed, recommendation.tariff.speed);
            saveStore(draft);
            renderDashboard(draft);
            showToast(`Тариф «${recommendation.tariff.name}» выбран в демо-режиме.`);
        };
    }

    function renderCharges(service) {
        const list = document.getElementById("mtnChargesList");
        if (!list) return;

        const charges = Array.isArray(service.charges) ? service.charges : [];
        list.innerHTML = charges
            .map(
                (item) => `
                    <div class="mtn-charge-row">
                        <span class="mtn-charge-row__date">${item.date}</span>
                        <span class="mtn-charge-row__label">${item.label}</span>
                        <strong>${formatBalanceLabel(item.amount)}</strong>
                    </div>
                `
            )
            .join("");

        const total = charges.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        setText("mtnChargesTotal", formatBalanceLabel(total));
    }

    function renderBonus(service) {
        const current = Number(service.bonus?.current || 0);
        const target = Math.max(1, Number(service.bonus?.target || 500));
        const remaining = Math.max(0, target - current);
        const progress = Math.min(100, Math.round((current / target) * 100));
        const options = Array.isArray(service.bonus?.options) ? service.bonus.options : [];

        setText("mtnBonusValue", `${current}`);
        setText("mtnBonusMeta", `До ${target} бонусов осталось ${remaining}.`);
        setText("mtnBonusProgressText", `${progress}% от следующей награды.`);

        const bar = document.getElementById("mtnBonusProgressBar");
        if (bar) bar.style.width = `${progress}%`;

        const optionsList = document.getElementById("mtnBonusOptionsList");
        if (optionsList) {
            optionsList.innerHTML = options
                .map(
                    (option) => `
                        <article class="mtn-bonus-option">
                            <strong>${option.title}</strong>
                            <span>${option.description}</span>
                        </article>
                    `
                )
                .join("");
        }
    }

    function renderAlerts(service, qualityPercent, isDemo) {
        const stack = document.getElementById("mtnAlertStack");
        if (!stack) return;

        const alerts = [];
        if (service.debt > 500) {
            alerts.push({
                tone: "danger",
                text: `У вас задолженность ${formatBalanceLabel(service.debt)}. Пополните баланс, чтобы избежать блокировки.`,
                href: resolvePrivateHref("/payments"),
                action: "Пополнить",
            });
        }
        if (qualityPercent < 70) {
            alerts.push({
                tone: "warning",
                text: "Ваша скорость ниже тарифа. Запустите speedtest или создайте заявку.",
                href: resolvePrivateHref("/speedtest"),
                action: "Проверить",
            });
        }
        if (service.support.openTickets > 0 && service.support.oldestOpenDays > 3 && service.support.ticketId) {
            alerts.push({
                tone: "info",
                text: `У вас есть открытая заявка №${service.support.ticketId}. Оператор ожидает ответа.`,
                href: resolvePrivateHref("/tickets"),
                action: "Открыть",
            });
        }

        stack.hidden = alerts.length === 0;
        stack.innerHTML = alerts
            .map(
                (alert) => `
                    <article class="mtn-alert mtn-alert--${alert.tone}">
                        <div>${alert.text}</div>
                        <div class="mtn-alert__actions">
                            <a class="mtn-button mtn-button--ghost" href="${alert.href}">${alert.action}</a>
                            ${isDemo ? '<span class="mtn-widget-card__subtext">Демо-режим</span>' : ""}
                        </div>
                    </article>
                `
            )
            .join("");
    }

    function renderMetrics(service) {
        setText("mtnAvailabilityValue", service.metrics.availability);
        setText("mtnAvailabilityMeta", `${service.metrics.availabilityEvents} событий за 24 часа`);
        setText("mtnResponseValue", service.metrics.responseTime);
        setText("mtnResponseMeta", "Поддержка MTN");
        setText("mtnHomesValue", service.metrics.homes);
        setText("mtnHomesMeta", "Жилых объектов");
    }

    function renderDigest(service) {
        setText("mtnDigestCaption", service.digest.monthLabel);
        setText("mtnDigestSpend", formatBalanceLabel(service.digest.spend));
        setText("mtnDigestTraffic", service.digest.traffic);
        setText("mtnDigestTickets", `${service.digest.ticketsTotal}`);
        setText("mtnDigestTicketsMeta", `${service.digest.ticketsOpen} открыта, ${service.digest.ticketsResolved} решена`);
    }

    function openBonusModal() {
        if (!bonusModal) return;
        bonusModal.hidden = false;
        document.body.style.overflow = "hidden";
        bonusModalClose?.focus();
    }

    function closeBonusModal() {
        if (!bonusModal) return;
        bonusModal.hidden = true;
        document.body.style.overflow = "";
    }

    function applyMode(mode) {
        setViewState(mode);
        setFooterDemoBadge(mode === "demo");
    }

    function renderDashboard(store, modeOverride) {
        const selectedService = getSelectedService(store);
        const sessionAuthenticated = body.dataset.authenticated === "true" || Boolean(window.OperatorUI?.isAuthenticated?.());
        const isDemo = modeOverride === "demo" || (!sessionAuthenticated && modeOverride !== "authenticated");

        applyMode(modeOverride || (isDemo ? "demo" : "authenticated"));
        renderServiceSwitcher(store);
        renderHero(selectedService, isDemo);
        renderQuickActions(isDemo);
        const qualityPercent = renderActionCards(selectedService, isDemo);
        renderRecommendation(store, selectedService);
        renderCharges(selectedService);
        renderBonus(selectedService);
        renderAlerts(selectedService, qualityPercent, isDemo);
        renderMetrics(selectedService);
        renderDigest(selectedService);
    }

    // Если пользователь авторизован, подмешиваем живые данные API в основную интернет-услугу.
    async function syncAuthenticatedService(store) {
        const api = window.OperatorUI;
        const isAuthenticated = body.dataset.authenticated === "true" || Boolean(api?.isAuthenticated?.());
        if (!api || !isAuthenticated) return store;

        const responses = await Promise.allSettled([
            api.request("/api/v1/users/me", { auth: true }),
            api.request("/api/v1/billing/balance", { auth: true }),
            api.request("/api/v1/billing/tariff", { auth: true }),
            api.request("/api/v1/speedtest/stats", { auth: true }),
            api.request("/api/v1/tickets/?page=1&page_size=10", { auth: true }),
            api.request("/api/v1/monitoring/summary", { auth: true }),
        ]);

        const [user, balance, tariff, speed, tickets, monitoring] = responses;
        const nextStore = clone(store);
        const service = nextStore.services.find((item) => item.id === PRIMARY_SERVICE_ID);
        if (!service) return nextStore;

        if (user.status === "fulfilled") {
            service.ownerName = user.value?.first_name || firstNameFrom(user.value?.full_name) || service.ownerName;
            service.billingId = user.value?.billing_id || service.billingId;
        }
        if (balance.status === "fulfilled") {
            service.balance = Number(balance.value?.balance ?? service.balance);
            service.debt = Math.max(0, Number(balance.value?.debt ?? service.debt));
        }
        if (tariff.status === "fulfilled") {
            service.tariff = {
                name: tariff.value?.name || service.tariff.name,
                speed: Number(tariff.value?.speed_mbps || tariff.value?.speed || service.tariff.speed),
                price: Number(tariff.value?.price || service.tariff.price),
            };
        }
        if (speed.status === "fulfilled") {
            service.currentSpeed = Number(speed.value?.last_download || speed.value?.avg_download || service.currentSpeed);
            service.avgSpeed7d = Number(speed.value?.avg_download || service.avgSpeed7d);
        }
        if (tickets.status === "fulfilled") {
            const items = Array.isArray(tickets.value?.items) ? tickets.value.items : [];
            const openItems = items.filter((item) => OPEN_TICKET_STATUSES.has(String(item.status || "")));
            service.support.openTickets = openItems.length;
            service.support.ticketId = openItems[0]?.id || null;
            service.support.oldestOpenDays = openItems[0]?.created_at
                ? Math.max(0, Math.round((Date.now() - new Date(openItems[0].created_at).getTime()) / 86400000))
                : 0;
        }
        if (monitoring.status === "fulfilled") {
            const qualityScore = Number(monitoring.value?.quality_score || 95);
            service.metrics.availability = `${Math.min(99.9, Math.max(97.2, 96 + qualityScore / 25)).toFixed(1)}%`;
            service.metrics.availabilityEvents = Number(monitoring.value?.alerts_last_24h || 0);
        }

        saveStore(nextStore);
        if (responses.some((item) => item.status === "rejected")) {
            showToast("Часть данных не успела загрузиться. Показаны доступные значения.");
        } else {
            hideToast();
        }

        return nextStore;
    }

    function applyForcedState(state, store) {
        if (state === "loading") {
            setFooterDemoBadge(false);
            setViewState("loading");
            return true;
        }

        if (state === "demo") {
            renderDashboard(store, "demo");
            return true;
        }

        if (state === "error") {
            renderDashboard(store, "demo");
            showToast("Не удалось загрузить данные. Попробуйте позже.");
            return true;
        }

        if (state === "empty") {
            const draft = clone(store);
            const emptyMode =
                body.dataset.authenticated === "true" || Boolean(window.OperatorUI?.isAuthenticated?.()) ? "authenticated" : "demo";
            draft.services.forEach((service) => {
                service.support.openTickets = 0;
                service.support.ticketId = null;
                service.support.oldestOpenDays = 0;
            });
            renderDashboard(draft, emptyMode);
            return true;
        }

        return false;
    }

    function applyStaggerDelays() {
        document.querySelectorAll("[data-stagger-item]").forEach((node, index) => {
            node.style.setProperty("--stagger-delay", `${index * 50}ms`);
        });
    }

    // Bootstrap сводит вместе forced state, localStorage и сетевую синхронизацию.
    async function bootstrap() {
        applyStaggerDelays();
        setViewState("loading");

        let store = ensureStore();
        const forcedState = new URLSearchParams(window.location.search).get("state");
        if (forcedState && applyForcedState(forcedState, store)) {
            registerRetry(() => bootstrap());
            return;
        }

        try {
            store = await syncAuthenticatedService(store);
        } catch (error) {
            console.error("Failed to sync MTN dashboard", error);
            showToast("Не удалось загрузить данные. Попробуйте позже.");
        }

        renderDashboard(store);
        registerRetry(() => bootstrap());
    }

    if (serviceSwitcher) {
        serviceSwitcher.addEventListener("change", (event) => {
            const store = ensureStore();
            store.selectedServiceId = event.target.value;
            saveStore(store);
            renderDashboard(store);
        });
    }

    if (bonusButton) {
        bonusButton.addEventListener("click", openBonusModal);
    }

    bonusModalClose?.addEventListener("click", closeBonusModal);
    bonusModal?.querySelector("[data-mtn-modal-close]")?.addEventListener("click", closeBonusModal);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeBonusModal();
    });

    toastRetry?.addEventListener("click", () => {
        retryHandlers.forEach((handler) => handler());
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap);
    } else {
        bootstrap();
    }
})();
