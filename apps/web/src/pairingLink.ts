import { parsePairingCode } from "@crosschat/core";

const STASH_KEY = "crosschat:pair-code";

/** Link a generated code so it survives a fresh tab or an OAuth round-trip. */
export function buildPairingLink(code: string): string {
  return `${window.location.origin}/chat?code=${encodeURIComponent(code)}`;
}

/**
 * Read `?code=` once and remove it from the URL so a refresh doesn't
 * re-trigger the claim dialog. Returns the normalized code or null.
 */
export function takePairCodeParam(): string | null {
  const raw = new URLSearchParams(window.location.search).get("code");
  if (!raw) return null;
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return parsePairingCode(raw);
}

export function stashPairCode(code: string): void {
  try {
    sessionStorage.setItem(STASH_KEY, code);
  } catch {
    // Private mode: the link still works, it just won't survive OAuth.
  }
}

/** Returns the stashed code once, then clears it. */
export function takeStashedPairCode(): string | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    return parsePairingCode(raw);
  } catch {
    return null;
  }
}
