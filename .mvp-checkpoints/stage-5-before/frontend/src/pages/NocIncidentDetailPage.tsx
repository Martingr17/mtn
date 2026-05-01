import { useParams } from "react-router-dom";

import { MvpPlaceholderPage } from "@/pages/MvpPlaceholderPage";

function NocIncidentDetailPage() {
  const { id } = useParams();

  return (
    <MvpPlaceholderPage
      eyebrow="NOC / Инцидент"
      title={`Инцидент ${id ?? ""}`.trim()}
      description="Здесь появится карточка NOC-инцидента с авариями, статусом, ответственным и хронологией."
      scope="На этапе 0-1 карточка является заглушкой. Действия ACK и resolve пока не подключены."
    />
  );
}

export default NocIncidentDetailPage;
