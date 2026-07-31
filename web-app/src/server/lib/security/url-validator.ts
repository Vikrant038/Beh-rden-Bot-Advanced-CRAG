import { lookup } from "node:dns/promises";
import { SsrfBlockedError } from "@/server/lib/errors";

const LOOPBACK_RANGES = [
  { label: "IPv4 loopback", test: (ip: string) => ip === "127.0.0.1" || ip.startsWith("127.") },
  { label: "IPv6 loopback", test: (ip: string) => ip === "::1" || ip === "0:0:0:0:0:0:0:1" },
];

function isInCidr(ip: string, network: string, prefix: number): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const netParts = network.split(".").map(Number);
  const ipInt = parts.reduce((acc, part) => (acc << 8) | part, 0) >>> 0;
  const netInt = netParts.reduce((acc, part) => (acc << 8) | part, 0) >>> 0;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

const PRIVATE_RANGES: Array<{ network: string; prefix: number }> = [
  { network: "10.0.0.0", prefix: 8 },
  { network: "172.16.0.0", prefix: 12 },
  { network: "192.168.0.0", prefix: 16 },
  { network: "169.254.0.0", prefix: 16 },
  { network: "0.0.0.0", prefix: 8 },
];

const CLOUD_METADATA_IPS = ["169.254.169.254"];

function isBlockedIp(ip: string): boolean {
  if (LOOPBACK_RANGES.some((range) => range.test(ip))) {
    return true;
  }
  if (CLOUD_METADATA_IPS.includes(ip)) {
    return true;
  }
  return PRIVATE_RANGES.some((range) => isInCidr(ip, range.network, range.prefix));
}

/**
 * SSRF guard (GUARDRAILS M6.3 / M2.7). Resolves the hostname and rejects
 * loopback, RFC1918 private, link-local, and cloud-metadata IPs.
 * @throws SsrfBlockedError when the URL protocol is invalid or resolves to a blocked address.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfBlockedError(rawUrl);
  }

  const resolved = await lookup(url.hostname, { all: true });
  for (const address of resolved) {
    if (isBlockedIp(address.address)) {
      throw new SsrfBlockedError(rawUrl);
    }
  }
}
