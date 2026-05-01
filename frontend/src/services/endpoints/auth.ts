import { api } from "@/services/api-client";
import type { EntityId, LoginResponse } from "@/types/domain";

export interface AuthActionResponse {
  message: string;
  user_id?: EntityId;
  requires_confirmation?: boolean;
  verification_channel?: "email" | "sms" | null;
  verification_target?: string | null;
  verification_expires_in?: number | null;
  resend_available_in?: number | null;
  demo_email_code?: string | null;
  demo_email_address?: string | null;
  demo_email_ttl?: number | null;
  demo_sms_code?: string | null;
  demo_sms_phone?: string | null;
  demo_sms_ttl?: number | null;
}

export interface LoginPayload {
  email: string;
  password?: string;
  email_code?: string;
  totp_code?: string;
}

export interface RegisterPayload {
  billing_id: string;
  phone: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface RegisterConfirmPayload {
  phone: string;
  email?: string;
  email_code: string;
  password?: string;
}

export interface ResetPasswordPayload {
  phone: string;
  sms_code?: string;
  new_password?: string;
}

export const authService = {
  async login(payload: LoginPayload) {
    const { data } = await api.post<LoginResponse>("/auth/login", payload);
    return data;
  },
  async completeTwoFactorLogin(twoFactorToken: string, code: string) {
    const { data } = await api.post<LoginResponse>("/auth/2fa/login", {
      two_factor_token: twoFactorToken,
      code,
    });
    return data;
  },
  async register(payload: RegisterPayload) {
    const { data } = await api.post<AuthActionResponse>("/auth/register", payload);
    return data;
  },
  async confirmRegister(payload: RegisterConfirmPayload) {
    const { data } = await api.post<AuthActionResponse>("/auth/register/confirm", payload);
    return data;
  },
  async resetPassword(payload: ResetPasswordPayload) {
    const { data } = await api.post<AuthActionResponse>("/auth/reset-password", payload);
    return data;
  },
  async logout() {
    const { data } = await api.post("/auth/logout");
    return data;
  },
};
