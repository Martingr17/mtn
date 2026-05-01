import { api } from "@/services/api-client";
import type { UserProfile } from "@/types/domain";

export interface UserUpdatePayload {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  language?: string;
  notification_settings?: Record<string, unknown>;
}

export const usersService = {
  async me() {
    const { data } = await api.get<UserProfile>("/users/me");
    return data;
  },
  async updateProfile(payload: UserUpdatePayload) {
    const { data } = await api.put("/users/me", payload);
    return data;
  },
  async uploadAvatar(file: File) {
    const body = new FormData();
    body.append("avatar", file);
    const { data } = await api.post("/users/me/avatar", body, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  async sessions() {
    const { data } = await api.get<Array<Record<string, unknown>>>("/users/me/sessions");
    return data;
  },
  async revokeSession(sessionId: number) {
    const { data } = await api.delete(`/users/me/sessions/${sessionId}`);
    return data;
  },
};
