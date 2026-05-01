import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface MvpPlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  scope: string;
}

export function MvpPlaceholderPage({
  eyebrow,
  title,
  description,
  scope,
}: MvpPlaceholderPageProps) {
  return (
    <div className="stack-lg">
      <Card className="hero-card">
        <SectionHeading eyebrow={eyebrow} title={title} description={description} />
      </Card>

      <Card className="stack-md">
        <strong>Статус этапа</strong>
        <p className="muted">{scope}</p>
      </Card>
    </div>
  );
}
