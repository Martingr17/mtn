import { MvpPlaceholderPage } from "@/pages/MvpPlaceholderPage";

function ZabbixMonitoringPage() {
  return (
    <MvpPlaceholderPage
      eyebrow="Monitoring / Zabbix"
      title="Zabbix alarms"
      description="Здесь появится mock/API-представление аварий BGP, VRRP, ERPS и OLT."
      scope="На этапе 0-1 добавлен только экран-заглушка. Получение alarms и summary будет реализовано позже."
    />
  );
}

export default ZabbixMonitoringPage;
