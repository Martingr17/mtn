import { create } from "zustand";

import type { ThemeMode } from "@/types/domain";
import { safeStorageGetString, safeStorageSetString } from "@/utils/storage";
import { getStoredTheme, saveTheme } from "@/utils/theme";

const LANGUAGE_STORAGE_KEY = "mtn_language";

export interface AppState {
  theme: ThemeMode;
  language: string;
  sidebarOpen: boolean;
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (language: string) => void;
  setSidebarOpen: (isOpen: boolean) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  theme: getStoredTheme(),
  language: safeStorageGetString(LANGUAGE_STORAGE_KEY, "ru"),
  sidebarOpen: false,
  setTheme: (theme) => {
    saveTheme(theme);
    set({ theme });
  },
  setLanguage: (language) => {
    safeStorageSetString(LANGUAGE_STORAGE_KEY, language);
    set({ language });
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
