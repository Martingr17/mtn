import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export interface ScenarioCardItem {
  action: string;
  description: string;
  icon: LucideIcon;
  title: string;
  to: string;
}

interface ScenarioCardProps {
  item: ScenarioCardItem;
  compact?: boolean;
}

export function ScenarioCard({ item, compact = false }: ScenarioCardProps) {
  const Icon = item.icon;

  return (
    <Link className={`landing-scenario-card${compact ? " is-compact" : ""}`} to={item.to}>
      <div className="landing-scenario-card-head">
        <span className="landing-scenario-icon">
          <Icon size={18} />
        </span>
        <span className="landing-scenario-arrow">
          <ArrowRight size={16} />
        </span>
      </div>
      <div className="landing-scenario-card-body">
        <strong>{item.title}</strong>
        <p>{item.description}</p>
      </div>
      <span className="landing-scenario-action">{item.action}</span>
    </Link>
  );
}

interface ScenarioCardsSectionProps {
  items: ScenarioCardItem[];
}

export function ScenarioCardsSection({ items }: ScenarioCardsSectionProps) {
  return (
    <section className="landing-section stack-md" aria-labelledby="landing-scenarios-title">
      <header className="landing-section-head">
        <p className="section-eyebrow">Основные разделы</p>
        <h2 id="landing-scenarios-title">Основные сценарии после входа.</h2>
      </header>

      <div className="landing-scenario-grid" role="list">
        {items.map((item) => (
          <div key={item.title} role="listitem">
            <ScenarioCard item={item} />
          </div>
        ))}
      </div>
    </section>
  );
}
