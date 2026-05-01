self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let payload = {
        title: "MTN",
        body: "Новое уведомление в личном кабинете.",
        url: "/notifications",
        icon: "/static/favicon.svg",
        data: {},
    };

    try {
        const incoming = event.data ? event.data.json() : {};
        payload = {
            ...payload,
            ...incoming,
        };
    } catch (error) {
        // Ignore malformed payloads and keep defaults.
    }

    const options = {
        body: payload.body,
        icon: payload.icon || "/static/favicon.svg",
        badge: payload.badge || "/static/favicon.svg",
        data: {
            url: payload.url || "/notifications",
            notification: payload.notification || null,
        },
        tag: payload.tag || `mtn-${Date.now()}`,
        renotify: false,
    };

    event.waitUntil(self.registration.showNotification(payload.title || "MTN", options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.notification?.data?.url || "/notifications";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                if ("focus" in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(url);
            }
            return undefined;
        })
    );
});
