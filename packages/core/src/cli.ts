const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
} as const;

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY ?? false;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface ServiceLogger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export function createLogger(service: string): ServiceLogger {
  const color = useColor();
  const paint = (c: string, s: string) => (color ? `${c}${s}${COLORS.reset}` : s);
  const line = (level: string, msg: string) =>
    `${paint(COLORS.dim, stamp())} ${paint(COLORS.cyan, `[${service}]`)} ${level} ${msg}`;
  return {
    info: (msg) => process.stdout.write(`${line(paint(COLORS.blue, "info"), msg)}\n`),
    success: (msg) => process.stdout.write(`${line(paint(COLORS.green, "ok"), msg)}\n`),
    warn: (msg) => process.stdout.write(`${line(paint(COLORS.yellow, "warn"), msg)}\n`),
    error: (msg, err) => {
      const detail = err instanceof Error ? ` :: ${err.message}` : err ? ` :: ${String(err)}` : "";
      process.stderr.write(`${line(paint(COLORS.red, "error"), `${msg}${detail}`)}\n`);
    },
  };
}

export function printBanner(service: string, rows: Array<[string, string]>): void {
  const log = createLogger(service);
  log.info(`starting ${service}`);
  for (const [k, v] of rows) log.info(`${k}=${v}`);
}

export function printTable(head: string[], rows: string[][]): void {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (r: string[]) => r.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  process.stdout.write(`${fmt(head)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const r of rows) process.stdout.write(`${fmt(r)}\n`);
}

export function printHelp(name: string, usage: string, commands: Array<[string, string]>): void {
  process.stdout.write(`\n${name}\n\nUsage:\n  ${usage}\n\nCommands:\n`);
  for (const [cmd, desc] of commands) process.stdout.write(`  ${cmd.padEnd(28)} ${desc}\n`);
  process.stdout.write("\n");
}
