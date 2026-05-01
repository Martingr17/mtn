import { useParams } from "react-router-dom";

import { MvpPlaceholderPage } from "@/pages/MvpPlaceholderPage";

function SubscriberDetailPage() {
  const { id } = useParams();

  return (
    <MvpPlaceholderPage
      eyebrow="OSS/BSS MVP / Карточка абонента"
      title={`Абонент ${id ?? ""}`.trim()}
      description="Здесь появится единая карточка абонента с тарифом, услугами, балансом, заявками и сетевым статусом."
      scope="На этапе 0-1 карточка является заглушкой. Интеграция с billing, RADIUS и GPON пока не подключена."
    />
  );
}

export default SubscriberDetailPage;
