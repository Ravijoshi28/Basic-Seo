import puppeteer from "puppeteer";
import { AnalysisError, normalizeUrl, validatePublicUrl } from "./urlSafety.js";
import { createSafeProxy } from "./safeProxy.js";

const MAX_ACTIVE = 2;
const JOB_TIMEOUT = 45000;
let activeJobs = 0;
const clients = new Map();

export function extractSeo() {
  const limit = 200;
  const text = (value) => (value || "").trim().slice(0, 2000);
  const headings = (tag) => [...document.querySelectorAll(tag)]
    .map((element) => text(element.textContent)).filter(Boolean).slice(0, limit);
  const images = [...document.querySelectorAll("img")];
  const missingAlt = images.filter((image) => !image.hasAttribute("alt"));
  const directives = (name) => [...document.querySelectorAll(`meta[name="${name}" i]`)]
    .map((element) => text(element.getAttribute("content"))).slice(0, limit).join(", ");
  return {
    title: text(document.title),
    description: text(document.querySelector('meta[name="description" i]')?.getAttribute("content")),
    h1: headings("h1"), h2: headings("h2"),
    canonical: text(document.querySelector('link[rel~="canonical" i]')?.href),
    robots: directives("robots"), googlebot: directives("googlebot"),
    totalImages: images.length,
    imagesWithoutAltCount: missingAlt.length,
    imagesWithoutAlt: missingAlt.slice(0, limit).map((image) => text(image.currentSrc || image.src)),
    outputLimit: limit,
  };
}

export function buildFindings(seo, status, xRobotsTag = "") {
  const findings = [];
  const add = (code, severity, message) => findings.push({ code, severity, message });
  if (status >= 400) add("HTTP_ERROR", "error", `Page returned HTTP ${status}`);
  if (!seo.title) add("MISSING_TITLE", "warning", "Missing page title");
  if (!seo.description) add("MISSING_DESCRIPTION", "warning", "Missing meta description");
  if (!seo.h1.length) add("MISSING_H1", "warning", "Missing nonempty H1 heading");
  if (!seo.canonical) add("MISSING_CANONICAL", "info", "No canonical URL found; review whether one is needed");
  if (seo.imagesWithoutAltCount) add("MISSING_ALT", "warning", `${seo.imagesWithoutAltCount} image(s) missing the alt attribute`);
  if (/\bnoindex\b|\bnone\b/i.test(`${seo.robots} ${seo.googlebot} ${xRobotsTag}`)) {
    add("INDEXING_DIRECTIVE", "info", "An indexing restriction was found; check its crawler scope and whether it is intentional");
  }
  return findings;
}

export async function analyzeUrl(value, { signal, timeoutMs = JOB_TIMEOUT } = {}) {
  const url = normalizeUrl(value);
  let browser;
  let proxy;
  let stopped = false;
  let rejectCancelled;
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
  const stop = () => {
    stopped = true;
    browser?.process()?.kill();
    if (signal?.aborted) rejectCancelled(new AnalysisError(499, "Request cancelled"));
  };
  signal?.addEventListener("abort", stop, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      stop();
      reject(new AnalysisError(504, "Page analysis timed out"));
    }, timeoutMs);
  });
  const work = async () => {
    await validatePublicUrl(url);
    if (signal?.aborted || stopped) throw new AnalysisError(499, "Request cancelled");
    proxy = await createSafeProxy();
    if (stopped || signal?.aborted) {
      await proxy.close();
      throw new AnalysisError(499, "Request cancelled");
    }
    browser = await puppeteer.launch({
      timeout: 15000,
      args: [
        `--proxy-server=${proxy.url}`, "--proxy-bypass-list=<-loopback>",
        "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ],
    });
    if (stopped) { stop(); throw new AnalysisError(504, "Page analysis timed out"); }
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    let navigationError;
    page.on("request", async (request) => {
      try {
        await validatePublicUrl(normalizeUrl(request.url()));
        if (!request.isInterceptResolutionHandled()) await request.continue();
      } catch (error) {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationError = error;
        if (!request.isInterceptResolutionHandled()) await request.abort("blockedbyclient").catch(() => {});
      }
    });
    let response;
    try {
      response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (error) { throw navigationError || error; }
    const contentType = response?.headers()["content-type"] || "";
    if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType)) {
      throw new AnalysisError(422, "Destination did not return an HTML page");
    }
    let renderingIncomplete = false;
    try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 }); }
    catch (error) { if (error.name !== "TimeoutError") throw error; renderingIncomplete = true; }
    const seo = await page.evaluate(extractSeo);
    const status = response.status();
    const findings = buildFindings(seo, status, response.headers()["x-robots-tag"]);
    if (renderingIncomplete) findings.push({ code: "RENDER_WAIT_EXCEEDED", severity: "info", message: "Page remained active; results reflect the DOM at the rendering deadline" });
    return { url: page.url(), status, seo, findings, issues: findings.map(({ message }) => message) };
  };
  try { return await Promise.race([work(), timeout, cancelled]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    if (browser) {
      const killTimer = setTimeout(() => browser.process()?.kill(), 3000);
      try { await browser.close(); } catch { browser.process()?.kill(); }
      finally { clearTimeout(killTimer); }
    }
    if (proxy) await proxy.close();
  }
}

export async function Analyzer(req, res) {
  const now = Date.now();
  for (const [key, value] of clients) if (value.reset <= now) clients.delete(key);
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const client = clients.get(key) || { count: 0, reset: now + 60000 };
  if (client.count >= 10 || (!clients.has(key) && clients.size >= 10000)) {
    res.set("Retry-After", "60");
    return res.status(429).json({ error: "Too many analysis requests; try again later" });
  }
  client.count++;
  clients.set(key, client);
  if (activeJobs >= MAX_ACTIVE) {
    res.set("Retry-After", "5");
    return res.status(503).json({ error: "Analyzer is busy; try again shortly" });
  }
  activeJobs++;
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", cancel);
  try {
    const result = await analyzeUrl(req.query.url, { signal: controller.signal });
    if (!res.destroyed) return res.json(result);
  } catch (error) {
    const status = error.status || (error.name === "TimeoutError" ? 504 : 502);
    if (!error.status) console.error("Analysis failed:", error.name);
    if (!res.destroyed) return res.status(status).json({
      error: error.status ? error.message : status === 504 ? "Page navigation timed out" : "Could not load or analyze the page",
    });
  } finally {
    res.off("close", cancel);
    activeJobs--;
  }
}
