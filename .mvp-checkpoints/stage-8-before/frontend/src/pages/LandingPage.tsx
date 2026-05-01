import type { LucideIcon } from "lucide-react";
import { ArrowRight, Bell, CreditCard, Gauge, LifeBuoy } from "lucide-react";
import { Link } from "react-router-dom";

interface ScenarioCardItem {
  action: string;
  description: string;
  icon: LucideIcon;
  title: string;
  to: string;
}

const scenarioCards: ScenarioCardItem[] = [
  {
    icon: CreditCard,
    title: "Платежи и документы",
    description: "Счета, автоплатежи и история операций в одном разделе.",
    action: "Открыть раздел",
    to: "/login?next=%2Fpayments",
  },
  {
    icon: LifeBuoy,
    title: "Поддержка и SLA",
    description: "Обращения, статусы и ответы без переключения между сервисами.",
    action: "Открыть поддержку",
    to: "/login?next=%2Fsupport",
  },
  {
    icon: Bell,
    title: "Уведомления и статусы",
    description: "Все важные события и статусы собраны в одном месте.",
    action: "Перейти к уведомлениям",
    to: "/login?next=%2Fnotifications",
  },
  {
    icon: Gauge,
    title: "Скорость и сеть",
    description: "Speedtest, качество канала и инциденты внутри кабинета.",
    action: "Открыть мониторинг",
    to: "/login?next=%2Fmonitoring",
  },
];

function LandingPage() {
  return (
    <main className="landing-reference-page">
      <div className="landing-reference-shell">
        <section className="landing-reference-hero" aria-labelledby="landing-reference-title">
          <img
            className="landing-reference-logo"
            src="/landing-top-logo.png"
            alt="MTN Martin Telecom Network"
          />

          <div className="landing-reference-copy">
            <h1 id="landing-reference-title" className="landing-reference-title">
              Личный кабинет
              <br />
              для абонента и
              <br />
              команды MTN
            </h1>

            <p className="landing-reference-description">
              Платежи, обращения, уведомления и мониторинг сети собраны в одном защищённом интерфейсе.
            </p>

            <div className="landing-reference-actions">
              <Link className="landing-reference-button is-primary" to="/login">
                <span>Войти в личный кабинет</span>
                <ArrowRight size={21} aria-hidden="true" />
              </Link>

              <Link className="landing-reference-button is-secondary" to="/register">
                <span>Зарегистрироваться</span>
                <ArrowRight size={21} aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="landing-reference-visual-shell" aria-hidden="true">
            <img
              className="landing-reference-visual"
              src="/landing-servers-hero.png"
              alt=""
            />
          </div>
        </section>

        <aside className="landing-reference-panel" aria-labelledby="landing-reference-scenarios-title">
          <h2 id="landing-reference-scenarios-title" className="landing-reference-panel-title">
            Выберите нужный сценарий после входа
          </h2>

          <div className="landing-reference-cards" role="list">
            {scenarioCards.map((card) => {
              const Icon = card.icon;

              return (
                <Link key={card.title} className="landing-reference-card" role="listitem" to={card.to}>
                  <div className="landing-reference-card-head">
                    <span className="landing-reference-card-icon" aria-hidden="true">
                      <Icon size={39} strokeWidth={2.1} />
                    </span>

                    <span className="landing-reference-card-arrow" aria-hidden="true">
                      <ArrowRight size={20} strokeWidth={2.2} />
                    </span>
                  </div>

                  <div className="landing-reference-card-copy">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>

                  <span className="landing-reference-card-action">
                    <span>{card.action}</span>
                    <ArrowRight size={20} strokeWidth={2.2} aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default LandingPage;
