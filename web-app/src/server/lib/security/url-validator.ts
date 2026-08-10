import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { SsrfBlockedError } from "@/server/lib/errors";

const CLOUD_METADATA_IPS = ["169.254.169.254"];

// ─── IPv4 ────────────────────────────────────────────────────────────────────

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

function isBlockedIpv4(ip: string): boolean {
  if (ip === "127.0.0.1" || ip.startsWith("127.")) {
    return true;
  }
  if (CLOUD_METADATA_IPS.includes(ip)) {
    return true;
  }
  return PRIVATE_RANGES.some((range) => isInCidr(ip, range.network, range.prefix));
}

// ─── IPv6 ────────────────────────────────────────────────────────────────────

/**
 * Parses an IPv6 address into a 128-bit BigInt. Handles "::" compression and
 * trailing embedded IPv4 ("::ffff:192.0.2.1"). Returns null when unparsable.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  if (!isIPv6(ip)) {
    return null;
  }
  const convertV4 = (part: string): string[] => {
    if (!part) {
      return [];
    }
    if (!part.includes(".")) {
      return [part];
    }
    const parts = part.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return [];
    }
    const hi = ((parts[0]! << 8) | parts[1]!) & 0xffff;
    const lo = ((parts[2]! << 8) | parts[3]!) & 0xffff;
    return [hi.toString(16), lo.toString(16)];
  };

  // macOS/Linux resolvers return IPv6 addresses in uncompressed form (no "::")
  // — split() then yields a single element and rightRaw would be undefined,
  // crashing convertV4. Default to "" so a full 8-group address parses as
  // [all groups] + [] instead of throwing on part.includes().
  const [leftRaw, rightRaw = ""] = ip.split("::");
  const left = convertV4(leftRaw);
  const right = convertV4(rightRaw);
  const fill = 8 - left.length - right.length;
  if (fill < 0) {
    return null;
  }
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8) {
    return null;
  }

  let result = BigInt(0);
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (Number.isNaN(value)) {
      return null;
    }
    result = (result << BigInt(16)) | BigInt(value);
  }
  return result;
}

function ipv6InPrefix(addr: bigint, network: string, prefix: number): boolean {
  const net = ipv6ToBigInt(network);
  if (net === null) {
    return false;
  }
  const mask =
    prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(prefix)) - BigInt(1)) << BigInt(128 - prefix);
  return (addr & mask) === (net & mask);
}

/**
 * IPv6 ranges that must never be reached: loopback, unspecified, link-local,
 * unique-local (ULA), and multicast. DNS returns these only for misconfigured
 * hosts, but the guard must not rely on that.
 */
const IPV6_BLOCKED: Array<{ label: string; network: string; prefix: number }> = [
  { label: "IPv6 loopback", network: "::1", prefix: 128 },
  { label: "IPv6 unspecified", network: "::", prefix: 128 },
  { label: "IPv6 link-local", network: "fe80::", prefix: 10 },
  { label: "IPv6 unique local", network: "fc00::", prefix: 7 },
  { label: "IPv6 multicast", network: "ff00::", prefix: 8 },
];

/**
 * IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96, deprecated) IPv6
 * addresses embed a real IPv4 destination — the IPv4 rules must apply to it,
 * otherwise 127.0.0.1 / 169.254.169.254 etc. slip through as ::ffff:127.0.0.1.
 */
function extractEmbeddedIpv4(addr: bigint): string | null {
  const isMapped = addr >> BigInt(48) === BigInt(0) && addr >> BigInt(32) === BigInt(0xffff);
  const isCompatible = addr >> BigInt(32) === BigInt(0);
  if (!isMapped && !isCompatible) {
    return null;
  }
  const v4 = Number(addr & BigInt(0xffffffff));
  return `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
}

function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }
  const addr = ipv6ToBigInt(ip);
  if (addr === null) {
    // Unknown/unsupported address format — fail closed rather than allow a
    // parse miss through the guard.
    return true;
  }
  if (IPV6_BLOCKED.some((range) => ipv6InPrefix(addr, range.network, range.prefix))) {
    return true;
  }
  const embeddedV4 = extractEmbeddedIpv4(addr);
  return embeddedV4 !== null && isBlockedIpv4(embeddedV4);
}

/**
 * SSRF guard (GUARDRAILS M6.3 / M2.7). Resolves the hostname and rejects
 * loopback (IPv4 + IPv6), RFC1918 private, link-local, cloud-metadata IPs,
 * IPv6 ULA/multicast, and IPv4-mapped-IPv6 forms of all of the above.
 *
 * ⚠️ Known limitation: the DNS lookup and the subsequent fetch are two
 * separate resolutions, so a DNS-rebinding attack can theoretically swap the
 * answer between check and connect. The fetch layer mitigates this by
 * re-validating every redirect hop (see scraper.ts fetchWithRedirectValidation)
 * and re-validating the final response URL after the fetch.
 *
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
