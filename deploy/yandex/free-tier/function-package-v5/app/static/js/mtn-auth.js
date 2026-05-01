(function () {
    // Клиентская логика общей страницы авторизации абонента:
    // SMS-вход, вход по паролю, регистрация и восстановление доступа.
    const ui = window.OperatorUI;
    const config = window.MTN_AUTH_CONFIG || {};
    const isDemoMode = config.demoMode === true || config.demoMode === "true";
    const ATTEMPT_STORAGE_KEY = "mtn_auth_attempts";
    const REMEMBERED_PHONE_KEY = "mtn_login_phone";

    const elements = {
        loginPhone: document.getElementById("loginPhone"),
        rememberPhone: document.getElementById("rememberPhone"),
        sendCodeButton: document.getElementById("sendCodeButton"),
        sendCodeTimer: document.getElementById("sendCodeTimer"),
        smsCodeField: document.getElementById("smsCodeField"),
        loginSmsCode: document.getElementById("loginSmsCode"),
        loginByCodeButton: document.getElementById("loginByCodeButton"),
        loginPassword: document.getElementById("loginPassword"),
        loginByPasswordButton: document.getElementById("loginByPasswordButton"),
        togglePasswordButton: document.getElementById("togglePasswordButton"),
        loginStatusBox: document.getElementById("loginStatusBox"),
        loginStatusTitle: document.getElementById("loginStatusTitle"),
        loginStatusCopy: document.getElementById("loginStatusCopy"),
        loginPhoneError: document.getElementById("loginPhoneError"),
        loginCodeError: document.getElementById("loginCodeError"),
        loginPasswordError: document.getElementById("loginPasswordError"),
        loginDemoPanel: document.getElementById("loginDemoPanel"),
        demoPhoneLabel: document.getElementById("demoPhoneLabel"),
        demoSmsCodeValue: document.getElementById("demoSmsCodeValue"),
        demoSmsTtl: document.getElementById("demoSmsTtl"),
        copyDemoCodeButton: document.getElementById("copyDemoCodeButton"),
        registerPhone: document.getElementById("registerPhone"),
        registerActionButton: document.getElementById("registerActionButton"),
        registerPhoneError: document.getElementById("registerPhoneError"),
        registerCodeGroup: document.getElementById("registerCodeGroup"),
        registerCode: document.getElementById("registerCode"),
        registerCodeError: document.getElementById("registerCodeError"),
        registerPasswordGroup: document.getElementById("registerPasswordGroup"),
        registerPassword: document.getElementById("registerPassword"),
        registerBillingId: document.getElementById("registerBillingId"),
        registerStatusBox: document.getElementById("registerStatusBox"),
        registerStatusTitle: document.getElementById("registerStatusTitle"),
        registerStatusCopy: document.getElementById("registerStatusCopy"),
        registerDemoPanel: document.getElementById("registerDemoPanel"),
        registerDemoCode: document.getElementById("registerDemoCode"),
        registerCopyCodeButton: document.getElementById("registerCopyCodeButton"),
        recoveryPhone: document.getElementById("recoveryPhone"),
        recoveryActionButton: document.getElementById("recoveryActionButton"),
        recoveryPhoneError: document.getElementById("recoveryPhoneError"),
        recoveryCodeGroup: document.getElementById("recoveryCodeGroup"),
        recoveryCode: document.getElementById("recoveryCode"),
        recoveryCodeError: document.getElementById("recoveryCodeError"),
        recoveryPasswordGroup: document.getElementById("recoveryPasswordGroup"),
        recoveryNewPassword: document.getElementById("recoveryNewPassword"),
        recoveryPasswordError: document.getElementById("recoveryPasswordError"),
        recoveryStatusBox: document.getElementById("recoveryStatusBox"),
        recoveryStatusTitle: document.getElementById("recoveryStatusTitle"),
        recoveryStatusCopy: document.getElementById("recoveryStatusCopy"),
        recoveryDemoPanel: document.getElementById("recoveryDemoPanel"),
        recoveryDemoCode: document.getElementById("recoveryDemoCode"),
        recoveryCopyCodeButton: document.getElementById("recoveryCopyCodeButton"),
    };

    const state = {
        login: {
            timerId: null,
            demoCode: "123456",
            demoPhone: config.demoPhone || "",
        },
        register: {
            step: 1,
            phone: "",
            demoCode: "",
        },
        recovery: {
            step: 1,
            phone: "",
            demoCode: "",
        },
    };

    function digitsOnly(value) {
        return String(value || "").replace(/\D/g, "");
    }

    function normalizePhone(value) {
        let digits = digitsOnly(value);
        if (!digits) return "";
        if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
        if (digits.startsWith("9")) digits = `7${digits}`;
        if (!digits.startsWith("7")) digits = `7${digits}`;
        return `+${digits.slice(0, 11)}`;
    }

    function formatPhone(value) {
        let digits = digitsOnly(value);
        if (!digits) return "";
        if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
        if (digits.startsWith("9")) digits = `7${digits}`;
        if (!digits.startsWith("7")) digits = `7${digits}`;
        digits = digits.slice(0, 11);

        const country = digits[0] || "7";
        const part1 = digits.slice(1, 4);
        const part2 = digits.slice(4, 7);
        const part3 = digits.slice(7, 9);
        const part4 = digits.slice(9, 11);

        let result = `+${country}`;
        if (part1) result += ` (${part1}`;
        if (part1.length === 3) result += ")";
        if (part2) result += ` ${part2}`;
        if (part3) result += `-${part3}`;
        if (part4) result += `-${part4}`;
        return result;
    }

    function isValidPhone(value) {
        return /^\+7\d{10}$/.test(normalizePhone(value));
    }

    function generateDemoCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    function sanitizeRedirect(path, fallback) {
        const candidate = typeof path === "string" ? path.trim() : "";
        if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
            return fallback;
        }
        return candidate;
    }

    function isStaffRole(role) {
        return ["admin", "operator", "super_admin"].includes(String(role || "").toLowerCase());
    }

    function setFieldError(errorNode, inputNode, message) {
        if (!errorNode || !inputNode) return;
        if (!message) {
            errorNode.hidden = true;
            errorNode.textContent = "";
            inputNode.setAttribute("aria-invalid", "false");
            return;
        }
        errorNode.hidden = false;
        errorNode.textContent = message;
        inputNode.setAttribute("aria-invalid", "true");
    }

    function setStatus(box, titleNode, copyNode, title, copy, variant = "") {
        if (!box || !titleNode || !copyNode) return;
        box.classList.remove("mtn-auth-status--success", "mtn-auth-status--warning", "mtn-auth-status--danger");
        if (variant) box.classList.add(`mtn-auth-status--${variant}`);
        box.classList.add("is-visible");
        titleNode.textContent = title;
        copyNode.textContent = copy;
    }

    function updateStepState(selector, step) {
        document.querySelectorAll(selector).forEach((node) => {
            const nodeStep = Number(node.dataset.registerStep || 0);
            node.classList.toggle("is-active", nodeStep === step);
            node.classList.toggle("is-complete", nodeStep < step);
        });
    }

    function saveRememberedPhone() {
        if (!elements.loginPhone || !elements.rememberPhone) return;
        const phone = formatPhone(elements.loginPhone.value);
        if (elements.rememberPhone.checked && phone) {
            localStorage.setItem(REMEMBERED_PHONE_KEY, phone);
        } else {
            localStorage.removeItem(REMEMBERED_PHONE_KEY);
        }
    }

    function loadRememberedPhone() {
        const remembered = localStorage.getItem(REMEMBERED_PHONE_KEY);
        if (remembered && elements.loginPhone) {
            elements.loginPhone.value = formatPhone(remembered);
            if (elements.rememberPhone) {
                elements.rememberPhone.checked = true;
            }
        }
    }

    function getAttemptsState() {
        try {
            return JSON.parse(localStorage.getItem(ATTEMPT_STORAGE_KEY) || "{}");
        } catch (error) {
            return {};
        }
    }

    function setAttemptsState(payload) {
        localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(payload));
    }

    function getScopeAttempts(scope, phone) {
        const all = getAttemptsState();
        return all[scope]?.[phone] || { count: 0, blockedUntil: 0 };
    }

    function resetScopeAttempts(scope, phone) {
        const all = getAttemptsState();
        if (all[scope]?.[phone]) {
            delete all[scope][phone];
            setAttemptsState(all);
        }
    }

    function registerAttemptFailure(scope, phone) {
        const all = getAttemptsState();
        all[scope] = all[scope] || {};
        const current = all[scope][phone] || { count: 0, blockedUntil: 0 };
        current.count += 1;
        if (current.count >= 5) {
            current.blockedUntil = Date.now() + 5 * 60 * 1000;
            current.count = 0;
        }
        all[scope][phone] = current;
        setAttemptsState(all);
    }

    function ensureNotBlocked(scope, phone) {
        const current = getScopeAttempts(scope, phone);
        if (current.blockedUntil && current.blockedUntil > Date.now()) {
            const seconds = Math.ceil((current.blockedUntil - Date.now()) / 1000);
            throw new Error(`Слишком много попыток. Повторите через ${seconds} сек.`);
        }
    }

    async function copyText(value) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch (error) {
            return false;
        }
    }

    async function hydrateUserProfile(fallback) {
        try {
            return await ui.request("/api/v1/users/me", { auth: true });
        } catch (error) {
            return fallback;
        }
    }

    // Если профиль пользователя ещё не удалось загрузить, сохраняем минимальный объект,
    // чтобы остальные части интерфейса могли отработать предсказуемо.
    function buildFallbackUser(payload, phone) {
        return {
            id: payload.user_id,
            phone,
            role: payload.role,
            name: isStaffRole(payload.role) ? "Сотрудник MTN" : "Абонент MTN",
        };
    }

    async function storeSession(payload, phone) {
        localStorage.setItem("access_token", payload.access_token);
        localStorage.setItem("refresh_token", payload.refresh_token);
        localStorage.setItem("user_id", String(payload.user_id));
        localStorage.setItem("mtn_token", payload.access_token);

        const fallbackUser = buildFallbackUser(payload, phone);
        const profile = await hydrateUserProfile(fallbackUser);
        localStorage.setItem("mtn_user", JSON.stringify(profile || fallbackUser));
    }

    function resolveLoginRedirect(role, explicitNext) {
        const defaultPath = isStaffRole(role) ? "/admin/dashboard" : "/dashboard";
        const nextPath = sanitizeRedirect(explicitNext || config.next, defaultPath);
        if (isStaffRole(role)) {
            return nextPath.startsWith("/admin") ? nextPath : "/admin/dashboard";
        }
        return nextPath.startsWith("/admin") ? "/dashboard" : nextPath;
    }

    async function finalizeLogin(payload, phone, explicitNext) {
        await storeSession(payload, phone);
        if (ui?.setServerAuthenticated) {
            ui.setServerAuthenticated(true);
        }
        saveRememberedPhone();
        ui.toast("Вход выполнен успешно.", "success");
        window.location.href = resolveLoginRedirect(payload.role, explicitNext);
    }

    function updateDemoPanel(phone, code, ttlLabel) {
        state.login.demoPhone = formatPhone(phone || config.demoPhone || "");
        state.login.demoCode = code || state.login.demoCode || generateDemoCode();

        if (elements.demoPhoneLabel) elements.demoPhoneLabel.textContent = state.login.demoPhone || "—";
        if (elements.demoSmsCodeValue) elements.demoSmsCodeValue.textContent = state.login.demoCode;
        if (elements.demoSmsTtl) elements.demoSmsTtl.textContent = ttlLabel || "5 мин";
    }

    function updateDemoCodeForCurrentPhone(force = false) {
        const phone = formatPhone(elements.loginPhone?.value || config.demoPhone || "");
        if (!isDemoMode) return;
        if (force || phone !== state.login.demoPhone) {
            updateDemoPanel(phone, generateDemoCode(), "5 мин");
        }
    }

    function applyPhoneMask(input) {
        if (!input) return;
        input.addEventListener("input", () => {
            const positionFromEnd = input.value.length - input.selectionStart;
            input.value = formatPhone(input.value);
            const nextPosition = Math.max(0, input.value.length - positionFromEnd);
            window.requestAnimationFrame(() => input.setSelectionRange(nextPosition, nextPosition));
        });
    }

    function startSendTimer(seconds) {
        window.clearInterval(state.login.timerId);
        let remaining = seconds;
        if (elements.sendCodeButton) {
            elements.sendCodeButton.disabled = true;
        }

        const render = () => {
            if (elements.sendCodeTimer) {
                elements.sendCodeTimer.textContent = remaining > 0 ? `Отправить код можно через ${remaining} сек.` : "";
            }
            if (remaining <= 0 && elements.sendCodeButton) {
                elements.sendCodeButton.disabled = false;
            }
        };

        render();
        state.login.timerId = window.setInterval(() => {
            remaining -= 1;
            render();
            if (remaining <= 0) {
                window.clearInterval(state.login.timerId);
            }
        }, 1000);
    }

    function prepareSmsLoginState(message, variant = "success") {
        elements.smsCodeField?.classList.remove("mtn-auth-hidden");
        setStatus(
            elements.loginStatusBox,
            elements.loginStatusTitle,
            elements.loginStatusCopy,
            "Код отправлен",
            message,
            variant
        );
    }

    // Единая отправка кода для обычного входа и для сценария после регистрации.
    async function sendLoginCodeWithPhone(phone) {
        const payload = await ui.request("/api/v1/auth/login", {
            method: "POST",
            json: true,
            body: { phone },
        });
        const code = payload.demo_sms_code || generateDemoCode();
        const ttlText = payload.demo_sms_ttl ? `${Math.round(payload.demo_sms_ttl / 60)} мин` : "5 мин";
        updateDemoPanel(phone, code, ttlText);
        prepareSmsLoginState(payload.message || "Код подтверждения уже отправлен. Введите его ниже.");
        startSendTimer(60);
        return payload;
    }

    async function handleSendCode() {
        const phone = normalizePhone(elements.loginPhone?.value);
        setFieldError(elements.loginPhoneError, elements.loginPhone, "");

        if (!isValidPhone(phone)) {
            setFieldError(elements.loginPhoneError, elements.loginPhone, "Введите корректный номер телефона.");
            return;
        }

        try {
            ensureNotBlocked("login", phone);
            ui.setButtonLoading(elements.sendCodeButton, true, "Отправка...");
            saveRememberedPhone();
            const payload = await sendLoginCodeWithPhone(phone);
            resetScopeAttempts("login", phone);
            ui.toast(payload.message || "Код отправлен.", "success");
            elements.loginSmsCode?.focus();
        } catch (error) {
            setStatus(
                elements.loginStatusBox,
                elements.loginStatusTitle,
                elements.loginStatusCopy,
                "Не удалось отправить код",
                error.message || "Попробуйте ещё раз позже.",
                "danger"
            );
            ui.toast(error.message || "Не удалось отправить код.", "error");
        } finally {
            ui.setButtonLoading(elements.sendCodeButton, false);
        }
    }

    async function handleSmsLogin() {
        const phone = normalizePhone(elements.loginPhone?.value);
        const code = String(elements.loginSmsCode?.value || "").trim();

        setFieldError(elements.loginPhoneError, elements.loginPhone, "");
        setFieldError(elements.loginCodeError, elements.loginSmsCode, "");

        if (!isValidPhone(phone)) {
            setFieldError(elements.loginPhoneError, elements.loginPhone, "Введите корректный номер телефона.");
            return;
        }

        if (!/^\d{6}$/.test(code)) {
            setFieldError(elements.loginCodeError, elements.loginSmsCode, "Код должен состоять из 6 цифр.");
            return;
        }

        try {
            ensureNotBlocked("login", phone);
            ui.setButtonLoading(elements.loginByCodeButton, true, "Проверка...");
            const payload = await ui.request("/api/v1/auth/login", {
                method: "POST",
                json: true,
                body: { phone, sms_code: code },
            });
            resetScopeAttempts("login", phone);
            await finalizeLogin(payload, phone);
        } catch (error) {
            registerAttemptFailure("login", phone);
            setFieldError(elements.loginCodeError, elements.loginSmsCode, error.message || "Неверный код подтверждения. Попробуйте ещё раз.");
            setStatus(
                elements.loginStatusBox,
                elements.loginStatusTitle,
                elements.loginStatusCopy,
                "Код не подошёл",
                error.message || "Проверьте код и попробуйте снова.",
                "danger"
            );
            ui.toast(error.message || "Неверный код подтверждения.", "error");
        } finally {
            ui.setButtonLoading(elements.loginByCodeButton, false);
        }
    }

    async function handlePasswordLogin() {
        const phone = normalizePhone(elements.loginPhone?.value);
        const password = String(elements.loginPassword?.value || "").trim();

        setFieldError(elements.loginPhoneError, elements.loginPhone, "");
        setFieldError(elements.loginPasswordError, elements.loginPassword, "");

        if (!isValidPhone(phone)) {
            setFieldError(elements.loginPhoneError, elements.loginPhone, "Введите корректный номер телефона.");
            return;
        }

        if (!password) {
            setFieldError(elements.loginPasswordError, elements.loginPassword, "Введите пароль.");
            return;
        }

        try {
            ui.setButtonLoading(elements.loginByPasswordButton, true, "Вход...");
            const payload = await ui.request("/api/v1/auth/login", {
                method: "POST",
                json: true,
                body: { phone, password },
            });

            if (payload.requires_2fa) {
                setStatus(
                    elements.loginStatusBox,
                    elements.loginStatusTitle,
                    elements.loginStatusCopy,
                    "Требуется 2FA",
                    "Для сотрудников с 2FA используйте отдельный вход в административную панель.",
                    "warning"
                );
                ui.toast("Для сотрудников с 2FA используйте вход администратора.", "warning");
                return;
            }

            await finalizeLogin(payload, phone);
        } catch (error) {
            setFieldError(elements.loginPasswordError, elements.loginPassword, error.message || "Не удалось выполнить вход по паролю.");
            ui.toast(error.message || "Не удалось выполнить вход по паролю.", "error");
        } finally {
            ui.setButtonLoading(elements.loginByPasswordButton, false);
        }
    }

    // Пошаговый сценарий регистрации внутри модального окна.
    function setRegisterStep(step) {
        state.register.step = step;
        updateStepState("[data-register-step]", step);
        elements.registerCodeGroup?.classList.toggle("mtn-auth-hidden", step < 2);
        elements.registerPasswordGroup?.classList.toggle("mtn-auth-hidden", step < 2);
        elements.registerDemoPanel?.classList.toggle("mtn-auth-hidden", step < 2);
        if (elements.registerActionButton) {
            elements.registerActionButton.textContent = step === 1 ? "Отправить код" : "Завершить регистрацию";
        }
    }

    function resetRegisterModal() {
        state.register.step = 1;
        state.register.phone = "";
        state.register.demoCode = "";
        if (elements.registerPhone) elements.registerPhone.value = "";
        if (elements.registerCode) elements.registerCode.value = "";
        if (elements.registerPassword) elements.registerPassword.value = "";
        if (elements.registerBillingId) elements.registerBillingId.value = config.demoBillingId || "";
        setFieldError(elements.registerPhoneError, elements.registerPhone, "");
        setFieldError(elements.registerCodeError, elements.registerCode, "");
        setRegisterStep(1);
        setStatus(
            elements.registerStatusBox,
            elements.registerStatusTitle,
            elements.registerStatusCopy,
            "Подготовка регистрации",
            "Введите номер телефона. Лицевой счёт в демо-режиме сформируется автоматически."
        );
    }

    function getRegisterBillingId(phone) {
        const normalized = normalizePhone(phone);
        const phoneDigits = digitsOnly(normalized).slice(-7);
        return config.demoBillingId || `DEMO${phoneDigits.padStart(7, "0")}`;
    }

    async function loginAfterRegistration(phone, password) {
        if (password) {
            const payload = await ui.request("/api/v1/auth/login", {
                method: "POST",
                json: true,
                body: { phone, password },
            });
            await finalizeLogin(payload, phone);
            return true;
        }

        const sent = await sendLoginCodeWithPhone(phone);
        if (isDemoMode && sent.demo_sms_code) {
            const payload = await ui.request("/api/v1/auth/login", {
                method: "POST",
                json: true,
                body: { phone, sms_code: sent.demo_sms_code },
            });
            await finalizeLogin(payload, phone);
            return true;
        }

        return false;
    }

    async function handleRegisterAction() {
        const phone = normalizePhone(elements.registerPhone?.value);
        const password = String(elements.registerPassword?.value || "").trim();
        const code = String(elements.registerCode?.value || "").trim();

        setFieldError(elements.registerPhoneError, elements.registerPhone, "");
        setFieldError(elements.registerCodeError, elements.registerCode, "");

        if (!isValidPhone(phone)) {
            setFieldError(elements.registerPhoneError, elements.registerPhone, "Введите корректный номер телефона.");
            return;
        }

        try {
            if (state.register.step === 1) {
                ui.setButtonLoading(elements.registerActionButton, true, "Отправка...");
                const payload = await ui.request("/api/v1/auth/register", {
                    method: "POST",
                    json: true,
                    body: {
                        phone,
                        billing_id: getRegisterBillingId(phone),
                        first_name: "Новый",
                        last_name: "Абонент",
                    },
                });

                state.register.phone = phone;
                state.register.demoCode = payload.demo_sms_code || generateDemoCode();
                if (elements.registerDemoCode) {
                    elements.registerDemoCode.textContent = state.register.demoCode;
                }
                setRegisterStep(2);
                setStatus(
                    elements.registerStatusBox,
                    elements.registerStatusTitle,
                    elements.registerStatusCopy,
                    "Код отправлен",
                    payload.message || "Введите код подтверждения. Пароль можно задать сразу или пропустить.",
                    "success"
                );
                ui.toast(payload.message || "Код подтверждения отправлен.", "success");
                elements.registerCode?.focus();
                return;
            }

            if (!/^\d{6}$/.test(code)) {
                setFieldError(elements.registerCodeError, elements.registerCode, "Код должен состоять из 6 цифр.");
                return;
            }

            ui.setButtonLoading(elements.registerActionButton, true, "Завершение...");
            await ui.request("/api/v1/auth/register/confirm", {
                method: "POST",
                json: true,
                body: {
                    phone,
                    sms_code: code,
                    password: password || undefined,
                },
            });

            setStatus(
                elements.registerStatusBox,
                elements.registerStatusTitle,
                elements.registerStatusCopy,
                "Регистрация подтверждена",
                "Завершаем вход и готовим ваш кабинет.",
                "success"
            );

            const completed = await loginAfterRegistration(phone, password);
            if (!completed) {
                if (elements.loginPhone) {
                    elements.loginPhone.value = formatPhone(phone);
                }
                saveRememberedPhone();
                ui.closeModal("registerModal");
                ui.toast("Регистрация завершена. Для первого входа мы уже отправили код.", "success");
            }
        } catch (error) {
            const message = error.message || "Не удалось завершить регистрацию.";
            if (state.register.step === 1) {
                setFieldError(elements.registerPhoneError, elements.registerPhone, message);
            } else {
                setFieldError(elements.registerCodeError, elements.registerCode, message);
            }
            ui.toast(message, "error");
        } finally {
            ui.setButtonLoading(elements.registerActionButton, false);
        }
    }

    // Сброс восстановления в исходное состояние при каждом открытии модалки.
    function resetRecoveryModal() {
        state.recovery.step = 1;
        state.recovery.phone = "";
        state.recovery.demoCode = "";
        if (elements.recoveryPhone) elements.recoveryPhone.value = "";
        if (elements.recoveryCode) elements.recoveryCode.value = "";
        if (elements.recoveryNewPassword) elements.recoveryNewPassword.value = "";
        elements.recoveryCodeGroup?.classList.add("mtn-auth-hidden");
        elements.recoveryPasswordGroup?.classList.add("mtn-auth-hidden");
        elements.recoveryDemoPanel?.classList.add("mtn-auth-hidden");
        if (elements.recoveryActionButton) {
            elements.recoveryActionButton.textContent = "Отправить код для сброса";
        }
        setFieldError(elements.recoveryPhoneError, elements.recoveryPhone, "");
        setFieldError(elements.recoveryCodeError, elements.recoveryCode, "");
        setFieldError(elements.recoveryPasswordError, elements.recoveryNewPassword, "");
        setStatus(
            elements.recoveryStatusBox,
            elements.recoveryStatusTitle,
            elements.recoveryStatusCopy,
            "Сброс пароля",
            "Введите телефон, чтобы отправить код для сброса пароля."
        );
    }

    async function handleRecoveryAction() {
        const phone = normalizePhone(elements.recoveryPhone?.value);
        const code = String(elements.recoveryCode?.value || "").trim();
        const newPassword = String(elements.recoveryNewPassword?.value || "").trim();

        setFieldError(elements.recoveryPhoneError, elements.recoveryPhone, "");
        setFieldError(elements.recoveryCodeError, elements.recoveryCode, "");
        setFieldError(elements.recoveryPasswordError, elements.recoveryNewPassword, "");

        if (!isValidPhone(phone)) {
            setFieldError(elements.recoveryPhoneError, elements.recoveryPhone, "Введите корректный номер телефона.");
            return;
        }

        try {
            ensureNotBlocked("recovery", phone);

            if (state.recovery.step === 1) {
                ui.setButtonLoading(elements.recoveryActionButton, true, "Отправка...");
                const payload = await ui.request("/api/v1/auth/reset-password", {
                    method: "POST",
                    json: true,
                    body: { phone },
                });
                state.recovery.step = 2;
                state.recovery.phone = phone;
                state.recovery.demoCode = payload.demo_sms_code || generateDemoCode();
                elements.recoveryCodeGroup?.classList.remove("mtn-auth-hidden");
                elements.recoveryPasswordGroup?.classList.remove("mtn-auth-hidden");
                elements.recoveryDemoPanel?.classList.remove("mtn-auth-hidden");
                if (elements.recoveryDemoCode) {
                    elements.recoveryDemoCode.textContent = state.recovery.demoCode;
                }
                if (elements.recoveryActionButton) {
                    elements.recoveryActionButton.textContent = "Сохранить новый пароль";
                }
                setStatus(
                    elements.recoveryStatusBox,
                    elements.recoveryStatusTitle,
                    elements.recoveryStatusCopy,
                    "Код отправлен",
                    payload.message || "Введите код и задайте новый пароль.",
                    "success"
                );
                ui.toast(payload.message || "Код для сброса отправлен.", "success");
                elements.recoveryCode?.focus();
                return;
            }

            if (!/^\d{6}$/.test(code)) {
                setFieldError(elements.recoveryCodeError, elements.recoveryCode, "Код должен состоять из 6 цифр.");
                return;
            }

            if (newPassword.length < 8) {
                setFieldError(elements.recoveryPasswordError, elements.recoveryNewPassword, "Пароль должен содержать минимум 8 символов.");
                return;
            }

            ui.setButtonLoading(elements.recoveryActionButton, true, "Сохранение...");
            const payload = await ui.request("/api/v1/auth/reset-password", {
                method: "POST",
                json: true,
                body: {
                    phone,
                    sms_code: code,
                    new_password: newPassword,
                },
            });

            resetScopeAttempts("recovery", phone);
            setStatus(
                elements.recoveryStatusBox,
                elements.recoveryStatusTitle,
                elements.recoveryStatusCopy,
                "Пароль обновлён",
                "Теперь можно войти по новому паролю на этой странице.",
                "success"
            );
            if (elements.loginPhone) {
                elements.loginPhone.value = formatPhone(phone);
            }
            if (elements.loginPassword) {
                elements.loginPassword.value = "";
            }
            ui.toast(payload.message || "Пароль успешно изменён.", "success");
            ui.closeModal("recoveryModal");
        } catch (error) {
            registerAttemptFailure("recovery", phone);
            const message = error.message || "Не удалось восстановить доступ.";
            if (state.recovery.step === 1) {
                setFieldError(elements.recoveryPhoneError, elements.recoveryPhone, message);
            } else if (/пароль/i.test(message)) {
                setFieldError(elements.recoveryPasswordError, elements.recoveryNewPassword, message);
            } else {
                setFieldError(elements.recoveryCodeError, elements.recoveryCode, message);
            }
            ui.toast(message, "error");
        } finally {
            ui.setButtonLoading(elements.recoveryActionButton, false);
        }
    }

    function bindModalOpeners() {
        document.querySelectorAll("[data-open-register]").forEach((button) => {
            button.addEventListener("click", () => {
                resetRegisterModal();
                ui.openModal("registerModal");
            });
        });

        document.querySelectorAll("[data-open-recovery]").forEach((button) => {
            button.addEventListener("click", () => {
                resetRecoveryModal();
                ui.openModal("recoveryModal");
            });
        });
    }

    function bindAdminCredentialCopy() {
        document.querySelectorAll("[data-copy-admin-credentials]").forEach((button) => {
            button.addEventListener("click", async () => {
                const value = button.dataset.credentials || "";
                const copied = await copyText(value);
                ui.toast(copied ? "Учётные данные скопированы." : value, copied ? "success" : "info");
            });
        });
    }

    function bindPasswordToggle(button, input) {
        if (!button || !input) return;
        button.addEventListener("click", () => {
            const isPassword = input.type === "password";
            input.type = isPassword ? "text" : "password";
            button.setAttribute("aria-label", isPassword ? "Скрыть пароль" : "Показать пароль");
            button.innerHTML = `<i class="fas fa-${isPassword ? "eye-slash" : "eye"}" aria-hidden="true"></i>`;
        });
    }

    function bindDemoCopy(button, getCode, targetInput) {
        if (!button || !targetInput) return;
        button.addEventListener("click", async () => {
            const code = getCode();
            targetInput.value = code;
            await copyText(code);
            ui.toast("Код скопирован и подставлен в поле.", "success");
            targetInput.focus();
        });
    }

    // Инициализируем маски, кнопки, модалки и демо-поведение страницы.
    function init() {
        if (!ui || !elements.loginPhone) return;

        loadRememberedPhone();
        [elements.loginPhone, elements.registerPhone, elements.recoveryPhone].forEach(applyPhoneMask);

        updateDemoCodeForCurrentPhone(true);

        elements.loginPhone.addEventListener("input", () => {
            updateDemoCodeForCurrentPhone();
            setFieldError(elements.loginPhoneError, elements.loginPhone, "");
        });

        elements.rememberPhone?.addEventListener("change", saveRememberedPhone);
        elements.sendCodeButton?.addEventListener("click", handleSendCode);
        elements.loginByCodeButton?.addEventListener("click", handleSmsLogin);
        elements.loginByPasswordButton?.addEventListener("click", handlePasswordLogin);
        elements.registerActionButton?.addEventListener("click", handleRegisterAction);
        elements.recoveryActionButton?.addEventListener("click", handleRecoveryAction);

        bindPasswordToggle(elements.togglePasswordButton, elements.loginPassword);
        bindDemoCopy(elements.copyDemoCodeButton, () => state.login.demoCode, elements.loginSmsCode);
        bindDemoCopy(elements.registerCopyCodeButton, () => state.register.demoCode, elements.registerCode);
        bindDemoCopy(elements.recoveryCopyCodeButton, () => state.recovery.demoCode, elements.recoveryCode);

        bindModalOpeners();
        bindAdminCredentialCopy();

        resetRegisterModal();
        resetRecoveryModal();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
