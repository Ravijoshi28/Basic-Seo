"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

type Severity = "error" | "warning" | "info";
type Finding = { code: string; severity: Severity; message: string };
type Report = {
  url: string; status: number | null; findings: Finding[]; issues: string[];
  seo: { title: string; description: string; canonical: string; robots: string; googlebot: string;
    h1: string[]; h2: string[]; totalImages: number; imagesWithoutAltCount: number;
    imagesWithoutAlt: string[]; outputLimit: number };
};
const api = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

function Icon({ name, size = 20 }: { name: "search" | "arrow" | "globe" | "download" | "check" | "layers"; size?: number }) {
  const paths = { search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>, arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>, globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>, download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>, check: <path d="m5 12 4 4L19 6" />, layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [tab, setTab] = useState<"overview" | "headings" | "images">("overview");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true); setError(""); setReport(null); setFilter("all"); setTab("overview");
    const timeout = setTimeout(() => abort.abort("timeout"), 55000);
    try {
      const response = await fetch(`${api}/api/analyze?${new URLSearchParams({ url: url.trim() })}`, { signal: abort.signal, cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const retry = response.headers.get("Retry-After");
        throw new Error((body?.error || `Analysis failed (HTTP ${response.status}).`) + (retry ? ` Try again in ${retry} seconds.` : ""));
      }
      if (!body?.seo || !Array.isArray(body.findings)) throw new Error("The server returned an unexpected report.");
      setReport(body);
    } catch (failure) {
      if (abort.signal.aborted) setError(abort.signal.reason === "timeout" ? "The request timed out. Please try again." : "Analysis cancelled.");
      else setError(failure instanceof TypeError ? "Could not connect to the analyzer. Check that the backend is running and try again." : failure instanceof Error ? failure.message : "Could not analyze this page.");
    } finally {
      clearTimeout(timeout); setLoading(false); controller.current = null;
    }
  }
  function download() {
    if (!report) return;
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = "seo-report.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  const findings = report?.findings.filter((item) => filter === "all" || item.severity === filter) || [];
  const count = (severity: Severity) => report?.findings.filter((item) => item.severity === severity).length || 0;

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="PageLens home"><span className="brand-mark"><Icon name="layers" /></span>PageLens<span className="brand-dot">.</span></Link>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <a className="nav-item selected" href="#analyzer"><Icon name="search" /> Page analyzer <span>01</span></a>
      <a className="nav-item" href="#report"><Icon name="layers" /> Analysis report</a>
      <div className="sidebar-note"><span className="tiny-label">A LITTLE CLARITY GOES A LONG WAY</span><p>Better pages start with knowing what to improve.</p><div className="note-orbit"><Icon name="globe" size={66} /></div></div>
      <div className="sidebar-footer"><span className="status-dot" /> Rendered page analysis</div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span>Workspace <span className="breadcrumb">/</span> <strong>Page analyzer</strong></span><span className="topbar-tag">SEO TOOLKIT <span className="status-dot" /></span></header>
      <main id="analyzer">
        <div className="page-heading"><div><span className="eyebrow">SEE YOUR SITE MORE CLEARLY</span><h1>A closer look at your page.</h1><p>Turn a URL into useful insights. Find the details that deserve your attention.</p></div><span className="edition">PAGE ANALYZER <span>01 /</span></span></div>
        <section className="analyze-card" aria-labelledby="input-title">
          <div className="card-heading"><span className="soft-icon"><Icon name="globe" /></span><div><h2 id="input-title">Where should we look?</h2><p>Enter a public website URL to get started.</p></div><span className="small-tag">LIVE ANALYSIS</span></div>
          <form onSubmit={analyze}><label className="sr-only" htmlFor="page-url">Website URL</label><div className="input-group"><Icon name="globe" /><input id="page-url" type="text" inputMode="url" autoComplete="url" placeholder="https://your-website.com" value={url} onChange={(event) => setUrl(event.target.value)} required maxLength={2048} disabled={loading} /><button className="primary-button" disabled={loading || !url.trim()} type="submit">{loading ? "Analyzing…" : "Analyze page"}{loading ? <span className="spinner" /> : <Icon name="arrow" size={18} />}</button></div></form>
          <div className="input-footer"><span><Icon name="check" size={14} /> Metadata, headings, images & indexing</span>{loading ? <button className="text-button" onClick={() => controller.current?.abort()}>Cancel analysis</button> : <button className="text-button" onClick={() => setUrl("https://example.com")}>Try example.com <span>↗</span></button>}</div>
          {error && <div className="error-banner" role="alert">{error}</div>}
        </section>
        <div role="status" aria-live="polite" className={loading ? "loading-banner" : "sr-only"}>{loading ? "Reading the rendered page. This may take up to 45 seconds…" : report ? "Analysis complete. Your report is ready." : ""}</div>
        <section id="report" aria-busy={loading}>
          <div className="section-heading"><div><h2>Your page, at a glance</h2><p>{report ? "A snapshot of the page we just analyzed." : "Your findings will appear here after an analysis."}</p></div>{report && <button className="outline-button" onClick={download}><Icon name="download" size={16} /> Export report</button>}</div>
          <div className="stats-grid">
            <div className="stat-card"><span>HTTP STATUS <Icon name="globe" size={17} /></span><strong>{report ? report.status ?? "Unknown" : "—"}</strong><small>{report ? "Final page response" : "Waiting for a page"}</small></div>
            <div className="stat-card"><span>ERRORS <i className="severity-dot error" /></span><strong>{report ? count("error") : "—"}</strong><small>Issues to investigate</small></div>
            <div className="stat-card"><span>WARNINGS <i className="severity-dot warning" /></span><strong>{report ? count("warning") : "—"}</strong><small>Opportunities to improve</small></div>
            <div className="stat-card"><span>IMAGES <Icon name="layers" size={17} /></span><strong>{report ? report.seo.totalImages : "—"}</strong><small>{report ? `${report.seo.imagesWithoutAltCount} missing alt attributes` : "Accessibility starts here"}</small></div>
          </div>
          {!report ? <div className="empty-state"><div className="empty-art"><Icon name="search" size={38} /><span className="spark">✦</span></div><span className="eyebrow">A FRESH PERSPECTIVE</span><h3>{loading ? "Good insights take a moment." : "Every page has a story."}</h3><p>{loading ? "We’re checking your page’s metadata, structure, and image attributes." : "Add a URL above to discover what’s working and what could use a little care."}</p><div className="empty-chips"><span>Page metadata</span><span>Heading structure</span><span>Image attributes</span></div></div> : <>
            <div className="report-target"><span className="status-dot" /><span>Analyzed page</span><strong>{report.url}</strong></div>
            <div className="results-grid">
              <section className="panel"><div className="panel-title"><h3>Findings</h3><span className="count-badge">{report.findings.length}</span></div><div className="filters" aria-label="Filter findings">{(["all", "error", "warning", "info"] as const).map((value) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "info" ? "Info" : `${value}s`}</button>)}</div><div className="finding-list">{findings.length ? findings.map((finding, index) => <article className="finding" key={`${finding.code}-${index}`}><span className={`finding-symbol ${finding.severity}`}>{finding.severity === "info" ? "i" : "!"}</span><div><span className={`severity-label ${finding.severity}`}>{finding.severity}</span><p>{finding.message}</p></div></article>) : <div className="no-findings"><Icon name="check" /><p>No {filter === "all" ? "findings" : `${filter} findings`} in this report.</p></div>}</div></section>
              <section className="panel details-panel"><div className="detail-tabs" aria-label="Report details">{(["overview", "headings", "images"] as const).map((value) => <button key={value} aria-pressed={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value}</button>)}</div>
                {tab === "overview" && <dl className="metadata">{[["Page title", report.seo.title], ["Meta description", report.seo.description], ["Canonical URL", report.seo.canonical], ["Robots directives", report.seo.robots], ["Googlebot directives", report.seo.googlebot]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={!value ? "muted" : ""}>{value || "Not present"}</dd></div>)}</dl>}
                {tab === "headings" && <div className="detail-content">{(["h1", "h2"] as const).map((heading) => <div className="heading-group" key={heading}><h4>{heading.toUpperCase()} headings <span>{report.seo[heading].length}</span></h4>{report.seo[heading].length ? <ol>{report.seo[heading].map((text, index) => <li key={index}>{text}</li>)}</ol> : <p className="muted">No nonempty {heading.toUpperCase()} headings found.</p>}</div>)}<p className="limit-note">Up to {report.seo.outputLimit} headings shown per level.</p></div>}
                {tab === "images" && <div className="detail-content"><h4>Images missing alt attributes <span>{report.seo.imagesWithoutAltCount}</span></h4><p className="muted">Images with an empty alt attribute are excluded from this list.</p>{report.seo.imagesWithoutAlt.length ? <ul className="image-list">{report.seo.imagesWithoutAlt.map((src, index) => <li key={index}>{src || "Image source not available"}</li>)}</ul> : <p className="no-findings">All detected images have an alt attribute.</p>}<p className="limit-note">Up to {report.seo.outputLimit} image sources shown. Counts include all detected images.</p></div>}
              </section>
            </div>
          </>}
        </section>
        <footer className="page-footer"><span>PageLens <span className="brand-dot">.</span> A little insight. A better website.</span><span>One page at a time.</span></footer>
      </main>
    </div>
  </div>;
}
