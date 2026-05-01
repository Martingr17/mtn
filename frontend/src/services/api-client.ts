import axios from "axios";

import { useAuthStore } from "@/store/auth-store";

const BUCKET_HOST_API_BASES: Record<string, string> = {
  "mtn.website.yandexcloud.net": "https://d5dc0uqj173qg7q2s83h.y3q8o1jq.apigw.yandexcloud.net/api/v1",
};

function resolveApiBaseUrl() {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const legacyBucketMappingEnabled =
    import.meta.env.VITE_ENABLE_LEGACY_BUCKET_API_MAPPING === "true";

  if (legacyBucketMappingEnabled && typeof window !== "undefined") {
    const bucketApiBase = BUCKET_HOST_API_BASES[window.location.hostname];
    if (bucketApiBase) {
      return bucketApiBase;
    }
  }

  return envBaseUrl || "/api/v1";
}

function resolveWithCredentials(baseURL: string) {
  const envValue = import.meta.env.VITE_WITH_CREDENTIALS?.trim();
  if (envValue) {
    return envValue !== "false";
  }

  if (typeof window === "undefined" || baseURL.startsWith("/")) {
    return true;
  }

  return new URL(baseURL).origin === window.location.origin;
}

const baseURL = resolveApiBaseUrl();

const api = axios.create({
  baseURL,
  withCredentials: resolveWithCredentials(baseURL),
});

let refreshRequest: Promise<unknown> | null = null;

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as
      | (typeof error.config & { _retry?: boolean; headers: Record<string, string> })
      | undefined;
    const authStore = useAuthStore.getState();
    const isRefreshRequest = Boolean(originalRequest?.url?.includes("/auth/refresh"));

    if (
      error.response?.status === 401 &&
      authStore.refreshToken &&
      !originalRequest?._retry &&
      !isRefreshRequest
    ) {
      originalRequest._retry = true;

      if (!refreshRequest) {
        refreshRequest = api.post("/auth/refresh", {
          refresh_token: authStore.refreshToken,
        });
      }

      try {
        const refreshResponse = await refreshRequest;
        const tokens = (refreshResponse as { data: { access_token: string; refresh_token: string; expires_in: number; role: string } }).data;
        useAuthStore.getState().setSession({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          role: tokens.role as never,
        });

        originalRequest.headers.Authorization = `Bearer ${tokens.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().clearSession();
        return Promise.reject(refreshError);
      } finally {
        refreshRequest = null;
      }
    }

    return Promise.reject(error);
  },
);

export { api };
