"use client";

import { useTheme } from "@/lib/theme";
import { useHotkeys } from "react-hotkeys-hook";
import { Sun, Moon, MonitorPlay } from "@/lib/ui/icons";
import { TOPBAR_ICON_BUTTON } from "@/components/shell/icon-button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  useHotkeys("mod+shift+l", cycle, { preventDefault: true }, [theme]);

  const Icon = theme === "dark" ? Moon : theme === "system" ? MonitorPlay : Sun;

  return (
    <button
      type="button"
      onClick={cycle}
      className={TOPBAR_ICON_BUTTON}
      aria-label={`Tema: ${theme}. Cmd+Shift+L para alternar.`}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
