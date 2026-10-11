// Generates long random secrets and fills them into .env.
// Default: only fills keys that are missing or empty.
//   node scripts/generate-secrets.mjs --rotate   regenerates both secrets.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, ".env");
const rotate = process.argv.includes("--rotate");

function makeSecret(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

const targets = [
  { key: "SESSION_SECRET", bytes: 64 },
  { key: "TELEGRAM_WEBHOOK_SECRET", bytes: 32 },
];

if (!fs.existsSync(envFile)) {
  console.error(".env not found. Copy .env.example to .env first.");
  process.exit(1);
}

const lines = fs.readFileSync(envFile, "utf8").split("\n");
let changed = false;

for (const { key, bytes } of targets) {
  const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
  const secret = makeSecret(bytes);
  if (idx === -1) {
    lines.push(`${key}=${secret}`);
    changed = true;
    console.log(`${key}: added (${secret.length} chars)`);
  } else {
    const current = lines[idx].slice(key.length + 1);
    if (rotate || current.trim().length === 0) {
      lines[idx] = `${key}=${secret}`;
      changed = true;
      console.log(`${key}: ${rotate ? "rotated" : "filled"} (${secret.length} chars)`);
    } else {
      console.log(`${key}: already set (${current.length} chars), skipped`);
    }
  }
}

if (changed) fs.writeFileSync(envFile, lines.join("\n"));
console.log("done.");
