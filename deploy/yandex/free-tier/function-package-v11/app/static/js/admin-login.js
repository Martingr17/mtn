(function () {
    // Отдельный сценарий входа сотрудников в административную панель.
    const ui = window.OperatorUI;
    const config = window.MTN_ADMIN_AUTH_CONFIG || {};
    const aliases = Array.isArray(config.demoStaffAliases) ? config.demoStaffAliases : [];

    const elements = {
        identifier: document.getElementById("adminLoginIdentifier"),
        password: document.getElementById("adminLoginPassword"),
        totpGroup: document.getElementById("adminTotpGroup"),
        totpCode: document.getElementById("adminTotpCode"),
        loginButton: document.getElementById("adminLoginButton"),
        togglePassword: document.getElementById("adminTogglePassword"),
        statusBox: document.getElementById("adminLoginStatusBox"),
        statusTitle: document.getElementById("adminLoginStatusTitle"),
        statusCopy: document.getElementById("adminLoginStatusCopy"),
        identifierError: document.getElementById("adminIdentifierError"),
        passwordError: document.getElementById("adminPasswordError"),
        totpError: document.getElementById("adminTotpError"),
    };

    const state = {
        pendingTwoFactorToken: "",
        resolvedPhone: "",
    };

    function sanitizeRedirect(path, fallback) {
        const candidate = typeof path === "string" ? path.trim() : "";
        if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
            return fallback;
        }
        return candidate.startsWith("/admin") ? candidate : fallback;
    }

    function normalizePhone(value) {
        let digits = String(value || "").replace(/\D/g, "");
        if (!digits) return "";
        if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
        if (digits.startsWith("9")) digits = `7${digits}`;
        if (!digits.startsWith("7")) digits = `7${digits}`;
        return `+${digits.slice(0, 11)}`;
    }

    function setFieldError(errorNode, inputNode, message) {
        if (!errorNode || !inputNode) return;
        errorNode.hidden = !message;
        errorNode.textContent = message || "";
        inputNode.setAttribute("aria-invalid", message ? "true" : "false");
    }

    function setStatus(title, copy, variant = "") {
        if (!elements.statusBox) return;
        elements.statusBox.classList.remove("mtn-auth-status--success", "mtn-auth-status--warning", "mtn-auth-status--danger");
        if (variant) {
            elements.statusBox.classList.add(`mtn-auth-status--${variant}`);
        }
        elements.statusBox.classList.add("is-visible");
        elements.statusTitle.textContent = title;
        elements.statusCopy.textContent = copy;
    }

    // В демо-режиме email-алиасы приводим к внутренним тестовым телефонам и паролям.
    function resolveAlias(identifier, password) {
        const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
        const entry = aliases.find((item) => item.email.toLowerCase() === normalizedIdentifier);
        if (!entry) return null;
        if (password !== entry.password) return { error: "Неверный пароль для демо-алиаса." };
        return { phone: entry.phone, password: entry.actual_password };
    }

    async function hydrateAndStoreSession(payload, phone) {
        localStorage.setItem("access_token", payload.access_token);
        localStorage.setItem("refresh_token", payload.refresh_token);
        localStorage.setItem("user_id", String(payload.user_id));
        localStorage.setItem("mtn_token", payload.access_token);

        let profile = {
            id: payload.user_id,
            role: payload.role,
            phone,
            name: "Сотрудник MTN",
        };

        try {
            profile = await ui.request("/api/v1/users/me", { auth: true });
        } catch (error) {
            // Фолбэк остаётся рабочим даже если профиль недоступен.
        }

        localStorage.setItem("mtn_user", JSON.stringify(profile));
        if (ui?.setServerAuthenticated) {
            ui.setServerAuthenticated(true);
        }
    }

    async function handleLogin() {
        const identifier = String(elements.identifier?.value || "").trim();
        const password = String(elements.password?.value || "").trim();
        const totpCode = String(elements.totpCode?.value || "").trim();

        setFieldError(elements.identifierError, elements.identifier, "");
        setFieldError(elements.passwordError, elements.password, "");
        setFieldError(elements.totpError, elements.totpCode, "");

        if (!identifier) {
            setFieldError(elements.identifierError, elements.identifier, "Введите email или телефон.");
            return;
        }

        if (!password) {
            setFieldError(elements.passwordError, elements.password, "Введите пароль.");
            return;
        }

        try {
            ui.setButtonLoading(elements.loginButton, true, state.pendingTwoFactorToken ? "Подтверждение..." : "Вход...");

            if (state.pendingTwoFactorToken) {
                if (!/^\d{6}$/.test(totpCode)) {
                    setFieldError(elements.totpError, elements.totpCode, "Введите 6 цифр из приложения.");
                    return;
                }

                const payload = await ui.request("/api/v1/auth/2fa/login", {
                    method: "POST",
                    json: true,
                    body: {
                        two_factor_token: state.pendingTwoFactorToken,
                        totp_code: totpCode,
                    },
                });

                await hydrateAndStoreSession(payload, state.resolvedPhone);
                ui.toast("Вход в админ-панель выполнен.", "success");
                window.location.href = sanitizeRedirect(config.next, "/admin/dashboard");
                return;
            }

            const alias = resolveAlias(identifier, password);
            if (alias?.error) {
                throw new Error(alias.error);
            }

            const phone = alias?.phone || normalizePhone(identifier);
            const realPassword = alias?.password || password;

            if (!phone) {
                throw new Error("Введите корректный email-алиас или номер телефона.");
            }

            const payload = await ui.request("/api/v1/auth/login", {
                method: "POST",
                json: true,
                body: {
                    phone,
                    password: realPassword,
                },
            });

            state.resolvedPhone = phone;

            if (payload.requires_2fa) {
                state.pendingTwoFactorToken = payload.two_factor_token || "";
                elements.totpGroup?.classList.remove("mtn-auth-hidden");
                setStatus("Нужен код 2FA", "Введите код из приложения-аутентификатора, чтобы завершить вход.", "warning");
                elements.totpCode?.focus();
                return;
            }

            await hydrateAndStoreSession(payload, phone);
            ui.toast("Вход в админ-панель выполнен.", "success");
            window.location.href = sanitizeRedirect(config.next, "/admin/dashboard");
        } catch (error) {
            setStatus("Войти не удалось", error.message || "Проверьте данные и попробуйте снова.", "danger");
            ui.toast(error.message || "Не удалось выполнить вход.", "error");
        } finally {
            ui.setButtonLoading(elements.loginButton, false);
        }
    }

    function bindDemoFillButtons() {
        document.querySelectorAll("[data-fill-admin-demo]").forEach((button) => {
            button.addEventListener("click", () => {
                if (elements.identifier) {
                    elements.identifier.value = button.dataset.identifier || "";
                }
                if (elements.password) {
                    elements.password.value = button.dataset.password || "";
                }
                setStatus("Демо-данные подставлены", "Можно сразу нажать кнопку входа.", "success");
            });
        });
    }

    function bindPasswordToggle() {
        if (!elements.togglePassword || !elements.password) return;
        elements.togglePassword.addEventListener("click", () => {
            const isPassword = elements.password.type === "password";
            elements.password.type = isPassword ? "text" : "password";
            elements.togglePassword.innerHTML = `<i class="fas fa-${isPassword ? "eye-slash" : "eye"}" aria-hidden="true"></i>`;
        });
    }

    function init() {
        if (!ui || !elements.identifier || !elements.loginButton) return;
        elements.loginButton.addEventListener("click", handleLogin);
        bindDemoFillButtons();
        bindPasswordToggle();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
