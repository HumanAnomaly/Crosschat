import { useEffect } from "react";
import { SessionProvider, useSession } from "./auth/session";
import { LangProvider, useLang } from "./i18n";
import { ThemeProvider } from "./theme";
import { navigate, usePathname } from "./router";
import LandingPage from "./pages/LandingPage";
import ChatPage from "./pages/ChatPage";

function NotFound() {
  const { t } = useLang();
  return (
    <div className="bg-base-100 text-base-content flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 text-center">
        <p className="font-mono text-sm opacity-60">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{t("notfound.title")}</h1>
        <p className="mt-2 text-sm opacity-70">{t("notfound.sub")}</p>
        <div className="mt-6 flex justify-center gap-2">
          <a className="btn btn-ghost btn-sm" href="/">
            {t("notfound.home")}
          </a>
          <a className="btn btn-primary btn-sm" href="/chat">
            {t("notfound.openChat")}
          </a>
        </div>
      </main>
    </div>
  );
}

function Routes() {
  const path = usePathname();
  const { me, authLoading } = useSession();

  useEffect(() => {
    if (authLoading) return;
    if (path === "/" && me) navigate("/chat");
    else if (path === "/chat" && !me) navigate("/");
  }, [path, me, authLoading]);

  if (path === "/chat") {
    if (!authLoading && !me) return <LandingPage />;
    return <ChatPage />;
  }
  if (path === "/") {
    if (!authLoading && me) return <ChatPage />;
    return <LandingPage />;
  }
  return <NotFound />;
}

export default function App() {
  return (
    <LangProvider>
      <SessionProvider>
        <ThemeProvider>
          <Routes />
        </ThemeProvider>
      </SessionProvider>
    </LangProvider>
  );
}
