(function () {
    const PAGE_CLASS = "payments-page-v2";
    if (!document.body.classList.contains(PAGE_CLASS)) return;

    const ui = window.OperatorUI || {};
    const qs = (selector, root = document) => root.querySelector(selector);
    const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const canRequest = typeof ui.request === "function";
    const canGetUser = typeof ui.getCurrentUser === "function";
    const formatCurrency = (value) => (typeof ui.formatCurrency === "function"
        ? ui.formatCurrency(value)
        : new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            maximumFractionDigits: 0,
        }).format(Number(value || 0)));
    const formatDate = (value) => (typeof ui.formatDate === "function"
        ? ui.formatDate(value)
        : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(value)));
    const escapeHTML = (value) => (typeof ui.escapeHTML === "function"
        ? ui.escapeHTML(value)
        : String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;"));
    const notify = (message, type = "info", title = "MTN") => {
        if (typeof ui.toast === "function") {
            ui.toast(message, type, title);
        }
    };

    const STORAGE = {
        saveCard: "mtn.payments.save-card.v2",
        maskedPan: "mtn.payments.masked-pan.v2",
    };

    const LIMITS = {
        minAmount: 10,
        maxAmount: 15000,
    };

    const PRESETS = [100, 300, 500, 1000, 1500, 2000];

    const state = {
        authenticated: document.body.dataset.authenticated === "true",
        amount: 1000,
        method: "bank_card",
        balance: 0,
        billingId: "DEMO77777",
        history: [],
        loading: true,
        submitting: false,
        saveCard: window.localStorage.getItem(STORAGE.saveCard) === "true",
    };

    const elements = {
        balanceCard: qs("#paymentsBalanceCard"),
        balanceAmount: qs("#paymentsBalanceAmount"),
        balanceAccount: qs("#paymentsBalanceAccount"),
        debtAlert: qs("#paymentsDebtAlert"),
        debtText: qs("#paymentsDebtText"),
        loadError: qs("#paymentsLoadError"),
        retryButton: qs("#paymentsRetryButton"),
        presetButtons: qsa("[data-amount]", qs("#paymentAmountPresets")),
        amountInput: qs("#paymentAmountInput"),
        amountError: qs("#paymentAmountError"),
        methodButtons: qsa("[data-payment-method]"),
        cardPanel: qs("#paymentCardPanel"),
        sbpPanel: qs("#paymentSbpPanel"),
        qrCode: qs("#paymentQrCode"),
        sbpAmountText: qs("#paymentSbpAmountText"),
        sbpAction: qs("#paymentSbpAction"),
        summaryAmount: qs("#paymentSummaryAmount"),
        summaryFee: qs("#paymentSummaryFee"),
        summaryTotal: qs("#paymentSummaryTotal"),
        submitButton: qs("#paymentSubmitButton"),
        historyList: qs("#paymentsHistoryList"),
        cardNumber: qs("#paymentCardNumber"),
        cardExpiry: qs("#paymentCardExpiry"),
        cardCvc: qs("#paymentCardCvc"),
        cardHolder: qs("#paymentCardHolder"),
        saveCard: qs("#paymentSaveCard"),
        cardBrand: qs("#paymentCardBrand"),
        cvcHintButton: qs("#paymentCvcHintButton"),
        cvcHint: qs("#paymentCvcHint"),
        numberError: qs("#paymentCardNumberError"),
        expiryError: qs("#paymentCardExpiryError"),
        cvcError: qs("#paymentCardCvcError"),
    };

    function paymentMethodLabel(method = "") {
        const map = {
            bank_card: "Карта",
            sbp: "СБП",
            apple_pay: "Apple Pay",
            google_pay: "Google Pay",
        };
        return map[method] || method || "—";
    }

    function paymentStatusLabel(status = "") {
        const map = {
            succeeded: "Успешно",
            pending: "Ожидает",
            processing: "Обрабатывается",
            failed: "Ошибка",
            cancelled: "Отменён",
            refunded: "Возврат",
        };
        return map[status] || "Успешно";
    }

    function paymentStatusClass(status = "") {
        if (status === "failed" || status === "cancelled") return "is-error";
        if (status === "pending" || status === "processing") return "is-warning";
        return "is-success";
    }

    function wait(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function getDigits(value) {
        return String(value || "").replace(/\D+/g, "");
    }

    function maskCardNumber(value) {
        const digits = getDigits(value).slice(0, 16);
        return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
    }

    function maskExpiry(value) {
        const digits = getDigits(value).slice(0, 4);
        if (digits.length < 3) return digits;
        return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }

    function maskCvc(value) {
        return getDigits(value).slice(0, 3);
    }

    function detectCardBrand(value) {
        const digits = getDigits(value);
        if (/^4/.test(digits)) return "Visa";
        if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
        if (/^220[0-4]/.test(digits)) return "Мир";
        return "Карта";
    }

    function setFieldError(input, errorNode, message) {
        if (!input || !errorNode) return;
        if (message) {
            input.classList.add("is-invalid");
            input.setAttribute("aria-invalid", "true");
            errorNode.hidden = false;
            errorNode.textContent = message;
            return;
        }
        input.classList.remove("is-invalid");
        input.removeAttribute("aria-invalid");
        errorNode.hidden = true;
        errorNode.textContent = "";
    }

    function validateAmount(showError = false) {
        const rawValue = Number(elements.amountInput.value || state.amount || 0);
        if (!Number.isFinite(rawValue) || rawValue < LIMITS.minAmount) {
            if (showError) {
                setFieldError(
                    elements.amountInput,
                    elements.amountError,
                    `Минимальная сумма пополнения — ${LIMITS.minAmount} ₽.`,
                );
            }
            return false;
        }

        if (rawValue > LIMITS.maxAmount) {
            if (showError) {
                setFieldError(
                    elements.amountInput,
                    elements.amountError,
                    `Максимальная сумма пополнения — ${LIMITS.maxAmount.toLocaleString("ru-RU")} ₽.`,
                );
            }
            return false;
        }

        setFieldError(elements.amountInput, elements.amountError, "");
        state.amount = rawValue;
        return true;
    }

    function validateCardForm(showError = false) {
        const numberDigits = getDigits(elements.cardNumber.value);
        const expiryValue = String(elements.cardExpiry.value || "");
        const cvcValue = getDigits(elements.cardCvc.value);

        let valid = true;

        if (numberDigits.length !== 16) {
            valid = false;
            if (showError) {
                setFieldError(elements.cardNumber, elements.numberError, "Введите 16 цифр номера карты.");
            }
        } else if (showError) {
            setFieldError(elements.cardNumber, elements.numberError, "");
        }

        const expiryMatch = expiryValue.match(/^(\d{2})\/(\d{2})$/);
        if (!expiryMatch) {
            valid = false;
            if (showError) {
                setFieldError(elements.cardExpiry, elements.expiryError, "Введите срок действия в формате ММ/ГГ.");
            }
        } else {
            const month = Number(expiryMatch[1]);
            const year = Number(`20${expiryMatch[2]}`);
            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();
            const expired = year < currentYear || (year === currentYear && month < currentMonth);

            if (month < 1 || month > 12 || expired) {
                valid = false;
                if (showError) {
                    setFieldError(elements.cardExpiry, elements.expiryError, "Срок действия карты уже истёк.");
                }
            } else if (showError) {
                setFieldError(elements.cardExpiry, elements.expiryError, "");
            }
        }

        if (cvcValue.length !== 3) {
            valid = false;
            if (showError) {
                setFieldError(elements.cardCvc, elements.cvcError, "Введите 3 цифры CVC/CVV.");
            }
        } else if (showError) {
            setFieldError(elements.cardCvc, elements.cvcError, "");
        }

        return valid;
    }

    function flashBalance() {
        if (!elements.balanceCard) return;
        elements.balanceCard.classList.remove("is-success-flash");
        void elements.balanceCard.offsetWidth;
        elements.balanceCard.classList.add("is-success-flash");
    }

    function renderAmountControls() {
        const amount = Number(state.amount || 0);
        elements.presetButtons.forEach((button) => {
            const active = Number(button.dataset.amount) === amount;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        elements.amountInput.value = amount > 0 ? String(amount) : "";
    }

    function renderSummary() {
        const amount = Number(state.amount || 0);
        const fee = 0;
        const total = amount + fee;
        const hasValidAmount = validateAmount(false);

        elements.summaryAmount.textContent = hasValidAmount ? formatCurrency(amount) : "—";
        elements.summaryFee.textContent = formatCurrency(fee);
        elements.summaryTotal.textContent = hasValidAmount ? formatCurrency(total) : "—";
        elements.submitButton.textContent = hasValidAmount ? `Оплатить ${formatCurrency(total)}` : "Выберите сумму";
        elements.submitButton.disabled = !hasValidAmount || state.submitting;
        elements.sbpAmountText.textContent = hasValidAmount ? `Сумма: ${formatCurrency(total)}` : "Сумма: —";
        renderQrCode(total);
    }

    function renderMethodSwitcher() {
        elements.methodButtons.forEach((button) => {
            const active = button.dataset.paymentMethod === state.method;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-checked", active ? "true" : "false");
        });

        const cardSelected = state.method === "bank_card";
        elements.cardPanel.hidden = !cardSelected;
        elements.sbpPanel.hidden = cardSelected;
    }

    function renderQrCode(amount) {
        const label = Number.isFinite(amount) && amount > 0 ? formatCurrency(amount) : "—";
        elements.qrCode.innerHTML = `
            <svg viewBox="0 0 240 240" role="img" aria-label="QR-код для оплаты через СБП">
                <rect x="0" y="0" width="240" height="240" rx="28" fill="#FFFFFF"/>
                <rect x="18" y="18" width="64" height="64" rx="10" fill="#0A2B4E"/>
                <rect x="30" y="30" width="40" height="40" rx="6" fill="#F4F6FA"/>
                <rect x="158" y="18" width="64" height="64" rx="10" fill="#0A2B4E"/>
                <rect x="170" y="30" width="40" height="40" rx="6" fill="#F4F6FA"/>
                <rect x="18" y="158" width="64" height="64" rx="10" fill="#0A2B4E"/>
                <rect x="30" y="170" width="40" height="40" rx="6" fill="#F4F6FA"/>
                <rect x="104" y="26" width="12" height="12" rx="4" fill="#2563EB"/>
                <rect x="122" y="26" width="12" height="12" rx="4" fill="#1D4ED8"/>
                <rect x="104" y="44" width="12" height="12" rx="4" fill="#1D4ED8"/>
                <rect x="122" y="44" width="12" height="12" rx="4" fill="#2563EB"/>
                <rect x="98" y="92" width="20" height="20" rx="6" fill="#0A2B4E"/>
                <rect x="124" y="92" width="20" height="20" rx="6" fill="#2563EB"/>
                <rect x="150" y="92" width="20" height="20" rx="6" fill="#0A2B4E"/>
                <rect x="98" y="118" width="20" height="20" rx="6" fill="#2563EB"/>
                <rect x="124" y="118" width="20" height="20" rx="6" fill="#0A2B4E"/>
                <rect x="150" y="118" width="20" height="20" rx="6" fill="#2563EB"/>
                <rect x="98" y="144" width="20" height="20" rx="6" fill="#0A2B4E"/>
                <rect x="124" y="144" width="20" height="20" rx="6" fill="#2563EB"/>
                <rect x="150" y="144" width="20" height="20" rx="6" fill="#0A2B4E"/>
                <rect x="146" y="166" width="56" height="44" rx="18" fill="#EFF6FF"/>
                <text x="174" y="191" text-anchor="middle" font-size="15" font-weight="700" fill="#2563EB">MTN</text>
                <text x="120" y="222" text-anchor="middle" font-size="12" fill="#5A6B7C">${escapeHTML(label)}</text>
            </svg>
        `;
    }

    function renderBalance() {
        if (elements.balanceCard) {
            elements.balanceCard.classList.remove("is-loading");
        }
        elements.balanceAmount.textContent = formatCurrency(state.balance);
        elements.balanceAccount.textContent = `Лицевой счёт: ${state.billingId || "—"}`;

        if (state.balance < -500) {
            elements.debtAlert.hidden = false;
            elements.debtText.textContent = `У вас есть задолженность ${formatCurrency(Math.abs(state.balance))}. Рекомендуем пополнить баланс на сумму не менее задолженности.`;
        } else {
            elements.debtAlert.hidden = true;
        }
    }

    function renderHistory() {
        const items = Array.isArray(state.history) ? state.history.slice(0, 6) : [];

        if (!items.length) {
            elements.historyList.innerHTML = `
                <div class="payments-empty-v2">
                    <i class="fas fa-receipt"></i>
                    <div>
                        <strong>Пока нет операций</strong>
                        <p>После первого пополнения здесь появится история последних платежей.</p>
                    </div>
                </div>
            `;
            return;
        }

        elements.historyList.innerHTML = items.map((item) => {
            const amountValue = Number(item.amount || 0);
            const sign = item.payment_type === "topup" ? "+" : amountValue < 0 ? "−" : "+";
            const method = item.payment_type === "topup"
                ? paymentMethodLabel(item.payment_method)
                : (item.description || "Списание");

            return `
                <article class="payments-history-row-v2">
                    <div class="payments-history-row-v2__cell" data-label="Дата">${escapeHTML(formatDate(item.created_at))}</div>
                    <div class="payments-history-row-v2__cell payments-history-row-v2__amount" data-label="Сумма">${sign}${escapeHTML(formatCurrency(Math.abs(amountValue)))}</div>
                    <div class="payments-history-row-v2__cell" data-label="Способ">${escapeHTML(method)}</div>
                    <div class="payments-history-row-v2__cell" data-label="Статус">
                        <span class="payments-status-v2 ${paymentStatusClass(item.status)}">${escapeHTML(paymentStatusLabel(item.status))}</span>
                    </div>
                </article>
            `;
        }).join("");
    }

    function prependLocalHistory(amount) {
        state.history.unshift({
            created_at: new Date().toISOString(),
            amount,
            payment_method: state.method,
            payment_type: "topup",
            status: "succeeded",
            description: "Пополнение баланса",
        });
        renderHistory();
    }

    function renderLoadError(message = "") {
        elements.loadError.hidden = false;
        const body = qs("p", elements.loadError);
        if (body && message) {
            body.textContent = message;
        }
    }

    function clearLoadError() {
        elements.loadError.hidden = true;
    }

    async function loadPaymentsData(options = {}) {
        if (!canRequest) return;

        state.loading = true;
        clearLoadError();
        if (elements.balanceCard) {
            elements.balanceCard.classList.add("is-loading");
        }

        const requests = await Promise.allSettled([
            canGetUser ? ui.getCurrentUser({ force: true }) : Promise.resolve(null),
            ui.request("/api/v1/billing/balance", { auth: true }),
            ui.request("/api/v1/payments/history?limit=8", { auth: true }),
        ]);

        const [userResult, balanceResult, historyResult] = requests;
        let hasFailure = false;

        if (userResult.status === "fulfilled" && userResult.value) {
            state.billingId = userResult.value.billing_id || userResult.value.phone || state.billingId;
        } else if (userResult.status === "rejected") {
            hasFailure = true;
        }

        if (balanceResult.status === "fulfilled") {
            state.balance = Number(balanceResult.value?.balance || 0);
        } else {
            hasFailure = true;
        }

        if (historyResult.status === "fulfilled" && Array.isArray(historyResult.value)) {
            state.history = historyResult.value;
        } else {
            hasFailure = true;
            state.history = [];
        }

        renderBalance();
        renderHistory();
        renderSummary();
        state.loading = false;

        if (hasFailure && !options.silent) {
            renderLoadError("Не удалось полностью обновить страницу. Попробуйте ещё раз чуть позже.");
        }
    }

    async function submitPayment() {
        if (state.submitting) return;

        const amountValid = validateAmount(true);
        const cardValid = state.method !== "bank_card" || validateCardForm(true);
        if (!amountValid || !cardValid) {
            notify("Проверьте сумму и реквизиты карты перед оплатой.", "error", "Платёж не отправлен");
            return;
        }

        state.submitting = true;
        renderSummary();
        if (typeof ui.setButtonLoading === "function") {
            ui.setButtonLoading(elements.submitButton, true, "Обработка...");
        } else {
            elements.submitButton.disabled = true;
            elements.submitButton.textContent = "Обработка...";
        }
        if (elements.sbpAction) elements.sbpAction.disabled = true;

        const payload = {
            amount: state.amount,
            payment_method: state.method,
        };

        try {
            let createdPayment = null;
            if (canRequest) {
                createdPayment = await ui.request("/api/v1/payments/create", {
                    method: "POST",
                    auth: true,
                    json: true,
                    body: payload,
                });
            }

            await wait(900);

            if (createdPayment?.payment_id && createdPayment?.provider === "demo" && canRequest) {
                await ui.request(`/api/v1/payments/${createdPayment.payment_id}/confirm-demo`, {
                    method: "POST",
                    auth: true,
                });
                await loadPaymentsData({ silent: true });
            } else {
                state.balance += state.amount;
                prependLocalHistory(state.amount);
                renderBalance();
            }

            if (state.saveCard) {
                window.localStorage.setItem(STORAGE.saveCard, "true");
                const digits = getDigits(elements.cardNumber.value);
                if (digits.length === 16) {
                    window.localStorage.setItem(STORAGE.maskedPan, `**** ${digits.slice(-4)}`);
                }
            } else {
                window.localStorage.setItem(STORAGE.saveCard, "false");
            }

            notify(`Платёж на сумму ${formatCurrency(payload.amount)} успешно проведён.`, "success", "Платёж выполнен");
            flashBalance();
            resetFormAfterSuccess();
        } catch (error) {
            notify(
                error?.message || "Ошибка платежа. Проверьте данные карты или попробуйте другой способ оплаты.",
                "error",
                "Платёж не выполнен",
            );
            elements.submitButton.classList.add("is-error");
            window.setTimeout(() => elements.submitButton.classList.remove("is-error"), 900);
        } finally {
            state.submitting = false;
            if (typeof ui.setButtonLoading === "function") {
                ui.setButtonLoading(elements.submitButton, false);
            } else {
                elements.submitButton.disabled = false;
            }
            if (elements.sbpAction) elements.sbpAction.disabled = false;
            renderSummary();
        }
    }

    function resetFormAfterSuccess() {
        state.amount = 0;
        elements.amountInput.value = "";
        elements.cardNumber.value = "";
        elements.cardExpiry.value = "";
        elements.cardCvc.value = "";
        elements.cardHolder.value = "";
        elements.cardBrand.textContent = "Карта";
        setFieldError(elements.amountInput, elements.amountError, "");
        setFieldError(elements.cardNumber, elements.numberError, "");
        setFieldError(elements.cardExpiry, elements.expiryError, "");
        setFieldError(elements.cardCvc, elements.cvcError, "");
        renderAmountControls();
    }

    function bindAmountControls() {
        elements.presetButtons.forEach((button) => {
            button.addEventListener("click", () => {
                state.amount = Number(button.dataset.amount || 0);
                renderAmountControls();
                validateAmount(true);
                renderSummary();
            });
        });

        elements.amountInput.addEventListener("input", () => {
            state.amount = Number(elements.amountInput.value || 0);
            renderAmountControls();
            validateAmount(false);
            renderSummary();
        });

        elements.amountInput.addEventListener("blur", () => {
            validateAmount(true);
            renderSummary();
        });
    }

    function bindMethodControls() {
        elements.methodButtons.forEach((button) => {
            button.addEventListener("click", () => {
                state.method = button.dataset.paymentMethod || "bank_card";
                renderMethodSwitcher();
                renderSummary();
            });
        });

        if (elements.sbpAction) {
            elements.sbpAction.addEventListener("click", submitPayment);
        }
    }

    function bindCardMasks() {
        elements.cardNumber.addEventListener("input", () => {
            elements.cardNumber.value = maskCardNumber(elements.cardNumber.value);
            elements.cardBrand.textContent = detectCardBrand(elements.cardNumber.value);
            setFieldError(elements.cardNumber, elements.numberError, "");
        });

        elements.cardExpiry.addEventListener("input", () => {
            elements.cardExpiry.value = maskExpiry(elements.cardExpiry.value);
            setFieldError(elements.cardExpiry, elements.expiryError, "");
        });

        elements.cardCvc.addEventListener("input", () => {
            elements.cardCvc.value = maskCvc(elements.cardCvc.value);
            setFieldError(elements.cardCvc, elements.cvcError, "");
        });

        elements.cardHolder.addEventListener("blur", () => {
            elements.cardHolder.value = String(elements.cardHolder.value || "").toUpperCase().trimStart();
        });
    }

    function bindSaveCard() {
        elements.saveCard.checked = state.saveCard;
        elements.saveCard.addEventListener("change", () => {
            state.saveCard = elements.saveCard.checked;
            window.localStorage.setItem(STORAGE.saveCard, state.saveCard ? "true" : "false");
        });
    }

    function bindCvcHint() {
        elements.cvcHintButton.addEventListener("click", () => {
            const expanded = elements.cvcHintButton.getAttribute("aria-expanded") === "true";
            elements.cvcHintButton.setAttribute("aria-expanded", expanded ? "false" : "true");
            elements.cvcHint.hidden = expanded;
        });
    }

    function bindSubmit() {
        elements.submitButton.addEventListener("click", submitPayment);
    }

    function bindRetry() {
        elements.retryButton.addEventListener("click", () => loadPaymentsData());
    }

    function bootstrapQueryFeedback() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("payment") === "success") {
            notify("Платёж завершён. Баланс уже обновлён.", "success", "MTN");
        }
    }

    function init() {
        bindAmountControls();
        bindMethodControls();
        bindCardMasks();
        bindSaveCard();
        bindCvcHint();
        bindSubmit();
        bindRetry();
        bootstrapQueryFeedback();
        renderAmountControls();
        renderMethodSwitcher();
        renderSummary();
        loadPaymentsData();
    }

    init();
})();
