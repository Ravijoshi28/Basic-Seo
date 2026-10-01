import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { EventEmitter } from "node:events";
import puppeteer from "puppeteer";
import { normalizeUrl, validatePublicUrl, isPublicAddress } from "../service/urlSafety.js";
import { createSafeProxy } from "../service/safeProxy.js";
import { analyzeUrl, Analyzer, buildFindings, extractSeo } from "../service/Analyzer.js";

test("URL normalization rejects schemes, credentials, malformed input and unusual ports", () => {
  assert.equal(normalizeUrl("example.com").href, "https://example.com/");
  assert.equal(normalizeUrl("example.com:443/path").href, "https://example.com/path");
  for (const value of [undefined, [], "", "ftp://example.com", "file:///etc/passwd", "https://user:pass@example.com", "http://example.com:3000", "bad host", "https://example.com\\foo"]) {
    assert.throws(() => normalizeUrl(value), { status: 400 });
  }
});

test("blocks private, reserved, encoded and mapped IP addresses", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true);
  for (const value of ["http://localhost", "http://127.1", "http://2130706433", "http://[::1]"]) {
    await assert.rejects(validatePublicUrl(normalizeUrl(value)), { status: 400 });
  }
  await assert.rejects(validatePublicUrl(normalizeUrl("https://example.com"), async () => [{address:"8.8.8.8"}, {address:"10.0.0.1"}]), {status:400});
  assert.equal(await validatePublicUrl(normalizeUrl("https://example.com"), async () => [{address:"8.8.8.8"}]), "8.8.8.8");
});

test("proxy blocks both HTTP and CONNECT requests to loopback", async () => {
  const proxy = await createSafeProxy();
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.get(proxy.url, {path:"http://127.0.0.1/"}, (response) => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
    });
    assert.equal(status, 403);
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(new URL(proxy.url).port, "127.0.0.1", () => socket.write("CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n"));
      socket.on("error", reject);
      socket.once("data", (data) => { resolve(data.toString()); socket.destroy(); });
    });
    assert.match(result, /^HTTP\/1.1 403/);
  } finally { await proxy.close(); }
});

test("SEO extraction ignores empty headings and preserves decorative alt attributes", async () => {
  const browser = await puppeteer.launch({timeout:15000});
  try {
    const page = await browser.newPage();
    await page.setContent('<title> Test </title><h1> </h1><meta name="googlebot" content="noindex"><img alt=""><img><link rel="alternate canonical" href="https://example.com/">' + "<h2>Heading</h2>".repeat(250));
    const seo = await page.evaluate(extractSeo);
    assert.deepEqual(seo.h1, []);
    assert.equal(seo.h2.length, 200);
    assert.equal(seo.imagesWithoutAltCount, 1);
    assert.equal(seo.canonical, "https://example.com/");
    const codes = buildFindings(seo, 404).map(({code}) => code);
    assert.ok(codes.includes("MISSING_H1"));
    assert.ok(codes.includes("INDEXING_DIRECTIVE"));
    assert.ok(codes.includes("HTTP_ERROR"));
  } finally { await browser.close(); }
});

test("analysis handles non-HTML, blocked redirects, deadlines and cleanup", async (t) => {
  let closed = 0;
  let killed = 0;
  let contentType = "application/pdf";
  const page = new EventEmitter();
  Object.assign(page, {
    setBypassServiceWorker: async () => {}, setRequestInterception: async () => {},
    mainFrame: () => page,
    goto: async () => ({headers: () => ({"content-type":contentType}), status: () => 200}),
    waitForNetworkIdle: async () => {},
    evaluate: async () => ({title:"Test", description:"Description", h1:["Title"], canonical:"", imagesWithoutAltCount:0}),
    url: () => "https://8.8.8.8/",
  });
  t.mock.method(puppeteer, "launch", async () => ({newPage:async () => page, close:async () => {closed++;}, process:() => ({kill:() => {killed++;}})}));
  await assert.rejects(analyzeUrl("https://8.8.8.8"), {status:422});
  assert.equal(closed,1);
  contentType = "text/html";
  const result = await analyzeUrl("https://8.8.8.8");
  assert.ok(Array.isArray(result.issues));
  assert.ok(Array.isArray(result.findings));
  page.goto = async () => {
    let aborted = false;
    const request = {url:() => "http://127.0.0.1/", isNavigationRequest:() => true, frame:() => page, isInterceptResolutionHandled:() => aborted, abort:async () => {aborted = true;}};
    await page.listeners("request").at(-1)(request);
    assert.ok(aborted);
    throw new Error("Blocked");
  };
  await assert.rejects(analyzeUrl("https://8.8.8.8"), {status:400});
  page.goto = () => new Promise(() => {});
  await assert.rejects(analyzeUrl("https://8.8.8.8", {timeoutMs:30}), {status:504});
  assert.equal(closed,4);
  assert.ok(killed > 0);
  const controller = new AbortController();
  const pending = analyzeUrl("https://8.8.8.8", {signal:controller.signal});
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, {status:499});
  assert.equal(closed,5);
});

test("handler caps concurrent browser jobs and releases slots", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.mock.method(puppeteer, "launch", async () => { await gate; throw new Error("Test launch failure"); });
  const response = () => {
    const res = new EventEmitter();
    Object.assign(res, {statusCode:200, set:() => res, status:(code) => {res.statusCode=code; return res;}, json:(body) => body});
    return res;
  };
  const req = (ip) => ({ip, query:{url:"https://8.8.8.8"}});
  const first = Analyzer(req("concurrent-1"),response());
  const second = Analyzer(req("concurrent-2"),response());
  const busy = response();
  await Analyzer(req("concurrent-3"),busy);
  assert.equal(busy.statusCode,503);
  release();
  await Promise.all([first,second]);
  const after = response();
  await Analyzer({ip:"concurrent-4",query:{}},after);
  assert.equal(after.statusCode,400);
});

test("handler returns validation errors and rate limits clients", async () => {
  for (let i=0; i<11; i++) {
    const res = new EventEmitter();
    Object.assign(res, {statusCode:200, set:() => res, status:(code) => {res.statusCode=code; return res;}, json:(body) => body});
    await Analyzer({ip:"test-client", query:{}}, res);
    assert.equal(res.statusCode, i < 10 ? 400 : 429);
  }
});
