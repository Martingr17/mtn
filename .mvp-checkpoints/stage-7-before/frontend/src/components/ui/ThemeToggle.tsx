import { MoonStar, SunMedium } from "lucide-react";
import { toast } from "sonner";

import { useAppStore } from "@/store/app-store";
import type { ThemeMode } from "@/types/domain";
import { cn } from "@/utils/cn";
import { getThemeToastMessage, THEME_OPTIONS } from "@/utils/theme";

export function ThemeToggle() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  const handleThemeChange = (nextTheme: ThemeMode) => {
    if (nextTheme === theme) {
      return;
    }

    setTheme(nextTheme);
    toast.success(getThemeToastMessage(nextTheme));
  };

  return (
    <div className="theme-toggle-shell">
      <div className="theme-toggle" role="group" aria-label="Переключение темы">
        <span
          className={cn(
            "theme-toggle-icon",
            theme === "black-beige" && "is-black-beige",
          )}
          aria-hidden="true"
        >
          {theme === "gradient" ? <SunMedium size={16} /> : <MoonStar size={16} />}
        </span>

        {THEME_OPTIONS.map(({ value, label }) => {
          const Icon = value === "gradient" ? SunMedium : MoonStar;

          return (
            <button
              key={value}
              type="button"
              className={cn("theme-option", theme === value && "is-active")}
              onClick={() => handleThemeChange(value)}
              aria-pressed={theme === value}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
