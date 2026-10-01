import { useCallback, useEffect, useState } from "react";

function normalize(path: string): string {
  if (path === "/" || path === "") return "/";
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (clean === "/chat" || clean.startsWith("/chat/")) return "/chat";
  return clean;
}

export function getPathname(): string {
  return normalize(window.location.pathname);
}

export function navigate(to: string) {
  const target = normalize(to);
  if (window.location.pathname !== target) {
    window.history.pushState(null, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  window.scrollTo({ top: 0 });
}

export function usePathname(): string {
  const [path, setPath] = useState(getPathname);
  useEffect(() => {
    const onChange = () => setPath(getPathname());
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

export function useNavigate() {
  return useCallback((to: string) => navigate(to), []);
}
