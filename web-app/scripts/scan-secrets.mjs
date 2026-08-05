#!/usr/bin/env node
/**
 * Lightweight pre-commit secret scanner.
 *
 * Scans newly staged files (git diff --cached) for common credential
 * patterns and fails the commit with a non-zero exit code on a match.
 * The full secret audit (Gitleaks) runs in CI (security-web-app.yml).
 */

import { execSync } from "node:child_process";

const SKIP_PATHS = [
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /\.env\.example$/,
  /migration\.sql$/,
  /\.md$/,
  /\.min\.(js|css)$/,
  /\.snap$/,
  // The scanner itself defines the literal pattern strings (self-match).
  /scan-secrets\.mjs$/,
];

const SECRET_PATTERNS = [
  /(?:aws_access_key_id|AKIA[0-9A-Z]{16})/i,
  /(?:aws_secret_access_key)\s*[=:]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(gsk_[A-Za-z0-9]{20,})\b/,
  /\b(hf_[A-Za-z0-9]{20,})\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /github_pat_[A-Za-z0-9_]{20,}/i,
  /\bghp_[A-Za-z0-9]{36,}\b/i,
  /\b(?:passwd|password|secret|token|api[_-]?key)\s*[=:]\s*['"][^'"\s]{8,}['"]/i,
];

function stagedFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function main() {
  const files = stagedFiles().filter((file) => !SKIP_PATHS.some((re) => re.test(file)));
  const violations = [];

  for (const file of files) {
    const content = execSync(`git show :"${file}"`, { encoding: "utf8" });
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${file}:${index + 1}: potential secret matched ${pattern}`);
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error("pre-commit secret scan failed:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    console.error("Please remove the value (use a placeholder or environment variable).");
    process.exit(1);
  }
  console.log("pre-commit secret scan: OK");
}

main();
