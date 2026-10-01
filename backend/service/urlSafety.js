import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class AnalysisError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0",8], ["10.0.0.0",8], ["100.64.0.0",10], ["127.0.0.0",8],
  ["169.254.0.0",16], ["172.16.0.0",12], ["192.0.0.0",24], ["192.0.2.0",24],
  ["192.88.99.0",24], ["192.168.0.0",16], ["198.18.0.0",15], ["198.51.100.0",24], ["203.0.113.0",24], ["224.0.0.0",3],
]) blocked.addSubnet(ip, bits, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [["2001::",23], ["2001:db8::",32], ["2002::",16], ["3fff::",20]]) blocked.addSubnet(ip,bits,"ipv6");

export function isPublicAddress(ip) {
  if (isIP(ip) === 4) return !blocked.check(ip,"ipv4");
  return isIP(ip) === 6 && globalV6.check(ip,"ipv6") && !blocked.check(ip,"ipv6");
}
export function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new AnalysisError(400,"URL is required");
  const input = value.trim();
  if (input.length > 2048 || /[\\\s]/.test(input)) throw new AnalysisError(400,"Invalid URL");
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input) && !/^[^/:]+:\d+(?:\/|$)/.test(input);
  let url;
  try { url = new URL(hasScheme ? input : `https://${input}`); }
  catch { throw new AnalysisError(400,"Invalid URL"); }
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password) {
    throw new AnalysisError(400,"Only HTTP(S) URLs without credentials are allowed");
  }
  if (url.port && !["80","443"].includes(url.port)) throw new AnalysisError(400,"Only ports 80 and 443 are allowed");
  return url;
}
export async function validatePublicUrl(url, resolver = lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g,"").replace(/\.$/,"");
  if (hostname === "localhost" || /\.(localhost|local|internal)$/i.test(hostname)) {
    throw new AnalysisError(400,"Internal destinations are not allowed");
  }
  let addresses;
  try { addresses = isIP(hostname) ? [{ address: hostname }] : await resolver(hostname,{ all:true }); }
  catch { throw new AnalysisError(502,"Could not resolve the destination"); }
  if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) {
    throw new AnalysisError(400,"Internal or reserved destinations are not allowed");
  }
  return addresses[0].address;
}
