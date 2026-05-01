import { useEffect, useRef, useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  RadioTower,
  Settings,
  Shield,
  UserCircle,
  Wallet,
  X,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { authService } from "@/services/endpoints/auth";
import { useAppStore } from "@/store/app-store";
import type { AppState } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import { cn } from "@/utils/cn";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  shortcut?: string;
};

const CUSTOMER_NAV: NavItem[] = [
  { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { to: "/tariffs", label: "Тарифы", icon: RadioTower },
  { to: "/payments", label: "Оплата", icon: Wallet },
  { to: "/support", label: "Поддержка", icon: LifeBuoy },
  { to: "/notifications", label: "Уведомления", icon: Bell },
  { to: "/speedtest", label: "Speedtest", icon: Gauge },
  { to: "/monitoring", label: "Мониторинг", icon: Shield },
  { to: "/profile", label: "Профиль", icon: UserCircle },
  { to: "/settings", label: "Настройки", icon: Settings },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Панель управления", icon: LayoutDashboard, shortcut: "G D" },
  { to: "/admin/users", label: "Абоненты", icon: UserCircle, shortcut: "G U" },
  { to: "/admin/tickets", label: "Заявки", icon: LifeBuoy, shortcut: "G T" },
];

const ADMIN_ONLY_NAV: NavItem[] = [
  { to: "/admin/payments", label: "Платежи", icon: Wallet, shortcut: "G P" },
  { to: "/admin/tariffs", label: "Тарифы", icon: RadioTower, shortcut: "G R" },
  { to: "/admin/operators", label: "Операторы", icon: Shield, shortcut: "G O" },
  { to: "/admin/settings", label: "Настройки", icon: Settings, shortcut: "G S" },
];

export function AppShell() {
  const user = useAuthStore((state: AuthState) => state.user);
  const role = useAuthStore((state: AuthState) => state.role);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const sidebarOpen = useAppStore((state: AppState) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state: AppState) => state.setSidebarOpen);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: authService.logout,
    onSettled: () => {
      setAccountMenuOpen(false);
      clearSession();
      queryClient.clear();
      navigate("/login", { replace: true });
      toast.success("Вы вышли из аккаунта.");
    },
  });

  const navItems = (() => {
    if (role === "operator") {
      return ADMIN_NAV;
    }
    if (role === "admin" || role === "super_admin") {
      return [...ADMIN_NAV, ...ADMIN_ONLY_NAV];
    }
    return CUSTOMER_NAV;
  })();

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    const isMobileViewport = window.matchMedia("(max-width: 1120px)").matches;
    const previousOverflow = document.body.style.overflow;

    if (isMobileViewport) {
      document.body.style.overflow = "hidden";
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [setSidebarOpen, sidebarOpen]);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.phone || "Пользователь MTN";
  const roleLabel = role === "user" ? "Абонент" : role === "operator" ? "Оператор" : "Администратор";

  return (
    <div className="app-shell">
      <button
        type="button"
        className={cn("shell-sidebar-backdrop", sidebarOpen && "is-open")}
        onClick={() => setSidebarOpen(false)}
        aria-label="Закрыть навигацию"
        aria-hidden={!sidebarOpen}
        tabIndex={sidebarOpen ? 0 : -1}
      />

      <aside id="app-shell-sidebar" className={cn("shell-sidebar", sidebarOpen && "is-open")}>
        <div className="brand-block">
          <div className="brand-mark">MTN</div>
          <div>
            <strong>Martin Telecom Network</strong>
            <p>Личный кабинет и сервис MTN</p>
          </div>
        </div>

        <nav className="shell-nav" aria-label="Основная навигация">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn("shell-nav-link", isActive && "is-active")}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={18} />
                <span className="nav-link-label">{item.label}</span>
                {item.shortcut ? (
                  <kbd className="nav-shortcut" aria-hidden="true">
                    {item.shortcut}
                  </kbd>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? "Закрыть навигацию" : "Открыть навигацию"}
            aria-controls="app-shell-sidebar"
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="topbar-spacer" />

          <ThemeToggle />

          <div className="topbar-account" ref={accountMenuRef}>
            <button
              type="button"
              className={cn("user-pill", "user-pill-button", accountMenuOpen && "is-open")}
              aria-label="Текущий пользователь"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              <span className="user-avatar">{user?.first_name?.[0] ?? user?.phone?.[1] ?? "?"}</span>
              <div>
                <strong>{displayName}</strong>
                <span>{roleLabel}</span>
              </div>
              <ChevronDown size={16} className={cn("user-pill-chevron", accountMenuOpen && "is-open")} />
            </button>

            {accountMenuOpen ? (
              <div className="account-menu" role="menu" aria-label="Меню профиля">
                <div className="account-menu__summary">
                  <strong>{displayName}</strong>
                  <span>{roleLabel}</span>
                </div>

                <button
                  type="button"
                  className="account-menu__item"
                  role="menuitem"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                >
                  <LogOut size={16} />
                  <span>{logoutMutation.isPending ? "Выходим..." : "Выйти"}</span>
                </button>
              </div>
            ) : null}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              isLoading={logoutMutation.isPending}
              loadingLabel="Выходим..."
              onClick={() => logoutMutation.mutate()}
            >
              <LogOut size={16} />
              Выйти
            </Button>
          </div>
        </header>

        <div className="shell-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
