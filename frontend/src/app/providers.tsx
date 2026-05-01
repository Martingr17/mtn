import type { PropsWithChildren } from "react";
import { useEffect } from "react";

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster, toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { queryKeys } from "@/services/query-keys";
import { usersService } from "@/services/endpoints/users";
import { useAppStore } from "@/store/app-store";
import type { AppState } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import { applyTheme } from "@/utils/theme";

function resolveRouterBasename() {
  const configuredBase = import.meta.env.VITE_ROUTER_BASENAME ?? import.meta.env.BASE_URL ?? "/";
  const normalizedBase = configuredBase === "/" ? "/" : configuredBase.replace(/\/+$/, "");
  return normalizedBase === "/" ? undefined : normalizedBase;
}

function ThemeController() {
  const theme = useAppStore((state: AppState) => state.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return null;
}

function SessionBootstrap() {
  const accessToken = useAuthStore((state: AuthState) => state.accessToken);
  const setUser = useAuthStore((state: AuthState) => state.setUser);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);

  const userQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: usersService.me,
    enabled: Boolean(accessToken),
    retry: false,
  });

  useEffect(() => {
    if (userQuery.data) {
      setUser(userQuery.data);
    }
  }, [setUser, userQuery.data]);

  useEffect(() => {
    if (userQuery.isError) {
      clearSession();
      toast.error("Сессия завершилась. Войдите снова.");
    }
  }, [clearSession, userQuery.isError]);

  return null;
}

export function AppProviders({ children }: PropsWithChildren) {
  const basename = resolveRouterBasename();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <ThemeController />
        <SessionBootstrap />
        {children}
      </BrowserRouter>
      <Toaster richColors closeButton position="top-right" duration={3000} />
    </QueryClientProvider>
  );
}
