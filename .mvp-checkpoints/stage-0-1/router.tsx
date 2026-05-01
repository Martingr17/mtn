import { lazy, Suspense } from "react";

import { AnimatePresence } from "framer-motion";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { PageTransition } from "@/components/layout/PageTransition";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";

const LandingPage = lazy(() => import("@/pages/LandingPage"));
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/auth/RegisterPage"));
const RecoveryPage = lazy(() => import("@/pages/auth/RecoveryPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const TariffsPage = lazy(() => import("@/pages/TariffsPage"));
const PaymentsPage = lazy(() => import("@/pages/PaymentsPage"));
const SupportPage = lazy(() => import("@/pages/SupportPage"));
const TicketDetailPage = lazy(() => import("@/pages/TicketDetailPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const StatisticsPage = lazy(() => import("@/pages/StatisticsPage"));
const SpeedtestPage = lazy(() => import("@/pages/SpeedtestPage"));
const MonitoringPage = lazy(() => import("@/pages/MonitoringPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/AdminDashboardPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage"));
const AdminUserDetailPage = lazy(() => import("@/pages/admin/AdminUserDetailPage"));
const AdminTicketsPage = lazy(() => import("@/pages/admin/AdminTicketsPage"));
const AdminPaymentsPage = lazy(() => import("@/pages/admin/AdminPaymentsPage"));
const AdminTariffsPage = lazy(() => import("@/pages/admin/AdminTariffsPage"));
const AdminOperatorsPage = lazy(() => import("@/pages/admin/AdminOperatorsPage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/AdminSettingsPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

function RouteSuspense() {
  return (
    <div className="page-loading">
      <Skeleton className="skeleton-title" />
      <Skeleton className="skeleton-card" />
      <Skeleton className="skeleton-card" />
    </div>
  );
}

function GuestGuard() {
  const isAuthenticated = useAuthStore((state: AuthState) => state.isAuthenticated);
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

function ProtectedGuard() {
  const isAuthenticated = useAuthStore((state: AuthState) => state.isAuthenticated);
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

function AdminGuard() {
  const role = useAuthStore((state: AuthState) => state.role);
  const isAuthenticated = useAuthStore((state: AuthState) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role === "user" || !role) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

function AdminOnlyGuard() {
  const role = useAuthStore((state: AuthState) => state.role);
  const isAuthenticated = useAuthStore((state: AuthState) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role !== "admin" && role !== "super_admin") {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <Outlet />;
}

function ShellLayout() {
  return <AppShell />;
}

export function AppRouter() {
  const location = useLocation();

  return (
    <Suspense fallback={<RouteSuspense />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageTransition><LandingPage /></PageTransition>} />

          <Route element={<GuestGuard />}>
            <Route path="/login" element={<PageTransition><LoginPage /></PageTransition>} />
            <Route path="/register" element={<PageTransition><RegisterPage /></PageTransition>} />
            <Route path="/recover" element={<PageTransition><RecoveryPage /></PageTransition>} />
          </Route>

          <Route element={<ProtectedGuard />}>
            <Route element={<ShellLayout />}>
              <Route path="/dashboard" element={<PageTransition><DashboardPage /></PageTransition>} />
              <Route path="/tariffs" element={<PageTransition><TariffsPage /></PageTransition>} />
              <Route path="/payments" element={<PageTransition><PaymentsPage /></PageTransition>} />
              <Route path="/support" element={<PageTransition><SupportPage /></PageTransition>} />
              <Route path="/support/:ticketId" element={<PageTransition><TicketDetailPage /></PageTransition>} />
              <Route path="/notifications" element={<PageTransition><NotificationsPage /></PageTransition>} />
              <Route path="/statistics" element={<PageTransition><StatisticsPage /></PageTransition>} />
              <Route path="/speedtest" element={<PageTransition><SpeedtestPage /></PageTransition>} />
              <Route path="/monitoring" element={<PageTransition><MonitoringPage /></PageTransition>} />
              <Route path="/profile" element={<PageTransition><ProfilePage /></PageTransition>} />
              <Route path="/settings" element={<PageTransition><SettingsPage /></PageTransition>} />

              <Route element={<AdminGuard />}>
                <Route path="/admin/dashboard" element={<PageTransition><AdminDashboardPage /></PageTransition>} />
                <Route path="/admin/users" element={<PageTransition><AdminUsersPage /></PageTransition>} />
                <Route path="/admin/users/:userId" element={<PageTransition><AdminUserDetailPage /></PageTransition>} />
                <Route path="/admin/tickets" element={<PageTransition><AdminTicketsPage /></PageTransition>} />
                <Route element={<AdminOnlyGuard />}>
                  <Route path="/admin/payments" element={<PageTransition><AdminPaymentsPage /></PageTransition>} />
                  <Route path="/admin/tariffs" element={<PageTransition><AdminTariffsPage /></PageTransition>} />
                  <Route path="/admin/operators" element={<PageTransition><AdminOperatorsPage /></PageTransition>} />
                  <Route path="/admin/settings" element={<PageTransition><AdminSettingsPage /></PageTransition>} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<PageTransition><NotFoundPage /></PageTransition>} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}
