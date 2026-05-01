import { MvpPlaceholderPage } from "@/pages/MvpPlaceholderPage";

function RadiusPage() {
  return (
    <MvpPlaceholderPage
      eyebrow="Network / RADIUS CoA"
      title="RADIUS/CoA"
      description="Здесь появится mock-панель команд block, unblock, disconnect и change speed."
      scope="На этапе 0-1 доступны только маршрут и навигация. Команды управления сессиями пока не реализованы."
    />
  );
}

export default RadiusPage;
