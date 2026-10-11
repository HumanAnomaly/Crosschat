import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

export type ThemeName = "crosschat" | "crosschat-dark";

const STORAGE_KEY = "cc-theme";

function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "crosschat-dark" || saved === "crosschat") return saved;
  } catch {
    // private-mode storage throws; fall through to default theme
  }
  return "crosschat";
}

interface ThemeValue {
  theme: ThemeName;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue>({ theme: "crosschat", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // private-mode storage throws; theme still applies for this session
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "crosschat-dark" ? "crosschat" : "crosschat-dark"));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "crosschat-dark";
  return (
    <button
      className="btn btn-ghost btn-sm btn-circle"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
