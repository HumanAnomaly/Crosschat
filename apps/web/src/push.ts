import { getPushConfig, subscribePushServer, unsubscribePushServer } from "./api";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyToUint8(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sw(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

/** Server-known state is the subscription itself; absence means off. */
export async function pushStatus(): Promise<boolean> {
  const reg = await sw();
  return (await reg.pushManager.getSubscription()) !== null;
}

export async function enablePush(): Promise<boolean> {
  const cfg = await getPushConfig();
  if (!cfg.enabled || !cfg.publicKey) return false;
  if (Notification.permission === "denied") return false;
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return false;
  const reg = await sw();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToUint8(cfg.publicKey) });
  }
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) return false;
  await subscribePushServer({ endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return true;
}

export async function disablePush(): Promise<void> {
  const reg = await sw();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try {
    await unsubscribePushServer(sub.endpoint);
  } finally {
    await sub.unsubscribe();
  }
}
