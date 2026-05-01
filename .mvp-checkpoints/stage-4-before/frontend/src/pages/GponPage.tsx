import { MvpPlaceholderPage } from "@/pages/MvpPlaceholderPage";

function GponPage() {
  return (
    <MvpPlaceholderPage
      eyebrow="Network / GPON"
      title="GPON/ONT"
      description="Здесь появится mock-представление OLT, ONT, PON-портов, статусов и оптической мощности."
      scope="На этапе 0-1 доступны только маршрут и пункт меню. OLT/ONT модели и adapter будут добавлены позже."
    />
  );
}

export default GponPage;
