/**
 * Startup guard for secrets that must never be placeholder values.
 *
 * This only checks shapes (placeholders, repeated characters). No
 * hardcoded fingerprints of past values are stored here.
 */

export interface SecretAuditResult {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/**
 * Shape checks that catch a placeholder or a truncated paste even when the value
 * is not on the denylist.
 */
export function auditSecretValue(key: string, value: string): SecretAuditResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  const trimmed = value.trim();
  if (!trimmed) return { ok: true, problems, warnings };

  if (/^(change-me|dev-only|password|secret|test|dummy|placeholder)/i.test(trimmed)) {
    problems.push(`${key} looks like a placeholder. Run: pnpm generate:secrets`);
  }

  if (trimmed === "ganti-dengan-string-acak-panjang") {
    problems.push(`${key} still holds a known template placeholder. Run: pnpm generate:secrets`);
  }
  if (trimmed.length < 16 && !key.includes("PORT") && !key.includes("TTL")) {
    warnings.push(`${key} is only ${trimmed.length} characters; long random values are expected.`);
  }
  if (/^(.)\1+$/.test(trimmed)) {
    problems.push(`${key} is a single repeated character.`);
  }

  return { ok: problems.length === 0, problems, warnings };
}


export function assertSecretsUsable(values: Record<string, string>): void {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const result = auditSecretValue(key, value ?? "");
    problems.push(...result.problems);
    warnings.push(...result.warnings);
  }
  for (const w of warnings) {
    process.stderr.write(`[warn] ${w}\n`);
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start with unsafe secrets:\n  - ${problems.join("\n  - ")}`);
  }
}
