(function () {
    const PAGE_CLASS = "tariffs-page-v3";
    if (!document.body.classList.contains(PAGE_CLASS)) return;

    const config = window.MTNTariffsPageConfig || {};
    const ui = window.OperatorUI || {};
    const STORAGE_KEYS = {
        view: "mtn.tariffs.view.v4",
        filter: "mtn.tariffs.filter.v4",
        compare: "mtn.tariffs.compare.v4",
    };

    const CATEGORY_LABELS = {
        all: "Все",
        home: "Для дома",
        work: "Для работы",
        business: "Для бизнеса",
    };

    const SMART_USAGE_DEMO = {
        average: 250,
        peak: 400,
        hasData: true,
    };

    const CATALOG_META = {
        "DEMO-100": {
            id: 1,
            category: "home",
            category_label: CATEGORY_LABELS.home,
            display_name: "Старт 100",
            router_label: "За 1 ₽",
            tv_label: "—",
            support_label: "Обычная",
            traffic_label: "Безлимит",
            description: "Базовый тариф для квартиры: стабильный интернет, мессенджеры и видео без скрытых условий.",
            features: ["Безлимитный трафик", "Роутер за 1 ₽", "Круглосуточная поддержка"],
        },
        "DEMO-300": {
            id: 2,
            category: "home",
            category_label: CATEGORY_LABELS.home,
            display_name: "Город 300",
            router_label: "В подарок",
            tv_label: "50 каналов",
            support_label: "Обычная",
            traffic_label: "Безлимит",
            description: "Сбалансированный тариф для семей, 4K-стриминга и работы из дома.",
            features: ["Безлимитный трафик", "Роутер в подарок", "ТВ 50 каналов"],
            is_choice_month: true,
        },
        "DEMO-500": {
            id: 3,
            category: "work",
            category_label: CATEGORY_LABELS.work,
            display_name: "Смена 500",
            router_label: "В подарок",
            tv_label: "—",
            support_label: "Приоритетная",
            traffic_label: "Безлимит",
            description: "Тариф для удалённой работы, видеозвонков, облаков и стабильной профессиональной нагрузки.",
            features: ["Безлимитный трафик", "Статический IP", "Приоритетный трафик"],
            is_best_value: true,
        },
        "DEMO-700-TV": {
            id: 4,
            category: "home",
            category_label: CATEGORY_LABELS.home,
            display_name: "Семья 700 + ТВ",
            router_label: "В подарок",
            tv_label: "150 каналов",
            support_label: "Приоритетная",
            traffic_label: "Безлимит",
            description: "Для насыщенного цифрового дома: интернет, ТВ, стриминг, камеры и десятки устройств одновременно.",
            features: ["Безлимитный трафик", "ТВ 150 каналов", "Онлайн-кинотеатр"],
        },
        "DEMO-800-WORK": {
            id: 7,
            category: "work",
            category_label: CATEGORY_LABELS.work,
            display_name: "Удалённый PRO",
            router_label: "В подарок",
            tv_label: "—",
            support_label: "Приоритетная",
            traffic_label: "Безлимит",
            description: "Для тех, кто работает из дома и зависит от upload-скорости, VPN и постоянной синхронизации.",
            features: ["Безлимитный трафик", "VPN и стабильный upload", "Диагностика линии MTN"],
        },
        "DEMO-BIZ-1500": {
            id: 8,
            category: "business",
            category_label: CATEGORY_LABELS.business,
            display_name: "Бизнес Канал 1500",
            router_label: "В подарок",
            tv_label: "200 каналов",
            support_label: "SLA 24/7",
            traffic_label: "Безлимит",
            description: "Корпоративный план с резервированием, понятным SLA и приоритетной поддержкой 24/7.",
            features: ["Безлимитный трафик", "Статический IP", "SLA 24/7"],
        },
    };

    const DISPLAY_ORDER = [
        "DEMO-100",
        "DEMO-300",
        "DEMO-500",
        "DEMO-700-TV",
        "DEMO-800-WORK",
        "DEMO-BIZ-1500",
    ];

    const state = {
        authenticated: Boolean(config.authenticated),
        loading: true,
        error: false,
        filter: window.localStorage.getItem(STORAGE_KEYS.filter) || "all",
        view: window.localStorage.getItem(STORAGE_KEYS.view) || "cards",
        tariffs: [],
        currentTariffBillingId: "",
        currentTariffData: null,
        balance: null,
        debtAmount: 0,
        selectedTariff: null,
        effectiveFrom: "next_month",
        recommendation: null,
        usageStats: { average: 0, peak: 0, hasData: false },
        compareIds: (() => {
            try {
                const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.compare) || "[]");
                return Array.isArray(stored) ? stored.slice(0, 3) : [];
            } catch (error) {
                return [];
            }
        })(),
        highlightedTariffId: null,
    };

    const qs = (selector, root = document) => root.querySelector(selector);
    const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const canRequest = typeof ui.request === "function";
    const escapeHTML = (value) => (typeof ui.escapeHTML === "function"
        ? ui.escapeHTML(value)
        : String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;"));
    const formatCurrency = (value) => (typeof ui.formatCurrency === "function"
        ? ui.formatCurrency(value)
        : new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            maximumFractionDigits: 0,
        }).format(Number(value || 0)));
    const notify = (message, type = "info", title = "MTN") => {
        if (typeof ui.toast === "function") {
            ui.toast(message, type, title);
        } else {
            console[type === "error" ? "error" : "log"](message);
        }
    };

    function isDesktop() {
        return window.matchMedia("(min-width: 1024px)").matches;
    }

    function normalizeView(view) {
        return isDesktop() ? view : "cards";
    }

    function inferCategory(item) {
        const billingId = String(item?.billing_tariff_id || item?.tariff_id || "").toUpperCase();
        const name = String(item?.name || "").toLowerCase();
        if (billingId.includes("BIZ") || name.includes("бизнес")) return "business";
        if (billingId.includes("WORK") || billingId.includes("500") || name.includes("работ") || name.includes("офис")) return "work";
        return "home";
    }

    function persistCompare() {
        window.localStorage.setItem(STORAGE_KEYS.compare, JSON.stringify(state.compareIds));
    }

    function buildTariffRecord(raw) {
        const billingId = String(raw?.billing_tariff_id || raw?.tariff_id || "");
        const meta = CATALOG_META[billingId] || {};
        const category = meta.category || inferCategory(raw);
        const features = Array.isArray(raw?.features) && raw.features.length
            ? raw.features.map(String)
            : Array.isArray(meta.features)
                ? meta.features.slice()
                : ["Безлимитный трафик", "Круглосуточная поддержка"];

        return {
            id: Number(raw?.id || meta.id || 0),
            billing_tariff_id: billingId,
            name: meta.display_name || raw?.name || "Тариф MTN",
            category,
            category_label: meta.category_label || CATEGORY_LABELS[category] || CATEGORY_LABELS.home,
            price: Number(raw?.price || 0),
            speed_mbps: Number(raw?.speed_mbps || raw?.speed || 0),
            upload_speed_mbps: Number(raw?.upload_speed_mbps || 0),
            description: meta.description || raw?.description || "Надёжный тариф без скрытых условий.",
            features,
            router_label: meta.router_label || "В подарок",
            tv_label: meta.tv_label || "—",
            support_label: meta.support_label || "Обычная",
            traffic_label: raw?.is_unlimited === false && raw?.traffic_limit_gb
                ? `${raw.traffic_limit_gb} ГБ`
                : (meta.traffic_label || "Безлимит"),
            is_choice_month: Boolean(meta.is_choice_month),
            is_best_value: Boolean(meta.is_best_value),
            contract_term_months: Number(raw?.contract_term_months || 0),
        };
    }

    function buildCatalog(apiTariffs) {
        const apiMap = new Map((apiTariffs || []).map((item) => [String(item.billing_tariff_id || item.tariff_id || ""), item]));
        return DISPLAY_ORDER
            .map((billingId) => buildTariffRecord(apiMap.get(billingId) || { billing_tariff_id: billingId, ...CATALOG_META[billingId] }))
            .filter((item) => item.id > 0 || item.billing_tariff_id)
            .sort((left, right) => Number(left.price || 0) - Number(right.price || 0));
    }

    function filteredTariffs() {
        if (state.filter === "all") return state.tariffs;
        return state.tariffs.filter((item) => item.category === state.filter);
    }

    function getCurrentTariffRecord() {
        const inCatalog = state.tariffs.find((item) => String(item.billing_tariff_id) === String(state.currentTariffBillingId));
        if (inCatalog) return inCatalog;
        if (state.currentTariffData) return buildTariffRecord(state.currentTariffData);
        return null;
    }

    function getTariffById(tariffId) {
        return state.tariffs.find((item) => Number(item.id) === Number(tariffId)) || null;
    }

    function getCompareTariffs() {
        return state.compareIds.map((id) => getTariffById(id)).filter(Boolean);
    }

    function getTodayFee(tariff) {
        return Math.round(Number(tariff?.price || 0) / 2);
    }

    function getSavingsText(tariff) {
        const current = getCurrentTariffRecord();
        if (!current || String(current.billing_tariff_id) === String(tariff.billing_tariff_id)) return "";

        const deltaPrice = Number(tariff.price || 0) - Number(current.price || 0);
        const deltaSpeed = Number(tariff.speed_mbps || 0) - Number(current.speed_mbps || 0);

        if (deltaPrice > 0 && deltaSpeed > 0) {
            return `Всего +${formatCurrency(deltaPrice).replace(/\s?₽/, " ₽")} за +${deltaSpeed} Мбит/с`;
        }
        if (deltaPrice < 0 && deltaSpeed >= 0) {
            return `Экономия ${formatCurrency(Math.abs(deltaPrice)).replace(/\s?₽/, " ₽")}/мес без потери скорости`;
        }
        if (deltaPrice < 0) {
            return `Экономия ${formatCurrency(Math.abs(deltaPrice)).replace(/\s?₽/, " ₽")}/мес`;
        }
        if (deltaPrice > 0) {
            return `Доплата ${formatCurrency(deltaPrice).replace(/\s?₽/, " ₽")}/мес`;
        }
        return "По цене совпадает с текущим тарифом";
    }

    function computeRecommendation() {
        if (!state.usageStats.hasData || !state.tariffs.length) {
            state.recommendation = null;
            return;
        }

        const targetSpeed = Math.max(
            Math.ceil(state.usageStats.average * 1.15),
            Math.ceil(state.usageStats.peak * 0.75)
        );

        state.recommendation =
            state.tariffs.find((item) => item.speed_mbps >= targetSpeed && item.category !== "business")
            || state.tariffs.find((item) => item.speed_mbps >= state.usageStats.average)
            || state.tariffs[state.tariffs.length - 1]
            || null;
    }

    function highlightTariff(tariffId) {
        state.highlightedTariffId = Number(tariffId);
        renderView();
        window.setTimeout(() => {
            const card = qs(`[data-tariff-card="${tariffId}"]`);
            if (card) {
                card.scrollIntoView({ behavior: "smooth", block: "center" });
                card.classList.add("is-highlighted");
                window.setTimeout(() => card.classList.remove("is-highlighted"), 2400);
            }

            const row = qs(`[data-tariff-row="${tariffId}"]`);
            if (row) {
                row.scrollIntoView({ behavior: "smooth", block: "center" });
                row.classList.add("is-highlighted");
                window.setTimeout(() => row.classList.remove("is-highlighted"), 2400);
            }

            window.setTimeout(() => {
                if (state.highlightedTariffId === Number(tariffId)) {
                    state.highlightedTariffId = null;
                }
            }, 2450);
        }, 30);
    }

    function openModal(modalId) {
        const modal = qs(`#${modalId}`);
        if (!modal) return;
        modal.hidden = false;
        modal.classList.add("is-open");
        document.body.classList.add("modal-open");
    }

    function closeModal(modalId) {
        const modal = qs(`#${modalId}`);
        if (!modal) return;
        modal.classList.remove("is-open");
        document.body.classList.remove("modal-open");
        window.setTimeout(() => {
            if (!modal.classList.contains("is-open")) {
                modal.hidden = true;
            }
        }, 180);
    }

    function setFooterState() {
        const badge = document.getElementById("footerDemoBadge");
        if (badge) badge.hidden = true;
    }

    function setLoadingSkeletons() {
        const grid = qs("#tariffsCardsGrid");
        if (!grid) return;
        grid.innerHTML = Array.from({ length: 6 }, () => '<article class="tariff-card-v3 skeleton-card-v3" aria-hidden="true"></article>').join("");
    }

    function setPageState(loading, error) {
        state.loading = loading;
        state.error = error;

        const panel = qs("#currentTariffPanel");
        const errorBox = qs("#tariffsStatusError");
        if (panel) panel.classList.toggle("is-loading", loading);
        if (errorBox) errorBox.hidden = !error;
        if (loading) setLoadingSkeletons();
    }

    function renderCurrentTariffPanel() {
        const nameNode = qs("#currentTariffName");
        const metaNode = qs("#currentTariffMeta");
        const priceNode = qs("#currentTariffPrice");
        const actionButton = qs("#currentTariffAction");
        const panel = qs("#currentTariffPanel");
        if (!nameNode || !metaNode || !priceNode || !actionButton || !panel) return;

        panel.classList.toggle("is-loading", state.loading);
        actionButton.disabled = true;
        actionButton.textContent = "Оставить тариф";

        if (state.loading) {
            nameNode.textContent = "Загружаем тариф...";
            metaNode.textContent = "Проверяем скорость и параметры текущего плана.";
            priceNode.textContent = "—";
            return;
        }

        if (!state.authenticated) {
            nameNode.textContent = "Войдите, чтобы увидеть свой тариф";
            metaNode.textContent = "После авторизации здесь появятся активный тариф, скорость и стоимость.";
            priceNode.textContent = "—";
            return;
        }

        const tariff = getCurrentTariffRecord();
        if (!tariff) {
            nameNode.textContent = "Текущий тариф не определён";
            metaNode.textContent = "Не удалось получить данные биллинга. Попробуйте обновить страницу позже.";
            priceNode.textContent = "—";
            return;
        }

        nameNode.textContent = tariff.name;
        metaNode.textContent = `До ${tariff.speed_mbps} Мбит/с · ${tariff.category_label}`;
        priceNode.textContent = `${formatCurrency(tariff.price)} / мес`;
    }

    function renderRecommendation() {
        const titleNode = qs("#tariffsRecommendationTitle");
        const textNode = qs("#tariffsRecommendationText");
        const averageNode = qs("#tariffsRecommendationAverage");
        const peakNode = qs("#tariffsRecommendationPeak");
        const actionButton = qs("#tariffsRecommendationAction");
        if (!titleNode || !textNode || !averageNode || !peakNode || !actionButton) return;

        if (!state.authenticated || !state.usageStats.hasData || !state.recommendation) {
            titleNode.textContent = "Подключите speedtest, чтобы получить персональную рекомендацию";
            textNode.textContent = "Когда появятся данные о скорости и пиковых нагрузках, мы подскажем оптимальный тариф автоматически.";
            averageNode.textContent = "—";
            peakNode.textContent = "—";
            actionButton.textContent = state.authenticated ? "Запустить speedtest" : "Войти";
            actionButton.dataset.mode = state.authenticated ? "speedtest" : "login";
            actionButton.dataset.tariffId = "";
            return;
        }

        titleNode.textContent = `Оптимальный тариф: ${state.recommendation.name}`;
        textNode.textContent = `По вашей статистике за последние 30 дней вам подходит тариф «${state.recommendation.name}». Вы используете около ${state.usageStats.average} Мбит/с в пиковые часы до ${state.usageStats.peak} Мбит/с.`;
        averageNode.textContent = `${state.usageStats.average} Мбит/с`;
        peakNode.textContent = `${state.usageStats.peak} Мбит/с`;
        actionButton.textContent = "Выбрать этот тариф";
        actionButton.dataset.mode = "select";
        actionButton.dataset.tariffId = String(state.recommendation.id);
    }

    function renderCompareBar() {
        const bar = qs("#tariffCompareBar");
        const list = qs("#tariffCompareList");
        const count = qs("#tariffCompareCount");
        if (!bar || !list || !count) return;

        const items = getCompareTariffs();
        if (!items.length) {
            bar.hidden = true;
            list.innerHTML = "";
            count.textContent = "Выбрано 0 из 3";
            return;
        }

        bar.hidden = false;
        count.textContent = `Выбрано ${items.length} из 3`;
        list.innerHTML = items.map((tariff) => `
            <article class="tariffs-compare-item-v3">
                <button class="tariffs-compare-item-v3__remove" type="button" data-compare-remove="${tariff.id}" aria-label="Убрать ${escapeHTML(tariff.name)} из сравнения">
                    <i class="fas fa-xmark"></i>
                </button>
                <strong>${escapeHTML(tariff.name)}</strong>
                <span>${formatCurrency(tariff.price)} · До ${escapeHTML(String(tariff.speed_mbps))} Мбит/с</span>
                <button class="btn btn-primary btn-sm" type="button" data-tariff-select="${tariff.id}">Выбрать</button>
            </article>
        `).join("");
    }

    function getBadgeMarkup(tariff) {
        const badges = [];
        if (tariff.is_choice_month) {
            badges.push('<span class="tariff-card-v3__floating-badge is-gold"><i class="fas fa-star"></i>Выбор месяца</span>');
        }
        if (tariff.is_best_value) {
            badges.push('<span class="tariff-card-v3__floating-badge is-green"><i class="fas fa-bolt"></i>Лучшая цена за Мбит</span>');
        }
        return badges.join("");
    }

    function getCompareMarkup(tariff) {
        const checked = state.compareIds.includes(tariff.id);
        return `
            <label class="tariff-card-v3__compare">
                <input type="checkbox" data-compare-toggle="${tariff.id}" ${checked ? "checked" : ""}>
                <span>Сравнить</span>
            </label>
        `;
    }

    function renderCards() {
        const grid = qs("#tariffsCardsGrid");
        const emptyState = qs("#tariffsEmptyState");
        if (!grid || state.loading || state.error) return;

        const items = filteredTariffs();
        if (!items.length) {
            grid.innerHTML = "";
            if (emptyState) emptyState.hidden = false;
            return;
        }

        if (emptyState) emptyState.hidden = true;
        grid.innerHTML = items.map((tariff) => {
            const isCurrent = String(tariff.billing_tariff_id) === String(state.currentTariffBillingId);
            const savings = getSavingsText(tariff);
            const actionLabel = isCurrent ? "Ваш тариф" : state.authenticated ? "Выбрать" : "Войти";
            const actionAttrs = isCurrent
                ? 'disabled aria-disabled="true"'
                : `data-tariff-select="${tariff.id}" title="Смена тарифа бесплатна, новый тариф начнёт действовать с 1 числа"`;
            const actionClass = isCurrent ? "btn btn-secondary tariff-card-v3__action is-disabled" : "btn btn-primary tariff-card-v3__action";
            return `
                <article class="tariff-card-v3 ${isCurrent ? "is-current" : ""} ${state.highlightedTariffId === tariff.id ? "is-targeted" : ""}" data-tariff-card="${tariff.id}">
                    <div class="tariff-card-v3__floating">${getBadgeMarkup(tariff)}</div>
                    <div class="tariff-card-v3__topline">
                        <div class="tariff-card-v3__title-wrap">
                            <h2 class="tariff-card-v3__title">${escapeHTML(tariff.name)}</h2>
                            <span class="tariff-card-v3__badge">${escapeHTML(tariff.category_label)}</span>
                        </div>
                        ${getCompareMarkup(tariff)}
                    </div>

                    <div class="tariff-card-v3__price-wrap" title="Абонентская плата списывается ежемесячно 1 числа">
                        <div class="tariff-card-v3__price">${formatCurrency(tariff.price)}</div>
                        <div class="tariff-card-v3__period">в месяц</div>
                    </div>

                    <div class="tariff-card-v3__speed" title="Максимальная скорость входящего соединения">
                        <i class="fas fa-bolt"></i>
                        <span>До ${escapeHTML(String(tariff.speed_mbps))} Мбит/с</span>
                    </div>

                    ${savings ? `<p class="tariff-card-v3__delta">${escapeHTML(savings)}</p>` : ""}
                    <p class="tariff-card-v3__description">${escapeHTML(tariff.description)}</p>

                    <ul class="tariff-card-v3__features">
                        ${tariff.features.slice(0, 3).map((feature) => `
                            <li>
                                <i class="fas fa-check"></i>
                                <span>${escapeHTML(String(feature))}</span>
                            </li>
                        `).join("")}
                    </ul>

                    <button class="${actionClass}" type="button" ${actionAttrs}>
                        ${actionLabel}
                    </button>
                </article>
            `;
        }).join("");
    }

    function renderTable() {
        const tableBody = qs("#tariffsTableBody");
        if (!tableBody || state.loading || state.error) return;

        const items = filteredTariffs();
        tableBody.innerHTML = items.map((tariff) => {
            const isCurrent = String(tariff.billing_tariff_id) === String(state.currentTariffBillingId);
            const action = isCurrent
                ? '<button class="btn btn-secondary btn-sm is-disabled" type="button" disabled>Ваш тариф</button>'
                : `<button class="btn btn-primary btn-sm" type="button" data-tariff-select="${tariff.id}" title="Смена тарифа бесплатна, новый тариф начнёт действовать с 1 числа">${state.authenticated ? "Выбрать" : "Войти"}</button>`;
            return `
                <tr class="${isCurrent ? "is-current" : ""} ${state.highlightedTariffId === tariff.id ? "is-highlighted" : ""}" data-tariff-row="${tariff.id}">
                    <td>
                        <strong>${escapeHTML(tariff.name)}</strong>
                        <div class="tariffs-table-v3__sub">${escapeHTML(tariff.category_label)}</div>
                    </td>
                    <td title="Максимальная скорость входящего соединения">${escapeHTML(String(tariff.speed_mbps))} Мбит/с</td>
                    <td title="Абонентская плата списывается ежемесячно 1 числа">${formatCurrency(tariff.price)}</td>
                    <td>${escapeHTML(tariff.traffic_label)}</td>
                    <td>${escapeHTML(tariff.router_label)}</td>
                    <td>${escapeHTML(tariff.tv_label)}</td>
                    <td>${escapeHTML(tariff.support_label)}</td>
                    <td>${action}</td>
                </tr>
            `;
        }).join("");
    }

    function renderView() {
        const cardsView = qs("#tariffsCardsView");
        const tableView = qs("#tariffsTableView");
        const emptyState = qs("#tariffsEmptyState");
        const normalizedView = normalizeView(state.view);

        qsa(".tariffs-view-switch-v3__button").forEach((button) => {
            const active = button.dataset.view === normalizedView;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });

        if (state.error) {
            if (cardsView) cardsView.hidden = true;
            if (tableView) tableView.hidden = true;
            if (emptyState) emptyState.hidden = true;
            return;
        }

        if (cardsView) cardsView.hidden = normalizedView !== "cards";
        if (tableView) tableView.hidden = normalizedView !== "table";

        renderCards();
        renderTable();
        renderCompareBar();
    }

    function renderFilters() {
        qsa(".tariffs-filter-v3").forEach((button) => {
            const active = button.dataset.filter === state.filter;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        renderView();
    }

    function renderEffectiveFromChoice() {
        const hint = qs("#tariffModalEffectiveHint");
        const todayFee = qs("#tariffModalTodayFee");
        const tariff = state.selectedTariff;
        if (!hint || !todayFee || !tariff) return;

        const fee = getTodayFee(tariff);
        todayFee.textContent = `Доплата ${formatCurrency(fee)}`;

        if (state.effectiveFrom === "today") {
            hint.textContent = `Тариф подключится сегодня. Разовая доплата составит ${formatCurrency(fee)}.`;
        } else {
            hint.textContent = "Новый тариф начнёт действовать с 1 числа следующего месяца без доплаты.";
        }
    }

    function fillChangeModal(tariff) {
        const categoryNode = qs("#tariffModalCategory");
        const nameNode = qs("#tariffModalName");
        const priceNode = qs("#tariffModalPrice");
        const speedNode = qs("#tariffModalSpeed");
        const featuresNode = qs("#tariffModalFeatures");
        const titleNode = qs("#tariffChangeTitle");
        const debtNotice = qs("#tariffModalDebtNotice");
        const debtText = qs("#tariffModalDebtText");
        const readyNotice = qs("#tariffModalReadyNotice");
        const payButton = qs("#tariffModalPayButton");
        const confirmButton = qs("#tariffModalConfirm");

        if (!categoryNode || !nameNode || !priceNode || !speedNode || !featuresNode || !titleNode || !debtNotice || !debtText || !readyNotice || !payButton || !confirmButton) {
            return;
        }

        titleNode.textContent = `Сменить тариф на ${tariff.name}?`;
        categoryNode.textContent = tariff.category_label;
        nameNode.textContent = tariff.name;
        priceNode.textContent = `${formatCurrency(tariff.price)} / мес`;
        speedNode.textContent = `До ${tariff.speed_mbps} Мбит/с`;
        featuresNode.innerHTML = tariff.features.slice(0, 3).map((feature) => `<li>${escapeHTML(String(feature))}</li>`).join("");

        qsa('input[name="tariffEffectiveFrom"]').forEach((input) => {
            input.checked = input.value === state.effectiveFrom;
        });
        renderEffectiveFromChoice();

        if (state.debtAmount > 0) {
            debtText.textContent = `У вас есть задолженность ${formatCurrency(state.debtAmount)}. Пожалуйста, пополните баланс перед сменой тарифа.`;
            debtNotice.hidden = false;
            readyNotice.hidden = true;
            payButton.hidden = false;
            confirmButton.hidden = true;
        } else {
            debtNotice.hidden = true;
            readyNotice.hidden = false;
            payButton.hidden = true;
            confirmButton.hidden = false;
            confirmButton.disabled = false;
        }
    }

    function openChangeModal(tariffId) {
        const tariff = getTariffById(tariffId);
        if (!tariff) return;
        if (!state.authenticated) {
            window.location.href = "/login?next=/tariffs";
            return;
        }
        if (String(tariff.billing_tariff_id) === String(state.currentTariffBillingId)) {
            highlightTariff(tariff.id);
            notify("Этот тариф уже подключён у вас сейчас.", "info", "MTN");
            return;
        }

        state.selectedTariff = tariff;
        state.effectiveFrom = "next_month";
        fillChangeModal(tariff);
        openModal("tariffChangeModal");
    }

    async function confirmChange() {
        if (!state.selectedTariff || state.debtAmount > 0 || !canRequest) return;

        const confirmButton = qs("#tariffModalConfirm");
        if (confirmButton) confirmButton.disabled = true;

        try {
            const response = await ui.request("/api/v1/tariffs/change", {
                method: "POST",
                auth: true,
                json: true,
                body: {
                    tariff_id: state.selectedTariff.id,
                    effective_from: state.effectiveFrom,
                },
            });

            if (state.effectiveFrom === "today" && typeof state.balance === "number") {
                state.balance = Math.max(state.balance - getTodayFee(state.selectedTariff), 0);
            }

            state.currentTariffBillingId = String(state.selectedTariff.billing_tariff_id);
            state.currentTariffData = { ...state.selectedTariff };
            renderCurrentTariffPanel();
            renderFilters();
            closeModal("tariffChangeModal");

            const effectiveMessage = state.effectiveFrom === "today"
                ? "Тариф подключится сегодня."
                : "Новый тариф начнёт действовать с 1 числа.";
            notify(response?.message || `Заявка на смену тарифа принята. ${effectiveMessage}`, "success", "MTN");
        } catch (error) {
            const detail = error?.message || "Не удалось сменить тариф. Попробуйте позже или обратитесь в поддержку.";
            notify(detail, "error", "MTN");
        } finally {
            if (confirmButton) confirmButton.disabled = false;
        }
    }

    function handleRecommendationAction() {
        const actionButton = qs("#tariffsRecommendationAction");
        if (!actionButton) return;
        const mode = actionButton.dataset.mode;

        if (mode === "speedtest") {
            window.location.href = "/speedtest";
            return;
        }

        if (mode === "login") {
            window.location.href = "/login?next=/tariffs";
            return;
        }

        const tariffId = Number(actionButton.dataset.tariffId || 0);
        if (!tariffId) return;
        highlightTariff(tariffId);
        window.setTimeout(() => openChangeModal(tariffId), 260);
    }

    function toggleCompare(tariffId, checked) {
        const numericId = Number(tariffId);
        if (!numericId) return;

        if (checked) {
            if (state.compareIds.includes(numericId)) return;
            if (state.compareIds.length >= 3) {
                const checkbox = qs(`[data-compare-toggle="${numericId}"]`);
                if (checkbox) checkbox.checked = false;
                notify("Нельзя сравнить больше 3 тарифов.", "warning", "MTN");
                return;
            }
            state.compareIds.push(numericId);
        } else {
            state.compareIds = state.compareIds.filter((id) => id !== numericId);
        }

        persistCompare();
        renderCompareBar();
    }

    function clearCompare() {
        state.compareIds = [];
        persistCompare();
        qsa("[data-compare-toggle]").forEach((checkbox) => {
            checkbox.checked = false;
        });
        renderCompareBar();
    }

    function openAdvisor() {
        openModal("tariffAdvisorModal");
    }

    function submitAdvisor() {
        const form = qs("#tariffAdvisorForm");
        if (!form) return;

        const formData = new FormData(form);
        const usage = String(formData.get("usage") || "home");
        const devices = String(formData.get("devices") || "light");
        const priority = String(formData.get("priority") || "price");
        const needsTv = String(formData.get("tv") || "no") === "yes";

        let selectedBillingId = "DEMO-100";
        if (usage === "business") {
            selectedBillingId = "DEMO-BIZ-1500";
        } else if (usage === "work") {
            selectedBillingId = priority === "speed" || devices === "heavy" ? "DEMO-800-WORK" : "DEMO-500";
        } else if (needsTv) {
            selectedBillingId = devices === "heavy" || priority === "speed" ? "DEMO-700-TV" : "DEMO-300";
        } else if (priority === "balance") {
            selectedBillingId = "DEMO-300";
        } else if (priority === "speed") {
            selectedBillingId = devices === "heavy" ? "DEMO-700-TV" : "DEMO-300";
        } else {
            selectedBillingId = devices === "light" ? "DEMO-100" : "DEMO-300";
        }

        const tariff = state.tariffs.find((item) => item.billing_tariff_id === selectedBillingId) || state.tariffs[0];
        if (!tariff) return;

        state.recommendation = tariff;
        renderRecommendation();
        closeModal("tariffAdvisorModal");
        highlightTariff(tariff.id);
        notify(`Подобрали тариф «${tariff.name}». Карточка подсвечена в каталоге.`, "success", "MTN");
    }

    function animateSwap(callback) {
        const sections = [qs("#tariffsCardsView"), qs("#tariffsTableView")].filter(Boolean);
        sections.forEach((section) => section.classList.add("is-transitioning"));
        window.setTimeout(() => {
            callback();
            window.setTimeout(() => {
                sections.forEach((section) => section.classList.remove("is-transitioning"));
            }, 20);
        }, 120);
    }

    async function loadUsageStats() {
        if (!state.authenticated) {
            state.usageStats = { average: 0, peak: 0, hasData: false };
            return;
        }

        try {
            const stats = canRequest ? await ui.request("/api/v1/speedtest/stats", { auth: true }) : null;
            const average = Number(stats?.avg_download || stats?.average_download || SMART_USAGE_DEMO.average || 0);
            const peak = Number(stats?.max_download || stats?.peak_download || SMART_USAGE_DEMO.peak || 0);
            if (average > 0 || peak > 0) {
                state.usageStats = {
                    average: Math.round(average || SMART_USAGE_DEMO.average),
                    peak: Math.round(peak || SMART_USAGE_DEMO.peak),
                    hasData: true,
                };
                return;
            }
        } catch (error) {
            console.warn("Не удалось получить статистику speedtest, используем демо-данные", error);
        }

        state.usageStats = SMART_USAGE_DEMO;
    }

    async function loadPageData() {
        setPageState(true, false);
        renderCurrentTariffPanel();
        renderRecommendation();

        if (!canRequest) {
            state.tariffs = buildCatalog([]);
            await loadUsageStats();
            computeRecommendation();
            setPageState(false, false);
            renderCurrentTariffPanel();
            renderRecommendation();
            renderFilters();
            return;
        }

        try {
            const tariffsResponse = await ui.request("/api/v1/tariffs/");
            state.tariffs = buildCatalog(Array.isArray(tariffsResponse) ? tariffsResponse : []);

            if (state.authenticated) {
                const [currentTariffResult, balanceResult] = await Promise.allSettled([
                    ui.request("/api/v1/billing/tariff", { auth: true }),
                    ui.request("/api/v1/billing/balance", { auth: true }),
                ]);

                if (currentTariffResult.status === "fulfilled") {
                    state.currentTariffData = currentTariffResult.value || null;
                    state.currentTariffBillingId = String(
                        currentTariffResult.value?.tariff_id ||
                        currentTariffResult.value?.billing_tariff_id ||
                        ""
                    );
                } else {
                    state.currentTariffBillingId = "";
                    state.currentTariffData = null;
                }

                if (balanceResult.status === "fulfilled") {
                    state.balance = Number(balanceResult.value?.balance || 0);
                    state.debtAmount = state.balance < 0 ? Math.abs(state.balance) : 0;
                } else {
                    state.balance = null;
                    state.debtAmount = 0;
                }
            } else {
                state.currentTariffBillingId = "";
                state.currentTariffData = null;
                state.balance = null;
                state.debtAmount = 0;
            }

            await loadUsageStats();
            computeRecommendation();
            setPageState(false, false);
            renderCurrentTariffPanel();
            renderRecommendation();
            renderFilters();
        } catch (error) {
            console.error("Не удалось загрузить тарифы MTN", error);
            state.tariffs = [];
            state.currentTariffData = null;
            state.currentTariffBillingId = "";
            state.usageStats = { average: 0, peak: 0, hasData: false };
            state.recommendation = null;
            setPageState(false, true);
            renderCurrentTariffPanel();
            renderRecommendation();
            renderView();
        }
    }

    function bindEvents() {
        qsa(".tariffs-view-switch-v3__button").forEach((button) => {
            button.addEventListener("click", () => {
                state.view = button.dataset.view || "cards";
                window.localStorage.setItem(STORAGE_KEYS.view, state.view);
                animateSwap(() => renderView());
            });
        });

        qsa(".tariffs-filter-v3").forEach((button) => {
            button.addEventListener("click", () => {
                state.filter = button.dataset.filter || "all";
                window.localStorage.setItem(STORAGE_KEYS.filter, state.filter);
                animateSwap(() => renderFilters());
            });
        });

        document.addEventListener("click", (event) => {
            const selectButton = event.target.closest("[data-tariff-select]");
            if (selectButton) openChangeModal(selectButton.getAttribute("data-tariff-select"));

            const compareRemove = event.target.closest("[data-compare-remove]");
            if (compareRemove) toggleCompare(compareRemove.getAttribute("data-compare-remove"), false);
        });

        document.addEventListener("change", (event) => {
            const compareToggle = event.target.closest("[data-compare-toggle]");
            if (compareToggle) {
                toggleCompare(compareToggle.getAttribute("data-compare-toggle"), compareToggle.checked);
            }

            const scheduleInput = event.target.closest('input[name="tariffEffectiveFrom"]');
            if (scheduleInput) {
                state.effectiveFrom = scheduleInput.value || "next_month";
                renderEffectiveFromChoice();
            }
        });

        const retryButton = qs("#tariffsRetryButton");
        if (retryButton) retryButton.addEventListener("click", () => loadPageData().catch(() => {}));

        const recommendationAction = qs("#tariffsRecommendationAction");
        if (recommendationAction) recommendationAction.addEventListener("click", handleRecommendationAction);

        const advisorOpen = qs("#tariffsAdvisorOpen");
        if (advisorOpen) advisorOpen.addEventListener("click", openAdvisor);

        const advisorSubmit = qs("#tariffAdvisorSubmit");
        if (advisorSubmit) advisorSubmit.addEventListener("click", submitAdvisor);

        const compareClear = qs("#tariffCompareClear");
        if (compareClear) compareClear.addEventListener("click", clearCompare);

        const confirmButton = qs("#tariffModalConfirm");
        if (confirmButton) confirmButton.addEventListener("click", () => confirmChange().catch(() => {}));

        qsa("[data-tariff-modal-close]").forEach((button) => {
            button.addEventListener("click", () => closeModal("tariffChangeModal"));
        });

        qsa("[data-tariff-advisor-close]").forEach((button) => {
            button.addEventListener("click", () => closeModal("tariffAdvisorModal"));
        });

        ["tariffChangeModal", "tariffAdvisorModal"].forEach((modalId) => {
            const modal = qs(`#${modalId}`);
            if (!modal) return;
            modal.addEventListener("click", (event) => {
                if (event.target === modal) closeModal(modalId);
            });
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (qs("#tariffChangeModal")?.classList.contains("is-open")) closeModal("tariffChangeModal");
            if (qs("#tariffAdvisorModal")?.classList.contains("is-open")) closeModal("tariffAdvisorModal");
        });

        window.addEventListener("resize", renderView);
    }

    document.addEventListener("DOMContentLoaded", () => {
        setFooterState();
        bindEvents();
        loadPageData().catch(() => {});
    });
})();
