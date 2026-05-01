interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: SectionHeadingProps) {
  return (
    <header className="section-heading">
      <div className="section-heading-copy">
        {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
        <h1 className="section-title">{title}</h1>
        {description ? <p className="section-description">{description}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </header>
  );
}
