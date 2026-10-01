import { SessionProvider } from "./auth/session";
import { ThemeProvider } from "./theme";
import { usePathname } from "./router";
import LandingPage from "./pages/LandingPage";
import ChatPage from "./pages/ChatPage";

function NotFound() {
  return (
    <div className="bg-base-200 text-base-content flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <div className="hero bg-base-100 rounded-box border border-base-300 shadow-sm">
          <div className="hero-content flex-col py-10 text-center">
            <p className="font-mono text-sm opacity-70">404</p>
            <h1 className="text-3xl font-bold">Page not found</h1>
            <p className="text-sm opacity-70">Try the landing or your chat room.</p>
            <div className="flex gap-3">
              <a className="btn btn-outline btn-sm" href="/">
                Home
              </a>
              <a className="btn btn-primary btn-sm" href="/chat">
                Open chat
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Routes() {
  const path = usePathname();
  if (path === "/chat") return <ChatPage />;
  if (path === "/") return <LandingPage />;
  return <NotFound />;
}

export default function App() {
  return (
    <SessionProvider>
      <ThemeProvider>
        <Routes />
      </ThemeProvider>
    </SessionProvider>
  );
}
