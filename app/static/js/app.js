(function () {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;

    const OperatorUI = {
        state: {
            user: null,
            notifications: [],
            unreadCount: 0,
            ws: null,
            wsAttempts: 0,
            notificationPollTimer: null,
            serviceWorkerRegistration: null,
            cursor: null,
            pointerX: window.innerWidth / 2,
            pointerY: window.innerHeight / 2,
            revealObserver: null,
            sceneObserver: null,
        },

        init() {
            this.ensureToastStack();
            this.installPreloader();
            this.installCursor();
            this.bindScrollProgress();
            this.bindHeaderNav();
            this.bindSidebar();
            this.bindDropdowns();
            this.bindModalDismiss();
            this.highlightCurrentNav();
            this.bindMotionSystems();
            this.syncAuthChrome().finally(() => {
                this.connectWebSocket();
                this.startNotificationPolling();
            });
            this.applyTimeTheme();
        },

        qs(selector, root = document) {
            return root.querySelector(selector);
        },

        qsa(selector, root = document) {
            return Array.from(root.querySelectorAll(selector));
        },

        getToken() {
            return localStorage.getItem("access_token") || localStorage.getItem("mtn_token");
        },

        getRefreshToken() {
            return localStorage.getItem("refresh_token");
        },

        isServerAuthenticated() {
            return document.body?.dataset?.authenticated === "true";
        },

        setServerAuthenticated(value) {
            if (document.body?.dataset) {
                document.body.dataset.authenticated = value ? "true" : "false";
            }
        },

        isAuthenticated() {
            return Boolean(this.state.user || this.getToken() || this.isServerAuthenticated());
        },

        clearAuthState() {
            if (this.state.ws) {
                try {
                    this.state.ws.close();
                } catch (error) {
                    console.warn("Не удалось закрыть WebSocket при очистке сессии", error);
                }
            }
            this.state.ws = null;
            this.state.user = null;
            this.state.notifications = [];
            this.state.unreadCount = 0;
            this.stopNotificationPolling();
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
            localStorage.removeItem("user_id");
            localStorage.removeItem("mtn_token");
            localStorage.removeItem("mtn_user");
            this.setServerAuthenticated(false);
        },

        async logout(redirectTo = "/") {
            try {
                if (this.isAuthenticated()) {
                    await this.request("/api/v1/auth/logout", {
                        method: "POST",
                        auth: true,
                    });
                }
            } catch (error) {
                console.warn("Logout finished with a non-blocking error", error);
            } finally {
                this.clearAuthState();
                window.location.href = redirectTo;
            }
        },

        ensureToastStack() {
            let stack = document.getElementById("toastStack");
            if (!stack) {
                stack = document.createElement("div");
                stack.id = "toastStack";
                stack.className = "site-toast-stack";
                stack.hidden = true;
                document.body.appendChild(stack);
            }
            this.toastStack = stack;
        },

        toast(message, type = "info", title = "") {
            this.toastStack.hidden = false;

            const toast = document.createElement("div");
            toast.className = `site-toast ${type}`;

            const heading = title ? `<strong>${this.escapeHTML(title)}</strong>` : "";
            const body = `<div>${this.escapeHTML(message)}</div>`;
            toast.innerHTML = `${heading}${body}`;
            this.toastStack.appendChild(toast);

            window.setTimeout(() => {
                toast.classList.add("is-leaving");
            }, 3600);

            window.setTimeout(() => {
                toast.remove();
                if (!this.toastStack.children.length) {
                    this.toastStack.hidden = true;
                }
            }, 4300);
        },

        escapeHTML(value) {
            return String(value)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#39;");
        },

        extractErrorMessage(data, fallback = "Не удалось выполнить запрос") {
            if (!data) return fallback;
            if (typeof data === "string") return data;

            if (Array.isArray(data)) {
                return data
                    .map((item) => this.extractErrorMessage(item, ""))
                    .filter(Boolean)
                    .join(". ") || fallback;
            }

            if (typeof data === "object") {
                if (Array.isArray(data.detail)) {
                    const joined = data.detail
                        .map((item) => {
                            if (typeof item === "string") return item;
                            if (item?.msg && Array.isArray(item?.loc)) {
                                const fieldName = item.loc.slice(1).join(".") || "поле";
                                return `${fieldName}: ${item.msg}`;
                            }
                            return item?.msg || item?.detail || "";
                        })
                        .filter(Boolean)
                        .join(". ");
                    if (joined) return joined;
                }

                if (typeof data.detail === "string") return data.detail;
                if (typeof data.message === "string") return data.message;
                if (typeof data.error === "string") return data.error;
            }

            return fallback;
        },

        compactPayload(payload) {
            const result = {};

            Object.entries(payload || {}).forEach(([key, value]) => {
                if (typeof value === "string") {
                    const trimmed = value.trim();
                    if (!trimmed) return;
                    result[key] = trimmed;
                    return;
                }

                if (value === null || value === undefined) return;
                result[key] = value;
            });

            return result;
        },

        formatCurrency(value) {
            const amount = Number(value || 0);
            return new Intl.NumberFormat("ru-RU", {
                style: "currency",
                currency: "RUB",
                maximumFractionDigits: 0,
            }).format(amount);
        },

        formatDate(value, opts = {}) {
            if (!value) return "—";
            const date = new Date(value);
            return new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "medium",
                timeStyle: opts.includeTime ? "short" : undefined,
            }).format(date);
        },

        initials(name = "") {
            const parts = name.trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return "ЛК";
            return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        },

        roleLabel(role = "") {
            const map = {
                user: "Абонент",
                operator: "Оператор",
                admin: "Администратор",
                super_admin: "Суперадминистратор",
            };
            return map[role] || "Пользователь";
        },

        isStaffRole(role = "") {
            return ["admin", "operator", "super_admin"].includes(String(role || "").trim().toLowerCase());
        },

        isSuperAdmin(role = "") {
            return String(role || "").trim().toLowerCase() === "super_admin";
        },

        paymentMethodLabel(method = "") {
            const map = {
                bank_card: "Банковская карта",
                sbp: "СБП",
                apple_pay: "Apple Pay",
                google_pay: "Google Pay",
            };
            return map[method] || method || "Не указан";
        },

        ticketCategoryLabel(category = "") {
            const map = {
                internet: "Интернет",
                tv: "Телевидение",
                payment: "Платежи",
                tariff: "Тариф",
                other: "Другое",
            };
            return map[category] || category || "Без категории";
        },

        async request(url, options = {}) {
            const settings = {
                method: options.method || "GET",
                headers: { ...(options.headers || {}) },
                body: options.body,
                credentials: "same-origin",
            };

            if (options.auth) {
                const token = this.getToken();
                if (token) {
                    settings.headers.Authorization = `Bearer ${token}`;
                } else if (!this.isServerAuthenticated() && !this.state.user) {
                    throw new Error("AUTH_REQUIRED");
                }
            }

            if (options.json) {
                settings.headers["Content-Type"] = "application/json";
                settings.body = JSON.stringify(options.body || {});
            }

            const response = await fetch(url, settings);
            let data = null;

            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            if (!response.ok) {
                let message = this.extractErrorMessage(data, response.statusText || "Ошибка запроса");
                const normalized = String(message || "").trim().toLowerCase();

                if (response.status === 403) {
                    if (normalized.includes("admin access required") || normalized.includes("доступ разрешён только сотрудникам")) {
                        message = "Раздел доступен только сотрудникам MTN.";
                    } else if (normalized.includes("super admin access required") || normalized.includes("суперадминистратору")) {
                        message = "Раздел доступен только суперадминистратору MTN.";
                    } else if (normalized.includes("account is blocked or inactive")) {
                        message = "Учётная запись заблокирована или временно отключена.";
                    }
                }

                const error = new Error(message);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        },

        setButtonLoading(button, loading, label) {
            if (!button) return;

            if (loading) {
                if (!button.dataset.originalLabel) {
                    button.dataset.originalLabel = button.innerHTML;
                }
                button.disabled = true;
                button.innerHTML = `<i class="fas fa-spinner fa-spin"></i>${label || "Загрузка..."}`;
            } else {
                button.disabled = false;
                button.innerHTML = button.dataset.originalLabel || label || button.innerHTML;
            }
        },

        installPreloader() {
            const preloader = document.getElementById("sitePreloader");
            if (!preloader) return;
            preloader.remove();
        },

        installCursor() {
            const cursor = document.getElementById("siteCursor");
            document.body.classList.add("reduced-motion");
            if (cursor) {
                cursor.remove();
            }
        },

        bindMotionSystems() {
            if (prefersReducedMotion.matches) {
                document.body.classList.add("reduced-motion");
                return;
            }

            this.bindRevealObserver();
        },

        bindScrollProgress() {
            const progressBar = document.getElementById("siteProgressBar");
            if (!progressBar) return;

            const update = () => {
                const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
                const progress = Math.min(window.scrollY / scrollable, 1);
                progressBar.style.transform = `scaleX(${progress})`;
                document.documentElement.style.setProperty("--scroll-progress", progress.toFixed(4));
            };

            update();
            window.addEventListener("scroll", update, { passive: true });
            window.addEventListener("resize", update);
        },

        bindRevealObserver() {
            const targets = this.qsa("[data-reveal]");
            if (!targets.length) return;

            this.state.revealObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;
                        entry.target.classList.add("is-visible");
                        this.state.revealObserver.unobserve(entry.target);
                    });
                },
                { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
            );

            targets.forEach((target, index) => {
                target.style.setProperty("--reveal-delay", `${Math.min(index * 70, 420)}ms`);
                this.state.revealObserver.observe(target);
            });
        },

        bindSceneObserver() {
            return;
        },

        bindParallaxCards() {
            return;
        },

        bindTiltSurfaces() {
            return;
        },

        applyTimeTheme() {
            document.body.dataset.dayPhase = "day";
        },

        bindSidebar() {
            const sidebar = document.getElementById("siteSidebar");
            const overlay = document.getElementById("sidebarBackdrop");
            const layoutGrid = document.getElementById("layoutGrid");
            const openers = this.qsa("[data-sidebar-open]");
            const closers = this.qsa("[data-sidebar-close]");
            const collapsedKey = "operator_sidebar_collapsed";

            const applyDesktopCollapsedState = () => {
                if (!layoutGrid) return;
                const collapsed = localStorage.getItem(collapsedKey) === "1";
                layoutGrid.classList.toggle("is-collapsed", collapsed);
                document.body.classList.toggle("sidebar-collapsed", collapsed);
            };

            const open = () => {
                const sidebarUsable =
                    sidebar &&
                    !sidebar.hidden &&
                    layoutGrid &&
                    layoutGrid.classList.contains("has-sidebar");

                if (window.innerWidth <= 760 && !sidebarUsable) {
                    this.toggleHeaderNav();
                    return;
                }

                if (!sidebarUsable) return;

                if (!sidebar || !overlay) return;
                if (window.innerWidth > 1180) {
                    localStorage.setItem(collapsedKey, "0");
                    applyDesktopCollapsedState();
                }
                sidebar.classList.add("is-open");
                overlay.hidden = false;
                document.body.classList.add("modal-open", "menu-open");
            };

            const close = () => {
                if (!sidebar || !overlay) return;
                sidebar.classList.remove("is-open");
                overlay.hidden = true;
                document.body.classList.remove("modal-open", "menu-open");
            };

            const toggle = () => {
                if (window.innerWidth <= 1180) {
                    close();
                    return;
                }
                const nextCollapsed = !(localStorage.getItem(collapsedKey) === "1");
                localStorage.setItem(collapsedKey, nextCollapsed ? "1" : "0");
                applyDesktopCollapsedState();
            };

            openers.forEach((button) => button.addEventListener("click", open));
            closers.forEach((button) => button.addEventListener("click", toggle));
            if (overlay) overlay.addEventListener("click", close);

            applyDesktopCollapsedState();
            window.addEventListener("resize", () => {
                if (window.innerWidth <= 1180) {
                    layoutGrid?.classList.remove("is-collapsed");
                    document.body.classList.remove("sidebar-collapsed");
                } else {
                    applyDesktopCollapsedState();
                }
            });

            this.sidebar = { open, close, toggle };
        },

        bindHeaderNav() {
            const nav = document.getElementById("siteHeaderNav");
            const toggles = this.qsa("[data-mobile-nav-toggle]");
            if (!nav || !toggles.length) return;

            const syncExpanded = (expanded) => {
                toggles.forEach((button) => {
                    button.setAttribute("aria-expanded", expanded ? "true" : "false");
                });
            };

            this.openHeaderNav = () => {
                if (window.innerWidth > 760) return;
                nav.classList.add("is-open");
                document.body.classList.add("mobile-nav-open");
                syncExpanded(true);
            };

            this.closeHeaderNav = () => {
                nav.classList.remove("is-open");
                document.body.classList.remove("mobile-nav-open");
                syncExpanded(false);
            };

            this.toggleHeaderNav = () => {
                if (nav.classList.contains("is-open")) {
                    this.closeHeaderNav();
                    return;
                }
                this.openHeaderNav();
            };

            nav.querySelectorAll("a").forEach((link) => {
                link.addEventListener("click", () => this.closeHeaderNav());
            });

            document.addEventListener("click", (event) => {
                if (window.innerWidth > 760 || !nav.classList.contains("is-open")) return;
                const clickedToggle = event.target.closest("[data-mobile-nav-toggle]");
                if (clickedToggle || nav.contains(event.target)) return;
                this.closeHeaderNav();
            });

            window.addEventListener("resize", () => {
                if (window.innerWidth > 760) {
                    this.closeHeaderNav();
                }
            });
        },

        bindDropdowns() {
            this.qsa("[data-dropdown-trigger]").forEach((button) => {
                const targetId = button.getAttribute("data-dropdown-trigger");
                const target = document.getElementById(targetId);
                if (!target) return;

                button.addEventListener("click", (event) => {
                    event.stopPropagation();
                    const isOpen = target.classList.contains("is-open");
                    this.closeAllDropdowns();
                    if (!isOpen) {
                        target.classList.add("is-open");
                    }
                });
            });

            document.addEventListener("click", () => this.closeAllDropdowns());
        },

        closeAllDropdowns() {
            this.qsa(".dropdown.is-open").forEach((dropdown) => {
                dropdown.classList.remove("is-open");
            });
        },

        bindModalDismiss() {
            this.qsa("[data-modal-close]").forEach((button) => {
                button.addEventListener("click", () => {
                    const target = button.getAttribute("data-modal-close");
                    this.closeModal(target);
                });
            });

            this.qsa(".modal").forEach((modal) => {
                modal.addEventListener("click", (event) => {
                    if (event.target === modal) {
                        modal.classList.remove("is-open");
                        document.body.classList.remove("modal-open");
                    }
                });
            });
        },

        openModal(id) {
            const modal = document.getElementById(id);
            if (!modal) return;
            modal.classList.add("is-open");
            document.body.classList.add("modal-open");
        },

        closeModal(id) {
            const modal = document.getElementById(id);
            if (!modal) return;
            modal.classList.remove("is-open");
            document.body.classList.remove("modal-open");
        },

        highlightCurrentNav() {
            const currentPath = window.location.pathname;
            this.qsa("[data-nav-path]").forEach((link) => {
                const navPath = link.getAttribute("data-nav-path");
                const navPaths = (link.getAttribute("data-nav-paths") || "")
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean);
                if (!navPath) return;
                const isHomeNav = navPath === "/" && ["/", "/dashboard"].includes(currentPath);
                const isExtraMatch = navPaths.some((path) => currentPath === path || (path !== "/" && currentPath.startsWith(path)));
                if (isHomeNav || isExtraMatch || currentPath === navPath || (navPath !== "/" && currentPath.startsWith(navPath))) {
                    link.classList.add("is-active");
                }
            });
        },

        syncHeaderNavLinks(isAuthenticated) {
            this.qsa(".header-nav-link").forEach((link) => {
                const authHref = link.getAttribute("data-auth-href");
                const guestHref = link.getAttribute("data-guest-href");
                const nextHref = isAuthenticated ? authHref : guestHref;
                if (nextHref) {
                    link.setAttribute("href", nextHref);
                }
            });
        },

        async syncAuthChrome() {
            const guestActions = document.getElementById("navGuestActions");
            const userShell = document.getElementById("navUserShell");
            const sidebar = document.getElementById("siteSidebar");
            const layoutGrid = document.getElementById("layoutGrid");
            const privateOnly = this.qsa("[data-private-only]");
            const sidebarToggles = this.qsa("[data-sidebar-open]");
            const isHomePage = document.body.classList.contains("home-page-v2");
            const serverAuthenticated = this.isServerAuthenticated();

            if (!this.isAuthenticated() && !serverAuthenticated) {
                this.syncHeaderNavLinks(false);
                if (guestActions) guestActions.hidden = false;
                if (userShell) userShell.hidden = true;
                if (sidebar) sidebar.hidden = true;
                if (layoutGrid) layoutGrid.classList.remove("has-sidebar");
                privateOnly.forEach((node) => node.hidden = true);
                sidebarToggles.forEach((node) => node.hidden = false);
                return;
            }

            try {
                const user = await this.getCurrentUser({ force: true });
                this.state.user = user;
                this.setServerAuthenticated(true);
                this.syncHeaderNavLinks(true);
                if (guestActions) guestActions.hidden = true;
                if (userShell) userShell.hidden = false;
                if (sidebar) sidebar.hidden = isHomePage;
                if (layoutGrid) {
                    layoutGrid.classList.toggle("has-sidebar", !isHomePage);
                }
                privateOnly.forEach((node) => node.hidden = false);
                sidebarToggles.forEach((node) => {
                    node.hidden = false;
                });
                this.applyUserToChrome(user);
                await this.loadHeaderNotifications();
            } catch (error) {
                console.error("Не удалось синхронизировать шапку аккаунта", error);
                const authFailure = error?.status === 401 || error?.message === "AUTH_REQUIRED";
                if (authFailure || !serverAuthenticated) {
                    this.clearAuthState();
                    this.syncHeaderNavLinks(false);
                    if (guestActions) guestActions.hidden = false;
                    if (userShell) userShell.hidden = true;
                    if (sidebar) sidebar.hidden = true;
                    if (layoutGrid) layoutGrid.classList.remove("has-sidebar");
                    privateOnly.forEach((node) => node.hidden = true);
                    sidebarToggles.forEach((node) => node.hidden = false);
                    return;
                }

                this.syncHeaderNavLinks(true);
                if (guestActions) guestActions.hidden = true;
                if (userShell) userShell.hidden = false;
                if (sidebar) sidebar.hidden = isHomePage;
                if (layoutGrid) {
                    layoutGrid.classList.toggle("has-sidebar", !isHomePage);
                }
                privateOnly.forEach((node) => node.hidden = false);
                sidebarToggles.forEach((node) => {
                    node.hidden = false;
                });
            }
        },

        async getCurrentUser(options = {}) {
            if (!this.isAuthenticated() && !this.isServerAuthenticated()) {
                throw new Error("AUTH_REQUIRED");
            }

            if (this.state.user && !options.force) {
                return this.state.user;
            }

            const user = await this.request("/api/v1/users/me", { auth: true });
            this.state.user = user;
            this.setServerAuthenticated(true);
            return user;
        },

        applyUserToChrome(user) {
            const fullName =
                [user.last_name, user.first_name, user.middle_name].filter(Boolean).join(" ").trim() ||
                user.phone ||
                "Пользователь";
            const role = user.role || "user";
            const roleLabel = this.roleLabel(role);

            const map = {
                sidebarUserName: fullName,
                sidebarUserRole: roleLabel,
                userChipName: fullName,
                userChipRole: roleLabel,
                headerUserDropdownName: fullName,
            };

            Object.entries(map).forEach(([id, value]) => {
                const node = document.getElementById(id);
                if (node) node.textContent = value;
            });

            this.qsa("[data-user-initials]").forEach((node) => {
                node.textContent = this.initials(fullName);
            });

            const adminNodes = this.qsa("[data-admin-only]");
            const isAdmin = ["admin", "operator", "super_admin"].includes(role);
            adminNodes.forEach((node) => {
                node.hidden = !isAdmin;
            });
            const privilegedNodes = this.qsa("[data-admin-privileged]");
            const isPrivilegedAdmin = ["admin", "super_admin"].includes(role);
            privilegedNodes.forEach((node) => {
                node.hidden = !isPrivilegedAdmin;
            });
            if (isAdmin) {
                this.syncAdminSidebarNav();
            }
        },

        syncAdminSidebarNav() {
            const navMap = {
                "/admin/dashboard": { icon: "fa-gauge-high", text: "Дашборд" },
                "/admin/abonents": { icon: "fa-users", text: "Абоненты" },
                "/admin/tickets": { icon: "fa-headset", text: "Заявки" },
                "/admin/payments": { icon: "fa-money-bill-wave", text: "Платежи" },
                "/admin/tariffs": { icon: "fa-tags", text: "Тарифы" },
                "/admin/operators": { icon: "fa-user-shield", text: "Операторы" },
                "/admin/activity-log": { icon: "fa-scroll", text: "Журнал" },
                "/admin/logs": { icon: "fa-scroll", text: "Журнал" },
                "/admin/metrics": { icon: "fa-chart-column", text: "Метрики" },
                "/admin/settings": { icon: "fa-sliders", text: "Настройки" },
            };

            this.qsa("[data-admin-only][data-nav-path]").forEach((link) => {
                const navPath = link.getAttribute("data-nav-path");
                const config = navMap[navPath];
                if (!config) return;

                const icon = link.querySelector("i");
                const label = link.querySelector("span");
                if (icon) {
                    icon.className = `fas ${config.icon}`;
                }
                if (label) {
                    label.textContent = config.text;
                }
            });

            this.qsa(".sidebar-label[data-admin-only]").forEach((label) => {
                label.textContent = "Операторский модуль";
            });
        },

        async loadHeaderNotifications() {
            const unreadBadge = document.getElementById("headerUnreadBadge");
            const list = document.getElementById("headerNotificationsList");

            if (!this.isAuthenticated() || !list) return;

            try {
                const notifications = await this.request("/api/v1/notifications/?limit=6", { auth: true });
                this.state.notifications = notifications;

                if (unreadBadge) {
                    const unread = notifications.filter((n) => !n.is_read).length;
                    unreadBadge.hidden = unread === 0;
                    unreadBadge.textContent = unread > 9 ? "9+" : String(unread);
                }

                if (!notifications.length) {
                    list.innerHTML = `<div class="dropdown-item"><div class="table-copy">Новых уведомлений пока нет.</div></div>`;
                    return;
                }

                list.innerHTML = notifications
                    .map(
                        (item) => `
                            <div class="dropdown-item">
                                <div class="table-title">${this.escapeHTML(item.title)}</div>
                                <div class="table-copy">${this.escapeHTML(item.body || "")}</div>
                                <div class="table-copy">${this.formatDate(item.created_at, { includeTime: true })}</div>
                            </div>
                        `
                    )
                    .join("");
            } catch (error) {
                console.error("Не удалось загрузить уведомления в шапке", error);
            }
        },

        connectWebSocket() {
            const token = this.getToken();
            if (!token || !this.state.user) return;
            if (this.state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.state.ws.readyState)) {
                return;
            }

            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const socketUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

            try {
                this.state.ws = new WebSocket(socketUrl);
            } catch (error) {
                console.error("Не удалось инициализировать WebSocket", error);
                return;
            }

            this.state.ws.onopen = () => {
                this.state.wsAttempts = 0;
            };

            this.state.ws.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSocketEvent(data);
                } catch (error) {
                    console.error("Ошибка обработки WebSocket-сообщения", error);
                }
            };

            this.state.ws.onclose = () => {
                this.state.ws = null;
                if (!this.isAuthenticated() || !this.state.user) return;
                if (this.state.wsAttempts >= 5) return;
                this.state.wsAttempts += 1;
                window.setTimeout(() => this.connectWebSocket(), 1600 * this.state.wsAttempts);
            };
        },

        async handleSocketEvent(payload) {
            if (!payload || !payload.type) return;

            if (payload.type === "new_notification" && payload.notification) {
                this.toast(payload.notification.title || "Новое уведомление", "info");
                await this.loadHeaderNotifications();
                return;
            }

            if (payload.type === "payment_status") {
                this.toast(
                    `Платёж #${payload.payment_id}: ${payload.status}`,
                    payload.status === "succeeded" ? "success" : "warning"
                );
                return;
            }

            if (payload.type === "ticket_update") {
                this.toast(`Заявка #${payload.ticket_id}: ${payload.action}`, "info");
                return;
            }

            if (payload.type === "ticket_escalated") {
                this.toast(`Заявка #${payload.ticket_id} требует ускоренной обработки`, "warning");
                return;
            }

            if (payload.type === "monitoring_alert_created" && payload.alert) {
                this.toast(payload.alert.message || "Обнаружено ухудшение качества связи", "warning");
                await this.loadHeaderNotifications();
                return;
            }

            if (payload.type === "monitoring_alert_resolved" && payload.alert) {
                this.toast("Качество соединения восстановилось", "success");
                await this.loadHeaderNotifications();
                return;
            }

            if (payload.type === "new_ticket") {
                this.toast(`Новая заявка #${payload.ticket_id}`, "info");
            }
        },

        notificationIcon(notification = {}) {
            const iconMap = {
                critical: "fa-triangle-exclamation",
                warning: "fa-bell",
                resolved: "fa-circle-check",
                maintenance: "fa-screwdriver-wrench",
                info: "fa-circle-info",
                payment: "fa-credit-card",
            };
            return iconMap[notification.event_type] || "fa-bell";
        },

        notificationTone(notification = {}) {
            const toneMap = {
                critical: "danger",
                warning: "warning",
                resolved: "success",
                maintenance: "primary",
                info: "neutral",
                payment: "warning",
            };
            return toneMap[notification.event_type] || notification.color || "neutral";
        },

        setUnreadBadge(count = 0) {
            const unreadBadge = document.getElementById("headerUnreadBadge");
            this.state.unreadCount = Number(count || 0);
            if (!unreadBadge) return;
            unreadBadge.hidden = this.state.unreadCount <= 0;
            unreadBadge.textContent = this.state.unreadCount > 99 ? "99+" : String(this.state.unreadCount);
        },

        renderHeaderNotifications() {
            const list = document.getElementById("headerNotificationsList");
            if (!list) return;

            const notifications = this.state.notifications || [];
            if (!notifications.length) {
                list.innerHTML = `
                    <div class="dropdown-item notification-dropdown-empty">
                        <div class="table-copy">Новых уведомлений пока нет.</div>
                    </div>
                `;
                return;
            }

            list.innerHTML = notifications
                .map(
                    (item) => `
                        <article class="dropdown-item notification-dropdown-item ${item.is_read ? "is-read" : "is-unread"}">
                            <div class="notification-dropdown-mark is-${this.notificationTone(item)}">
                                <i class="fas ${this.notificationIcon(item)}"></i>
                            </div>
                            <div class="notification-dropdown-copy">
                                <div class="table-title">${this.escapeHTML(item.title)}</div>
                                <div class="table-copy">${this.escapeHTML(item.message || item.body || "")}</div>
                                <div class="notification-dropdown-meta">
                                    <span>${this.formatDate(item.created_at, { includeTime: true })}</span>
                                    ${item.priority_label ? `<span class="badge badge-neutral">${this.escapeHTML(item.priority_label)}</span>` : ""}
                                </div>
                            </div>
                            <div class="notification-dropdown-actions">
                                ${
                                    item.action_url
                                        ? `<a class="btn btn-secondary btn-xs" href="${this.escapeHTML(item.action_url)}">Открыть</a>`
                                        : ""
                                }
                                ${
                                    item.is_read
                                        ? ""
                                        : `<button class="btn btn-secondary btn-xs" type="button" onclick="OperatorUI.markNotificationRead(${item.id}, { silent: true })">Прочитано</button>`
                                }
                            </div>
                        </article>
                    `
                )
                .join("");
        },

        async loadHeaderNotifications() {
            if (!this.isAuthenticated()) return;

            try {
                const payload = await this.request("/api/v1/notifications/?page=1&limit=6", { auth: true });
                this.state.notifications = payload.items || [];
                this.setUnreadBadge(payload.unread_count || 0);
                this.renderHeaderNotifications();
            } catch (error) {
                console.error("Не удалось загрузить уведомления в шапке", error);
            }
        },

        async loadUnreadNotificationCount() {
            if (!this.isAuthenticated()) return 0;
            try {
                const payload = await this.request("/api/v1/notifications/unread/count", { auth: true });
                this.setUnreadBadge(payload.unread_count || 0);
                return payload.unread_count || 0;
            } catch (error) {
                if (error?.status === 401 || error?.message === "AUTH_REQUIRED") {
                    this.clearAuthState();
                    this.syncHeaderNavLinks(false);
                    this.syncAuthChrome().catch(() => {});
                    return 0;
                }
                console.error("Не удалось обновить бейдж уведомлений", error);
                return this.state.unreadCount || 0;
            }
        },

        async markNotificationRead(notificationId, options = {}) {
            try {
                await this.request(`/api/v1/notifications/${notificationId}/read`, {
                    method: "POST",
                    auth: true,
                });
                if (!options.skipRefresh) {
                    await this.loadHeaderNotifications();
                }
                document.dispatchEvent(
                    new CustomEvent("mtn:notification-read", { detail: { notificationId: Number(notificationId) } })
                );
                if (!options.silent) {
                    this.toast("Уведомление отмечено как прочитанное.", "success");
                }
            } catch (error) {
                if (!options.silent) {
                    this.toast(error.message || "Не удалось отметить уведомление.", "error");
                }
            }
        },

        async markAllNotificationsRead(options = {}) {
            try {
                await this.request("/api/v1/notifications/read-all", {
                    method: "POST",
                    auth: true,
                });
                await this.loadHeaderNotifications();
                document.dispatchEvent(new CustomEvent("mtn:notifications-read-all"));
                if (!options.silent) {
                    this.toast("Все уведомления отмечены как прочитанные.", "success");
                }
            } catch (error) {
                if (!options.silent) {
                    this.toast(error.message || "Не удалось обновить уведомления.", "error");
                }
            }
        },

        startNotificationPolling() {
            this.stopNotificationPolling();
            if (!this.isAuthenticated()) return;
            const interval = Number(document.body?.dataset?.notificationsPolling || 45000);
            this.state.notificationPollTimer = window.setInterval(async () => {
                if (!this.isAuthenticated()) {
                    this.stopNotificationPolling();
                    return;
                }
                const previousCount = Number(this.state.unreadCount || 0);
                const nextCount = await this.loadUnreadNotificationCount();
                if (nextCount !== previousCount) {
                    await this.loadHeaderNotifications();
                    if (nextCount > previousCount) {
                        document.dispatchEvent(
                            new CustomEvent("mtn:notification-created", {
                                detail: {
                                    previousCount,
                                    unreadCount: nextCount,
                                    source: "polling",
                                },
                            })
                        );
                    }
                }
            }, Math.max(interval, 15000));
        },

        stopNotificationPolling() {
            if (this.state.notificationPollTimer) {
                window.clearInterval(this.state.notificationPollTimer);
                this.state.notificationPollTimer = null;
            }
        },

        async registerNotificationServiceWorker() {
            if (!("serviceWorker" in navigator) || !this.isAuthenticated()) return null;

            try {
                const registration = await navigator.serviceWorker.register("/sw.js");
                this.state.serviceWorkerRegistration = registration;
                return registration;
            } catch (error) {
                console.warn("Не удалось зарегистрировать service worker", error);
                return null;
            }
        },

        urlBase64ToUint8Array(base64String) {
            const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
            const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let index = 0; index < rawData.length; index += 1) {
                outputArray[index] = rawData.charCodeAt(index);
            }
            return outputArray;
        },

        async subscribeBrowserPush() {
            if (!this.isAuthenticated()) {
                throw new Error("AUTH_REQUIRED");
            }
            if (!("Notification" in window) || !("serviceWorker" in navigator)) {
                throw new Error("Браузер не поддерживает push-уведомления");
            }

            const registration = this.state.serviceWorkerRegistration || (await this.registerNotificationServiceWorker());
            if (!registration) {
                throw new Error("Не удалось зарегистрировать service worker");
            }

            const settings = await this.request("/api/v1/notifications/settings", { auth: true });
            if (!settings.push_supported || !settings.vapid_public_key) {
                throw new Error("Push-уведомления пока недоступны на сервере");
            }

            let permission = Notification.permission;
            if (permission !== "granted") {
                permission = await Notification.requestPermission();
            }
            if (permission !== "granted") {
                throw new Error("Браузер не выдал разрешение на push-уведомления");
            }

            const existingSubscription = await registration.pushManager.getSubscription();
            const subscription =
                existingSubscription ||
                (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this.urlBase64ToUint8Array(settings.vapid_public_key),
                }));

            await this.request("/api/v1/notifications/subscribe/push", {
                method: "POST",
                auth: true,
                json: true,
                body: subscription.toJSON(),
            });
            return subscription;
        },

        async unsubscribeBrowserPush() {
            const registration = this.state.serviceWorkerRegistration || (await this.registerNotificationServiceWorker());
            if (!registration) {
                return 0;
            }

            const subscription = await registration.pushManager.getSubscription();
            let endpoint = null;
            if (subscription) {
                endpoint = subscription.endpoint;
                await subscription.unsubscribe();
            }

            await this.request("/api/v1/notifications/subscribe/push", {
                method: "DELETE",
                auth: true,
                json: true,
                body: { endpoint },
            });
            return 1;
        },

        connectWebSocket() {
            const token = this.getToken();
            if (!token || !this.state.user) return;
            if (this.state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.state.ws.readyState)) {
                return;
            }

            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const socketUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

            try {
                this.state.ws = new WebSocket(socketUrl);
            } catch (error) {
                console.error("Не удалось инициализировать WebSocket", error);
                return;
            }

            this.state.ws.onopen = () => {
                this.state.wsAttempts = 0;
            };

            this.state.ws.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    await this.handleSocketEvent(data);
                } catch (error) {
                    console.error("Ошибка обработки WebSocket-сообщения", error);
                }
            };

            this.state.ws.onclose = () => {
                this.state.ws = null;
                if (!this.isAuthenticated() || !this.state.user) return;
                if (this.state.wsAttempts >= 5) return;
                this.state.wsAttempts += 1;
                window.setTimeout(() => this.connectWebSocket(), 1600 * this.state.wsAttempts);
            };
        },

        async handleSocketEvent(payload) {
            if (!payload || !payload.type) return;

            if (payload.type === "unread_count") {
                this.setUnreadBadge(payload.count || 0);
                return;
            }

            if (payload.type === "new_notification" && payload.notification) {
                this.toast(payload.notification.title || "Новое уведомление", this.notificationTone(payload.notification));
                if (typeof payload.unread_count === "number") {
                    this.setUnreadBadge(payload.unread_count);
                }
                await this.loadHeaderNotifications();
                document.dispatchEvent(
                    new CustomEvent("mtn:notification-created", { detail: { notification: payload.notification } })
                );
                return;
            }

            if (payload.type === "payment_status") {
                this.toast(
                    `Платёж #${payload.payment_id}: ${payload.status}`,
                    payload.status === "succeeded" ? "success" : "warning"
                );
                return;
            }

            if (payload.type === "ticket_update") {
                this.toast(`Заявка #${payload.ticket_id}: ${payload.action}`, "info");
                return;
            }

            if (payload.type === "ticket_escalated") {
                this.toast(`Заявка #${payload.ticket_id} требует ускоренной обработки`, "warning");
                return;
            }

            if (payload.type === "monitoring_alert_created" && payload.alert) {
                this.toast(payload.alert.message || "Обнаружено ухудшение качества связи", "warning");
                return;
            }

            if (payload.type === "monitoring_alert_resolved" && payload.alert) {
                this.toast("Качество соединения восстановилось", "success");
                return;
            }

            if (payload.type === "new_ticket") {
                this.toast(`Новая заявка #${payload.ticket_id}`, "info");
            }
        },

        renderAuthRequired(target, options = {}) {
            if (!target) return;
            target.innerHTML = `
                <section class="scene-section scene-auth-gate" data-scene="auth-gate">
                    <div class="empty-state">
                        <div class="empty-icon"><i class="fas fa-lock"></i></div>
                        <h3>${this.escapeHTML(options.title || "Требуется вход в аккаунт")}</h3>
                        <p>${this.escapeHTML(options.message || "Авторизуйтесь, чтобы открыть этот раздел и работать с данными лицевого счёта.")}</p>
                        <div class="action-row" style="justify-content:center;">
                            <a class="btn btn-primary" href="/login"><i class="fas fa-sign-in-alt"></i>Войти</a>
                            <a class="btn btn-secondary" href="/register"><i class="fas fa-user-plus"></i>Регистрация</a>
                        </div>
                    </div>
                </section>
            `;
        },

        renderRoleRequired(target, options = {}) {
            if (!target) return;
            target.innerHTML = `
                <section class="scene-section scene-auth-gate" data-scene="role-gate">
                    <div class="empty-state">
                        <div class="empty-icon"><i class="fas fa-shield-halved"></i></div>
                        <h3>${this.escapeHTML(options.title || "Раздел доступен только сотрудникам MTN")}</h3>
                        <p>${this.escapeHTML(options.message || "Текущий аккаунт не имеет служебных прав. Войдите под ролью оператора или администратора, чтобы работать с внутренними данными и инструментами MTN.")}</p>
                        <div class="action-row" style="justify-content:center;">
                            <a class="btn btn-primary" href="/login"><i class="fas fa-user-shield"></i>Войти под сотрудником</a>
                            <a class="btn btn-secondary" href="/"><i class="fas fa-house"></i>На главную</a>
                        </div>
                    </div>
                </section>
            `;
        },

        async ensureAdminAccess(target, options = {}) {
            if (!this.isAuthenticated()) {
                this.renderAuthRequired(target, options.authOptions || {});
                return null;
            }

            try {
                const user = await this.getCurrentUser();
                if (!this.isStaffRole(user.role)) {
                    this.renderRoleRequired(target, options.roleOptions || {});
                    return null;
                }
                return user;
            } catch (error) {
                if (error?.status === 401 || error?.message === "AUTH_REQUIRED") {
                    this.renderAuthRequired(target, options.authOptions || {});
                    return null;
                }

                if (error?.status === 403) {
                    this.renderRoleRequired(target, options.roleOptions || {});
                    return null;
                }

                if (target) {
                    target.innerHTML = this.createEmptyState(
                        "fas fa-triangle-exclamation",
                        options.errorTitle || "Не удалось открыть раздел",
                        error.message || "Попробуйте обновить страницу или повторить вход позже."
                    );
                }
                return null;
            }
        },

        createEmptyState(icon, title, message) {
            return `
                <div class="empty-state">
                    <div class="empty-icon"><i class="${icon}"></i></div>
                    <h3>${this.escapeHTML(title)}</h3>
                    <p>${this.escapeHTML(message)}</p>
                </div>
            `;
        },

        showDemoSms(target, payload = {}) {
            const panel = typeof target === "string" ? document.getElementById(target) : target;
            if (!panel) return;

            const code = payload.demo_sms_code || payload.demo_email_code || payload.code;
            const phone =
                payload.demo_sms_phone ||
                payload.demo_email_address ||
                payload.verification_target ||
                payload.phone ||
                payload.email ||
                "";
            const ttl = payload.demo_sms_ttl || payload.demo_email_ttl || payload.verification_expires_in || 300;

            if (!code) {
                panel.hidden = true;
                panel.classList.remove("is-visible");
                return;
            }

            const codeNode = panel.querySelector("[data-demo-code]");
            const phoneNode = panel.querySelector("[data-demo-phone]");
            const ttlNode = panel.querySelector("[data-demo-ttl]");

            if (codeNode) codeNode.textContent = code;
            if (phoneNode) phoneNode.textContent = phone;
            if (ttlNode) ttlNode.textContent = `${Math.round(ttl / 60)} мин`;

            panel.hidden = false;
            panel.classList.add("is-visible");
        },
    };

    window.OperatorUI = OperatorUI;
    window.showToast = (message, type, title) => OperatorUI.toast(message, type, title);
    window.openModal = (id) => OperatorUI.openModal(id);
    window.closeModal = (id) => OperatorUI.closeModal(id);

    document.addEventListener("DOMContentLoaded", () => OperatorUI.init());
})();
