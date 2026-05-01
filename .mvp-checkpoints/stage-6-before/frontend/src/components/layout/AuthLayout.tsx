import type { LucideIcon } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

interface AuthLayoutHighlight {
  title: string;
  description: string;
  icon?: LucideIcon;
}

const trustSignals: AuthLayoutHighlight[] = [
  {
    title: "Единый вход",
    description: "Личный кабинет и сервисы MTN работают в одном защищённом контуре.",
  },
  {
    title: "Подтверждение доступа",
    description: "Код и дополнительная защита включаются только там, где они действительно нужны.",
  },
  {
    title: "Контроль ролей",
    description: "Сценарии для абонента, оператора и администратора разделены и не мешают друг другу.",
  },
];

interface AuthLayoutProps extends PropsWithChildren {
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  brandHighlights?: AuthLayoutHighlight[];
  hideSignal?: boolean;
  signalLabel?: string;
  signalTitle?: string;
  signalDescription?: string;
  variant?: "default" | "login";
}

export function AuthLayout({
  children,
  eyebrow = "MTN ID",
  title = "Надёжный вход",
  description = "Один защищённый вход для личного кабинета и внутренних сервисов MTN.",
  brandHighlights = trustSignals,
  hideSignal = false,
  signalLabel = "Защищённый доступ",
  signalTitle = "Быстрый и понятный сценарий",
  signalDescription = "Минимум лишних шагов, заметные статусы и аккуратная работа на компьютере и телефоне.",
  variant = "default",
}: AuthLayoutProps) {
  if (variant === "login") {
    return (
      <main className="auth-layout is-login-layout">
        <section className="auth-stage is-login-layout">
          <div
            className={`auth-stage-brand is-login-layout${brandHighlights.length ? "" : " has-no-highlights"}`}
          >
            <div className="auth-login-brand-lockup">
              <img
                className="auth-login-brand-wordmark"
                src="/mtn-login-logo-hq.png"
                alt="MTN Martin Telecom Network"
              />
            </div>

            <div className="auth-brand-copy auth-brand-copy--login">
              <h1>{title}</h1>
              <p className="auth-brand-description">{description}</p>
            </div>

            {brandHighlights.length ? (
              <div className="auth-brand-pills is-login-layout">
                {brandHighlights.map((item) => (
                  <article key={item.title} className="auth-brand-pill auth-brand-pill--login">
                    {item.icon ? (
                      <span className="auth-brand-pill-icon" aria-hidden="true">
                        <item.icon size={22} strokeWidth={2.1} />
                      </span>
                    ) : null}

                    <div className="auth-brand-pill-copy">
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="auth-brand-visual-shell" aria-hidden="true">
              <img
                className="auth-brand-visual"
                src="/login-security-hero-transparent.png"
                alt=""
              />
            </div>
          </div>

          <div className="auth-stage-panel is-login-layout">{children}</div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-stage">
        <div className="auth-stage-brand">
          <div className="auth-brand-lockup">
            <div className="brand-mark is-hero">MTN</div>
            <div className="auth-brand-copy">
              {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
              <h1>{title}</h1>
              <p className="auth-brand-description">{description}</p>
            </div>
          </div>

          {brandHighlights.length ? (
            <div className="auth-brand-pills">
              {brandHighlights.map((item) => (
                <article key={item.title} className="auth-brand-pill">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </article>
              ))}
            </div>
          ) : null}

          {!hideSignal ? (
            <div className="auth-brand-signal">
              <span>{signalLabel}</span>
              <strong>{signalTitle}</strong>
              <p>{signalDescription}</p>
            </div>
          ) : null}
        </div>

        <div className="auth-stage-panel">{children}</div>
      </section>
    </main>
  );
}
