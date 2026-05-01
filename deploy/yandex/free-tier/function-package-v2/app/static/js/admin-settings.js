(function () {
    const page = document.getElementById("adminSettingsPage");
    if (!page || !window.OperatorUI) return;

    const STORAGE = {
        settings: "mtn_admin_settings_v1",
        templates: "mtn_admin_settings_templates_v1",
        journal: "mtn_admin_settings_journal_v1",
        backups: "mtn_admin_settings_backups_v1",
        tab: "mtn_admin_settings_active_tab_v1",
    };

    const defaults = {
        general: { companyName: "MTN", slogan: "Martin Telecom Network", supportPhone: "+7 (999) 123-45-67", supportEmail: "support@mtn.ru", officeAddress: "г. Москва, ул. Связи, д. 1", defaultTariff: "Город 300", paymentFee: 0, minPayment: 10, maxPayment: 15000, debtThreshold: 500, brandPrimary: "#2563EB", pageBackground: "#F4F6FA", logoName: "logo.png", faviconName: "favicon.ico" },
        notifications: { emailEnabled: true, smtpServer: "smtp.mtn.ru", smtpPort: 587, smtpLogin: "noreply@mtn.ru", smtpPassword: "smtp-demo-key", senderEmail: "noreply@mtn.ru", smsEnabled: true, smsGateway: "https://sms.mtn.ru/api", smsApiKey: "sms-demo-key", smsSignature: "MTN", pushEnabled: true, vapidPublic: "BMTN_PUBLIC_VAPID_KEY", vapidPrivate: "MTN_PRIVATE_VAPID_KEY", events: { ticketReply: { email: true, sms: false, push: true }, charge: { email: true, sms: true, push: true }, topup: { email: true, sms: true, push: false }, maintenance: { email: true, sms: false, push: false }, promo: { email: true, sms: false, push: false } } },
        integrations: { gateway: "ЮKassa", shopId: "123456", secret: "shop-secret-demo", testMode: true, methods: { card: true, sbp: true, cash: false }, billingUrl: "https://billing.mtn.ru/api", billingKey: "billing-demo-key", billingTimeout: 30, billingRetries: 3, speedtestServer: "speedtest.mtn.ru", cdn: "cdn.mtn.ru", gaId: "UA-123456-1", ymId: "12345678" },
        security: { minPassword: 8, requireDigits: true, requireUppercase: true, requireSymbols: false, passwordExpireDays: 90, sessionHours: 24, maxSessions: 5, requireAdmin2fa: true, failedAttempts: 5, lockMinutes: 15, encryptDb: true, maintenanceMode: false, ipWhitelist: "192.168.1.0/24" },
        advanced: { autoBackup: true, backupRetention: 30, backupStorage: "s3://mtn-backup/", logLevel: "error", keepLogsDays: 30, errorMail: true, errorEmail: "admin@mtn.ru", systemVersion: "v2.1.0", lastUpdate: "15.03.2026", subscribers: 5234, operators: 5, diskFree: "42 ГБ", lastBackup: "15.03.2026 03:00" },
    };

    const defaultTemplates = {
        ticket_reply: "Здравствуйте, {{name}}! По вашей заявке №{{ticket_id}} появился новый ответ. Откройте личный кабинет, чтобы продолжить диалог.",
        monthly_charge: "Здравствуйте, {{name}}! По тарифу «{{tariff}}» выполнено списание. Текущий баланс: {{balance}}.",
        maintenance: "Здравствуйте, {{name}}! На вашей линии запланированы технические работы. Мы предупредим дополнительно после завершения.",
        promo: "Здравствуйте, {{name}}! Для вас доступно новое предложение по тарифу «{{tariff}}». Баланс сейчас: {{balance}}.",
    };

    const sampleVars = { name: "Мартин", ticket_id: "123", balance: "1 470 ₽", tariff: "Город 300" };
    const state = {
        user: null,
        settings: read(STORAGE.settings, clone(defaults)),
        templates: read(STORAGE.templates, clone(defaultTemplates)),
        journal: read(STORAGE.journal, seedJournal()),
        backups: read(STORAGE.backups, seedBackups()),
        activeTab: window.localStorage.getItem(STORAGE.tab) || "general",
        pendingSave: null,
    };

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function read(key, fallback) { try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
    function write(key, value) { window.localStorage.setItem(key, JSON.stringify(value)); }
    function gid(id) { return document.getElementById(id); }
    function val(id) { return String(gid(id)?.value || "").trim(); }
    function num(id) { return Number(gid(id)?.value || 0); }
    function checked(id) { return Boolean(gid(id)?.checked); }
    function setVal(id, value) { if (gid(id)) gid(id).value = value ?? ""; }
    function setChecked(id, value) { if (gid(id)) gid(id).checked = Boolean(value); }

    function seedJournal() {
        return [
            { id: 1, when: "2026-04-11T08:20:00+03:00", category: "security", admin: "Иван Иванов", summary: "Обновлена политика паролей", details: "Минимальная длина увеличена до 8 символов, включены цифры и заглавные буквы." },
            { id: 2, when: "2026-04-10T18:05:00+03:00", category: "integrations", admin: "Иван Иванов", summary: "Изменён billing timeout", details: "Таймаут запросов к billing API изменён с 20 до 30 секунд." },
            { id: 3, when: "2026-04-09T12:10:00+03:00", category: "notifications", admin: "Мария Петрова", summary: "Обновлён шаблон email", details: "В письмо добавлена персонализация по имени клиента." },
        ];
    }

    function seedBackups() {
        return [{ id: 1, createdAt: "2026-04-11T03:00:00+03:00", label: "Автоматическая копия 03:00", snapshot: clone(defaults) }];
    }

    function tabTitle(key) {
        return { general: "Общие", notifications: "Уведомления", integrations: "Интеграции", security: "Безопасность", advanced: "Дополнительно", all: "Все" }[key] || key;
    }

    function addJournal(category, summary, details) {
        state.journal.unshift({ id: Date.now(), when: new Date().toISOString(), category, admin: state.user?.full_name || state.user?.phone || "Иван Иванов", summary, details });
        write(STORAGE.journal, state.journal);
        renderAudit();
    }

    function setActiveTab(tab) {
        state.activeTab = tab;
        window.localStorage.setItem(STORAGE.tab, tab);
        page.querySelectorAll("[data-settings-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.settingsTab === tab));
        page.querySelectorAll("[data-settings-panel]").forEach((panel) => {
            const active = panel.dataset.settingsPanel === tab;
            panel.hidden = !active;
            panel.classList.toggle("is-active", active);
        });
    }

    function collect() {
        return {
            general: { companyName: val("settingsCompanyName"), slogan: val("settingsCompanySlogan"), supportPhone: val("settingsSupportPhone"), supportEmail: val("settingsSupportEmail"), officeAddress: val("settingsOfficeAddress"), defaultTariff: val("settingsDefaultTariff"), paymentFee: num("settingsPaymentFee"), minPayment: num("settingsMinPayment"), maxPayment: num("settingsMaxPayment"), debtThreshold: num("settingsDebtThreshold"), brandPrimary: val("settingsBrandPrimary"), pageBackground: val("settingsPageBackground"), logoName: state.settings.general.logoName, faviconName: state.settings.general.faviconName },
            notifications: { emailEnabled: checked("settingsEmailEnabled"), smtpServer: val("settingsSmtpServer"), smtpPort: num("settingsSmtpPort"), smtpLogin: val("settingsSmtpLogin"), smtpPassword: val("settingsSmtpPassword"), senderEmail: val("settingsSenderEmail"), smsEnabled: checked("settingsSmsEnabled"), smsGateway: val("settingsSmsGateway"), smsApiKey: val("settingsSmsApiKey"), smsSignature: val("settingsSmsSignature"), pushEnabled: checked("settingsPushEnabled"), vapidPublic: val("settingsVapidPublic"), vapidPrivate: val("settingsVapidPrivate"), events: { ticketReply: { email: checked("settingsEventTicketReplyEmail"), sms: checked("settingsEventTicketReplySms"), push: checked("settingsEventTicketReplyPush") }, charge: { email: checked("settingsEventChargeEmail"), sms: checked("settingsEventChargeSms"), push: checked("settingsEventChargePush") }, topup: { email: checked("settingsEventTopupEmail"), sms: checked("settingsEventTopupSms"), push: checked("settingsEventTopupPush") }, maintenance: { email: checked("settingsEventMaintenanceEmail"), sms: checked("settingsEventMaintenanceSms"), push: checked("settingsEventMaintenancePush") }, promo: { email: checked("settingsEventPromoEmail"), sms: checked("settingsEventPromoSms"), push: checked("settingsEventPromoPush") } } },
            integrations: { gateway: val("settingsPaymentGateway"), shopId: val("settingsPaymentShopId"), secret: val("settingsPaymentSecret"), testMode: checked("settingsPaymentTestMode"), methods: { card: checked("settingsPaymentMethodCard"), sbp: checked("settingsPaymentMethodSbp"), cash: checked("settingsPaymentMethodCash") }, billingUrl: val("settingsBillingUrl"), billingKey: val("settingsBillingKey"), billingTimeout: num("settingsBillingTimeout"), billingRetries: num("settingsBillingRetries"), speedtestServer: val("settingsSpeedtestServer"), cdn: val("settingsCdn"), gaId: val("settingsGaId"), ymId: val("settingsYmId") },
            security: { minPassword: num("settingsMinPassword"), requireDigits: checked("settingsRequireDigits"), requireUppercase: checked("settingsRequireUppercase"), requireSymbols: checked("settingsRequireSymbols"), passwordExpireDays: num("settingsPasswordExpireDays"), sessionHours: num("settingsSessionHours"), maxSessions: num("settingsMaxSessions"), requireAdmin2fa: checked("settingsRequireAdmin2fa"), failedAttempts: num("settingsFailedAttempts"), lockMinutes: num("settingsLockMinutes"), encryptDb: checked("settingsEncryptDb"), maintenanceMode: checked("settingsMaintenanceMode"), ipWhitelist: val("settingsIpWhitelist") },
            advanced: { autoBackup: checked("settingsAutoBackup"), backupRetention: num("settingsBackupRetention"), backupStorage: val("settingsBackupStorage"), logLevel: val("settingsLogLevel"), keepLogsDays: num("settingsKeepLogsDays"), errorMail: checked("settingsErrorMail"), errorEmail: val("settingsErrorEmail"), systemVersion: state.settings.advanced.systemVersion, lastUpdate: state.settings.advanced.lastUpdate, subscribers: state.settings.advanced.subscribers, operators: state.settings.advanced.operators, diskFree: state.settings.advanced.diskFree, lastBackup: state.settings.advanced.lastBackup },
        };
    }

    function fill() {
        const s = state.settings;
        [["settingsCompanyName", s.general.companyName],["settingsCompanySlogan", s.general.slogan],["settingsSupportPhone", s.general.supportPhone],["settingsSupportEmail", s.general.supportEmail],["settingsOfficeAddress", s.general.officeAddress],["settingsDefaultTariff", s.general.defaultTariff],["settingsPaymentFee", s.general.paymentFee],["settingsMinPayment", s.general.minPayment],["settingsMaxPayment", s.general.maxPayment],["settingsDebtThreshold", s.general.debtThreshold],["settingsBrandPrimary", s.general.brandPrimary],["settingsPageBackground", s.general.pageBackground],["settingsSmtpServer", s.notifications.smtpServer],["settingsSmtpPort", s.notifications.smtpPort],["settingsSmtpLogin", s.notifications.smtpLogin],["settingsSmtpPassword", s.notifications.smtpPassword],["settingsSenderEmail", s.notifications.senderEmail],["settingsSmsGateway", s.notifications.smsGateway],["settingsSmsApiKey", s.notifications.smsApiKey],["settingsSmsSignature", s.notifications.smsSignature],["settingsVapidPublic", s.notifications.vapidPublic],["settingsVapidPrivate", s.notifications.vapidPrivate],["settingsPaymentGateway", s.integrations.gateway],["settingsPaymentShopId", s.integrations.shopId],["settingsPaymentSecret", s.integrations.secret],["settingsBillingUrl", s.integrations.billingUrl],["settingsBillingKey", s.integrations.billingKey],["settingsBillingTimeout", s.integrations.billingTimeout],["settingsBillingRetries", s.integrations.billingRetries],["settingsSpeedtestServer", s.integrations.speedtestServer],["settingsCdn", s.integrations.cdn],["settingsGaId", s.integrations.gaId],["settingsYmId", s.integrations.ymId],["settingsMinPassword", s.security.minPassword],["settingsPasswordExpireDays", s.security.passwordExpireDays],["settingsSessionHours", s.security.sessionHours],["settingsMaxSessions", s.security.maxSessions],["settingsFailedAttempts", s.security.failedAttempts],["settingsLockMinutes", s.security.lockMinutes],["settingsIpWhitelist", s.security.ipWhitelist],["settingsBackupRetention", s.advanced.backupRetention],["settingsBackupStorage", s.advanced.backupStorage],["settingsLogLevel", s.advanced.logLevel],["settingsKeepLogsDays", s.advanced.keepLogsDays],["settingsErrorEmail", s.advanced.errorEmail]].forEach(([id, value]) => setVal(id, value));
        [["settingsEmailEnabled", s.notifications.emailEnabled],["settingsSmsEnabled", s.notifications.smsEnabled],["settingsPushEnabled", s.notifications.pushEnabled],["settingsPaymentTestMode", s.integrations.testMode],["settingsPaymentMethodCard", s.integrations.methods.card],["settingsPaymentMethodSbp", s.integrations.methods.sbp],["settingsPaymentMethodCash", s.integrations.methods.cash],["settingsRequireDigits", s.security.requireDigits],["settingsRequireUppercase", s.security.requireUppercase],["settingsRequireSymbols", s.security.requireSymbols],["settingsRequireAdmin2fa", s.security.requireAdmin2fa],["settingsEncryptDb", s.security.encryptDb],["settingsMaintenanceMode", s.security.maintenanceMode],["settingsAutoBackup", s.advanced.autoBackup],["settingsErrorMail", s.advanced.errorMail],["settingsEventTicketReplyEmail", s.notifications.events.ticketReply.email],["settingsEventTicketReplySms", s.notifications.events.ticketReply.sms],["settingsEventTicketReplyPush", s.notifications.events.ticketReply.push],["settingsEventChargeEmail", s.notifications.events.charge.email],["settingsEventChargeSms", s.notifications.events.charge.sms],["settingsEventChargePush", s.notifications.events.charge.push],["settingsEventTopupEmail", s.notifications.events.topup.email],["settingsEventTopupSms", s.notifications.events.topup.sms],["settingsEventTopupPush", s.notifications.events.topup.push],["settingsEventMaintenanceEmail", s.notifications.events.maintenance.email],["settingsEventMaintenanceSms", s.notifications.events.maintenance.sms],["settingsEventMaintenancePush", s.notifications.events.maintenance.push],["settingsEventPromoEmail", s.notifications.events.promo.email],["settingsEventPromoSms", s.notifications.events.promo.sms],["settingsEventPromoPush", s.notifications.events.promo.push]].forEach(([id, value]) => setChecked(id, value));
        gid("settingsLogoFileName").textContent = s.general.logoName || "Файл не выбран";
        gid("settingsFaviconFileName").textContent = s.general.faviconName || "Файл не выбран";
        gid("settingsSystemVersion").textContent = s.advanced.systemVersion;
        gid("settingsSystemLastUpdate").textContent = s.advanced.lastUpdate;
        gid("settingsSystemLastBackup").textContent = s.advanced.lastBackup;
        gid("settingsSystemSubscribers").textContent = s.advanced.subscribers;
        gid("settingsSystemOperators").textContent = s.advanced.operators;
        gid("settingsSystemDisk").textContent = s.advanced.diskFree;
        updatePreview();
        renderBackups();
        renderAudit();
    }

    function updatePreview() {
        const g = collect().general;
        gid("adminSettingsPreviewCard").style.background = g.pageBackground || "#F4F6FA";
        gid("adminSettingsPreviewLogo").style.background = g.brandPrimary || "#2563EB";
        gid("adminSettingsPreviewButton").style.background = g.brandPrimary || "#2563EB";
        gid("adminSettingsPreviewButton").style.borderColor = g.brandPrimary || "#2563EB";
        gid("adminSettingsPreviewCompany").textContent = g.companyName || "MTN";
        gid("adminSettingsPreviewSlogan").textContent = g.slogan || "Martin Telecom Network";
        gid("adminSettingsPreviewPhone").textContent = g.supportPhone || "—";
        gid("adminSettingsPreviewEmail").textContent = g.supportEmail || "—";
        gid("adminSettingsPreviewLogo").textContent = (g.companyName || "MTN").slice(0, 3).toUpperCase();
    }

    function hasCriticalChanges(next) {
        const a = state.settings.security;
        const b = next.security;
        return a.requireAdmin2fa !== b.requireAdmin2fa || a.encryptDb !== b.encryptDb || a.maintenanceMode !== b.maintenanceMode || a.ipWhitelist !== b.ipWhitelist;
    }

    function renderAudit() {
        const filter = val("adminSettingsAuditFilter") || "all";
        const items = state.journal.filter((entry) => filter === "all" || entry.category === filter);
        gid("adminSettingsAuditList").innerHTML = items.length ? items.map((entry) => `<article class="admin-settings-audit-item"><div class="admin-suite-head"><div><h3>${OperatorUI.escapeHTML(entry.summary)}</h3><p>${OperatorUI.escapeHTML(entry.details)}</p></div><span class="admin-suite-badge">${OperatorUI.escapeHTML(tabTitle(entry.category))}</span></div><div class="admin-settings-audit-meta"><span>${OperatorUI.formatDate(entry.when, { includeTime: true })}</span><span>${OperatorUI.escapeHTML(entry.admin)}</span></div></article>`).join("") : OperatorUI.createEmptyState("fas fa-scroll", "Записей пока нет", "История появится после первого сохранения.");
    }

    function renderBackups() {
        gid("adminSettingsBackupsList").innerHTML = state.backups.length ? state.backups.map((backup) => `<article class="admin-settings-backup-item"><div class="admin-settings-backup-meta"><strong>${OperatorUI.escapeHTML(backup.label)}</strong><span>${OperatorUI.formatDate(backup.createdAt, { includeTime: true })}</span><span>Тариф по умолчанию: ${OperatorUI.escapeHTML(backup.snapshot.general.defaultTariff)}</span></div><div class="admin-suite-actions"><button class="btn btn-secondary btn-sm" type="button" data-backup-restore="${backup.id}">Восстановить</button></div></article>`).join("") : OperatorUI.createEmptyState("fas fa-database", "Резервных копий пока нет", "Создайте первую копию, чтобы появился журнал восстановлений.");
        page.querySelectorAll("[data-backup-restore]").forEach((button) => button.addEventListener("click", () => restoreBackup(Number(button.dataset.backupRestore))));
    }

    function saveSettings(category, confirmed = false) {
        const next = collect();
        if ((category === "security" || category === "all") && hasCriticalChanges(next) && !confirmed) {
            state.pendingSave = () => saveSettings(category, true);
            gid("adminSettingsConfirmPassword").value = "";
            OperatorUI.openModal("adminSettingsConfirmModal");
            return;
        }
        state.settings = next;
        write(STORAGE.settings, state.settings);
        addJournal(category, `Сохранена вкладка «${tabTitle(category)}»`, "Настройки обновлены из административной панели.");
        fill();
        OperatorUI.toast("Настройки сохранены.", "success");
    }

    function resetTab(category) {
        if (category === "all") {
            state.settings = clone(defaults);
            write(STORAGE.settings, state.settings);
            addJournal("general", "Полный сброс настроек", "Все demo-настройки возвращены к значениям по умолчанию.");
            fill();
            OperatorUI.toast("Все настройки сброшены.", "success");
            return;
        }
        state.settings[category] = clone(defaults[category]);
        write(STORAGE.settings, state.settings);
        addJournal(category, `Сброшена вкладка «${tabTitle(category)}»`, "Вкладка возвращена к значениям по умолчанию.");
        fill();
        OperatorUI.toast(`Вкладка «${tabTitle(category)}» сброшена.`, "success");
    }

    function createBackup() {
        const backup = { id: Date.now(), createdAt: new Date().toISOString(), label: `Ручная копия ${new Date().toLocaleString("ru-RU")}`, snapshot: collect() };
        state.backups.unshift(backup);
        state.backups = state.backups.slice(0, Math.max(1, state.settings.advanced.backupRetention));
        state.settings.advanced.lastBackup = new Date().toLocaleString("ru-RU");
        write(STORAGE.backups, state.backups);
        write(STORAGE.settings, state.settings);
        addJournal("advanced", "Создана резервная копия", `Snapshot сохранён в ${backup.createdAt}.`);
        fill();
        OperatorUI.toast("Резервная копия создана.", "success");
    }

    function restoreBackup(id) {
        const backup = state.backups.find((item) => item.id === id);
        if (!backup) return;
        if (!window.confirm(`Восстановить настройки из копии от ${new Date(backup.createdAt).toLocaleString("ru-RU")}?`)) return;
        state.settings = clone(backup.snapshot);
        write(STORAGE.settings, state.settings);
        addJournal("advanced", "Выполнено восстановление из резервной копии", `Восстановлена копия «${backup.label}».`);
        fill();
        OperatorUI.toast("Конфигурация восстановлена.", "success");
    }

    function replaceVars(template) {
        return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => sampleVars[key] || `{{${key}}}`);
    }

    function syncTemplateEditor() {
        const key = val("adminSettingsTemplateSelect");
        gid("adminSettingsTemplateText").value = state.templates[key] || "";
        gid("adminSettingsTemplatePreview").innerHTML = replaceVars(gid("adminSettingsTemplateText").value).replace(/\n/g, "<br>");
    }

    function saveTemplate() {
        const key = val("adminSettingsTemplateSelect");
        state.templates[key] = gid("adminSettingsTemplateText").value.trim();
        write(STORAGE.templates, state.templates);
        addJournal("notifications", "Обновлён шаблон уведомления", `Изменён шаблон «${key}».`);
        OperatorUI.closeModal("adminSettingsTemplateModal");
        OperatorUI.toast("Шаблон сохранён.", "success");
    }

    function setCheckStatus(text, success) {
        const node = gid("settingsPaymentCheckStatus");
        node.textContent = text;
        node.classList.toggle("is-success", success === true);
        node.classList.toggle("is-error", success === false);
    }

    function simulateCheck(target) {
        setCheckStatus("Проверяем...", null);
        window.setTimeout(() => {
            const success = Math.random() > 0.18;
            setCheckStatus(success ? "Соединение установлено" : "Ошибка: таймаут или недоступный endpoint", success);
            addJournal("integrations", `Выполнена проверка ${target}`, success ? "Подключение прошло успешно." : "Demo-проверка завершилась ошибкой.");
            OperatorUI.toast(success ? "Проверка соединения успешна." : "Подключение проверить не удалось.", success ? "success" : "error");
        }, 900);
    }

    function testChannel(channel) {
        const button = page.querySelector(`[data-test-channel="${channel}"]`);
        OperatorUI.setButtonLoading(button, true, "Отправляем...");
        window.setTimeout(() => {
            OperatorUI.setButtonLoading(button, false);
            addJournal("notifications", `Отправлено тестовое ${channel}-уведомление`, "Выполнена demo-проверка канала доставки.");
            OperatorUI.toast(`Тестовое ${channel}-уведомление отправлено.`, "success");
        }, 800);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function exportConfig() {
        downloadBlob(new Blob([JSON.stringify(state.settings.integrations, null, 2)], { type: "application/json;charset=utf-8" }), "mtn-integrations-config.json");
        addJournal("integrations", "Экспортирована конфигурация интеграций", "JSON-файл выгружен из административной панели.");
    }

    function importConfig(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const payload = JSON.parse(String(reader.result || "{}"));
                state.settings.integrations = { ...state.settings.integrations, ...payload, methods: { ...state.settings.integrations.methods, ...(payload.methods || {}) } };
                write(STORAGE.settings, state.settings);
                fill();
                addJournal("integrations", "Импортирована конфигурация интеграций", `Файл ${file.name} успешно применён.`);
                OperatorUI.toast("Конфигурация интеграций импортирована.", "success");
            } catch {
                OperatorUI.toast("Не удалось прочитать JSON-конфигурацию.", "error");
            }
        };
        reader.readAsText(file, "utf-8");
    }

    function clearDemoCache() {
        Object.keys(window.localStorage).forEach((key) => { if (key.startsWith("mtn_")) window.localStorage.removeItem(key); });
        window.sessionStorage.clear();
        state.settings = clone(defaults);
        state.templates = clone(defaultTemplates);
        state.journal = seedJournal();
        state.backups = seedBackups();
        write(STORAGE.settings, state.settings);
        write(STORAGE.templates, state.templates);
        write(STORAGE.journal, state.journal);
        write(STORAGE.backups, state.backups);
        fill();
        OperatorUI.toast("Demo-кеш очищен. При необходимости можно обновить страницу.", "success");
    }

    function bind() {
        page.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.settingsTab)));
        page.querySelectorAll("[data-settings-save-tab]").forEach((button) => button.addEventListener("click", () => saveSettings(button.dataset.settingsSaveTab)));
        page.querySelectorAll("[data-settings-reset-tab]").forEach((button) => button.addEventListener("click", () => resetTab(button.dataset.settingsResetTab)));
        gid("adminSettingsSaveAllButton").addEventListener("click", () => saveSettings("all"));
        gid("adminSettingsResetAllButton").addEventListener("click", () => resetTab("all"));
        gid("adminSettingsAuditButton").addEventListener("click", () => { renderAudit(); OperatorUI.openModal("adminSettingsAuditModal"); });
        gid("adminSettingsAuditFilter").addEventListener("change", renderAudit);
        page.querySelectorAll("[data-open-template-editor]").forEach((button) => button.addEventListener("click", () => { syncTemplateEditor(); OperatorUI.openModal("adminSettingsTemplateModal"); }));
        gid("adminSettingsTemplateSelect").addEventListener("change", syncTemplateEditor);
        gid("adminSettingsTemplateText").addEventListener("input", () => { gid("adminSettingsTemplatePreview").innerHTML = replaceVars(gid("adminSettingsTemplateText").value).replace(/\n/g, "<br>"); });
        gid("adminSettingsTemplateSaveButton").addEventListener("click", saveTemplate);
        page.querySelectorAll("[data-test-channel]").forEach((button) => button.addEventListener("click", () => testChannel(button.dataset.testChannel)));
        page.querySelectorAll("[data-check-target]").forEach((button) => button.addEventListener("click", () => simulateCheck(button.dataset.checkTarget)));
        gid("adminSettingsExportConfigButton").addEventListener("click", exportConfig);
        gid("adminSettingsImportConfigButton").addEventListener("click", () => gid("adminSettingsImportConfigInput").click());
        gid("adminSettingsImportConfigInput").addEventListener("change", (event) => importConfig(event.target.files?.[0]));
        gid("adminSettingsCreateBackupButton").addEventListener("click", createBackup);
        gid("adminSettingsClearCacheButton").addEventListener("click", clearDemoCache);
        gid("adminSettingsConfirmApplyButton").addEventListener("click", () => {
            if (val("adminSettingsConfirmPassword") !== "admin123") { OperatorUI.toast("Неверный пароль администратора.", "error"); return; }
            OperatorUI.closeModal("adminSettingsConfirmModal");
            const pending = state.pendingSave;
            state.pendingSave = null;
            if (pending) pending();
        });
        ["settingsCompanyName","settingsCompanySlogan","settingsSupportPhone","settingsSupportEmail","settingsBrandPrimary","settingsPageBackground"].forEach((id) => gid(id)?.addEventListener("input", updatePreview));
        gid("settingsLogoFile").addEventListener("change", () => { const file = gid("settingsLogoFile").files?.[0]; if (!file) return; state.settings.general.logoName = file.name; gid("settingsLogoFileName").textContent = file.name; addJournal("general", "Изменён файл логотипа", `Загружен demo-файл ${file.name}.`); });
        gid("settingsFaviconFile").addEventListener("change", () => { const file = gid("settingsFaviconFile").files?.[0]; if (!file) return; state.settings.general.faviconName = file.name; gid("settingsFaviconFileName").textContent = file.name; addJournal("general", "Изменён favicon", `Загружен demo-файл ${file.name}.`); });
    }

    async function init() {
        const user = await OperatorUI.ensureAdminAccess(page, { errorTitle: "Не удалось открыть настройки" });
        if (!user) return;
        state.user = user;
        bind();
        fill();
        setActiveTab(state.activeTab);
        syncTemplateEditor();
    }

    init();
})();
