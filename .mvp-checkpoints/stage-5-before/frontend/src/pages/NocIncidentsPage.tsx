import { MvpPlaceholderPage } from "@/pages/MvpPlaceholderPage";

function NocIncidentsPage() {
  return (
    <MvpPlaceholderPage
      eyebrow="NOC"
      title="Инциденты"
      description="Здесь появится список NOC-инцидентов, связанных аварий и затронутых абонентов."
      scope="На этапе 0-1 доступна только навигационная заглушка. ACK, resolve и связь с alarms будут позже."
    />
  );
}

export default NocIncidentsPage;
