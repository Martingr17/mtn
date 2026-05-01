import type { LucideIcon } from "lucide-react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";

import { ScenarioCard, type ScenarioCardItem } from "@/components/landing/ScenarioCardsSection";

interface TrustMetric {
  icon: LucideIcon;
  value: string;
  label: string;
}

interface HeroSectionProps {
  scenarioItems: ScenarioCardItem[];
  trustMetrics: TrustMetric[];
}

export function HeroSection({ scenarioItems, trustMetrics }: HeroSectionProps) {
  return (
    <section className="landing-hero-stage" aria-labelledby="landing-hero-title">
      <header className="landing-hero-header" aria-label="Навигация стартовой страницы">
        <Link className="landing-logo" to="/" aria-label="MTN ID">
          <img className="landing-logo-image" src="/landing-header-icon-cropped.png" alt="MTN ID" />
        </Link>

        <span className="landing-header-emblem" aria-hidden="true">
          <img className="landing-header-emblem-image" src="/landing-logo-header.png" alt="" />
        </span>

        <Link className="landing-header-login" to="/login">
          Войти в личный кабинет
          <span aria-hidden="true">
            <ArrowRight size={18} />
          </span>
        </Link>
      </header>

      <div className="landing-hero-canvas">
        <div className="landing-hero-grid">
          <div className="landing-hero-copy">
            <div className="landing-hero-main">
              <h1 id="landing-hero-title" className="landing-hero-title">
                Личный кабинет для абонента и команды MTN
              </h1>
              <p className="landing-hero-description">
                Платежи, обращения, уведомления и мониторинг сети собраны в одном защищённом интерфейсе.
              </p>

              <div className="landing-hero-cta-block">
                <div className="landing-hero-actions">
                  <Link className="ui-button is-primary is-md" to="/login">
                    Войти в личный кабинет
                    <ArrowRight size={16} />
                  </Link>
                  <Link className="ui-button is-secondary is-md" to="/register">
                    Создать аккаунт
                  </Link>
                </div>

                <Link className="landing-inline-link" to="/recover">
                  <RotateCcw size={16} aria-hidden="true" />
                  Восстановить доступ
                </Link>
              </div>
            </div>

            <div className="landing-support-band">
              <ul className="landing-trust-list" aria-label="Ключевые показатели">
                {trustMetrics.map((metric) => (
                  <li key={metric.label} className="landing-trust-chip">
                    <span className="landing-trust-chip-icon" aria-hidden="true">
                      <metric.icon size={16} />
                    </span>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <aside className="landing-hero-sections" aria-labelledby="landing-hero-sections-title">
            <div className="landing-hero-sections-shell">
              <div className="landing-hero-sections-head">
                <div className="landing-hero-sections-copy">
                  <strong id="landing-hero-sections-title">Выберите нужный сценарий после входа</strong>
                </div>
              </div>

              <div className="landing-hero-scenario-grid" role="list">
                {scenarioItems.map((item) => (
                  <div key={item.title} role="listitem">
                    <ScenarioCard item={item} compact />
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

    </section>
  );
}
