import { createStore } from "zapo-js";
import { createSqliteStore } from "@zapo-js/store-sqlite";
import { createLogger } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { sessionFilePath } from "./session.js";

export type AnyClient = any;
export type AnyStore = any;

function zapoLogger() {
  const log = createLogger("whatsapp");
  const sink = (level: string) => (message: string, context?: Record<string, unknown>) => {
    if (level === "trace" || level === "debug" || level === "info") return;
    const extra = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
    if (level === "error") log.error(`${message}${extra}`);
    else log.warn(`${message}${extra}`);
  };
  return {
    level: "warn" as const,
    trace: sink("trace"),
    debug: sink("debug"),
    info: sink("info"),
    warn: sink("warn"),
    error: sink("error"),
    child() {
      return this;
    },
  };
}

export function createWhatsappStore(sessionName = whatsappConfig.session): AnyStore {
  const file = sessionFilePath(sessionName);
  return createStore({
    backends: { sqlite: createSqliteStore({ path: file }) },
    providers: {
      auth: "sqlite",
      signal: "sqlite",
      preKey: "sqlite",
      session: "sqlite",
      identity: "sqlite",
      senderKey: "sqlite",
      appState: "sqlite",
      privacyToken: "sqlite",
      messages: "sqlite",
      threads: "sqlite",
      contacts: "sqlite",
    },
  }) as AnyStore;
}

export async function createWhatsappClient(sessionName = whatsappConfig.session): Promise<{ client: AnyClient; store: AnyStore }> {
  const { WaClient } = await import("zapo-js");
  const store = createWhatsappStore(sessionName);
  const client = new WaClient(
    {
      store,
      sessionId: sessionName,
      history: { enabled: false },
      markOnlineOnConnect: false,
    },
    zapoLogger() as any,
  ) as AnyClient;
  return { client, store };
}
