import { pino } from "pino";
import { randomUUID } from "node:crypto";

const redactFields = [
  "password",
  "passwd",
  "pwd",
  "token",
  "jwt",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "clientSecret",
  "creditCard",
  "cvv",
  "cardNumber",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
];

type LoggerBindings = Record<string, unknown>;

export function createLogger(module: string, bindings?: LoggerBindings) {
  return pino({
    name: module,
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    redact: { paths: redactFields, censor: "[REDACTED]" },
    base: { pid: undefined, hostname: undefined },
    mixin() {
      return { correlationId: randomUUID() };
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  }).child(bindings ?? {});
}

export function createRequestLogger(module: string, correlationId: string) {
  return createLogger(module, { correlationId });
}
