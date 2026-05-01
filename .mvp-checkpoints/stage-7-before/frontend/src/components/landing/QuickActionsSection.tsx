import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

interface QuickActionItem {
  label: string;
  to: string;
}

interface QuickActionsSectionProps {
  items: QuickActionItem[];
}

function QuickActionRow({ item }: { item: QuickActionItem }) {
  return (
    <Link className="landing-quick-action-row" to={item.to}>
      <span className="landing-quick-action-row__label">{item.label}</span>
      <span className="landing-quick-action-row__icon">
        <ArrowRight size={16} />
      </span>
    </Link>
  );
}

export function QuickActionsSection({ items }: QuickActionsSectionProps) {
  const [primaryAction, ...secondaryActions] = items;

  return (
    <section className="landing-quick-actions-card" aria-labelledby="landing-quick-actions-title">
      <div className="landing-quick-actions-grid">
        <div className="landing-quick-actions-main">
          <div className="landing-card-head">
            <p className="section-eyebrow">Помощь со входом</p>
            <h2 id="landing-quick-actions-title">Если вход не проходит, восстановите доступ без лишних шагов.</h2>
          </div>

          <p className="landing-quick-actions-copy">
            Для нового аккаунта, проблем с email или 2FA используйте быстрые сценарии справа.
          </p>

          <Link className="ui-button is-primary is-md landing-quick-actions-primary" to={primaryAction.to}>
            {primaryAction.label}
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="landing-quick-actions-list" aria-label="Дополнительные сценарии входа">
          {secondaryActions.map((item) => (
            <QuickActionRow key={item.label} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
