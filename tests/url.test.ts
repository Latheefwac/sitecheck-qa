import { describe, expect, it } from "vitest";
import { duplicateKey, isCrawlableHref, normalizeUrl, sameSite, slugFromUrl, validateUrl } from "@/lib/url";

describe("validateUrl", () => {
  it("adds https when the scheme is missing", () => {
    expect(validateUrl("example.com")).toEqual({ ok: true, url: "https://example.com/" });
  });
  it("rejects empty, non-http and malformed input", () => {
    expect(validateUrl("").ok).toBe(false);
    expect(validateUrl("ftp://example.com").ok).toBe(false);
    expect(validateUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateUrl("https://exa mple.com").ok).toBe(false);
    expect(validateUrl("https://nodot").ok).toBe(false);
  });
  it("accepts localhost and IPs for local dev servers", () => {
    expect(validateUrl("http://localhost:3000").ok).toBe(true);
    expect(validateUrl("http://127.0.0.1:8080/a").ok).toBe(true);
    expect(validateUrl("localhost:4321")).toEqual({ ok: true, url: "http://localhost:4321/" });
    expect(validateUrl("myapp.test/about")).toEqual({ ok: true, url: "http://myapp.test/about" });
  });
});

describe("normalizeUrl", () => {
  it("strips hash, default port, tracking params and trailing slash; sorts query", () => {
    expect(normalizeUrl("https://Example.com:443/About/?utm_source=x&b=2&a=1#top")).toBe("https://example.com/About?a=1&b=2");
  });
  it("keeps the root slash", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });
  it("resolves relative URLs", () => {
    expect(normalizeUrl("../contact", "https://example.com/a/b/")).toBe("https://example.com/a/contact");
  });
});

describe("duplicateKey / sameSite", () => {
  it("treats www, case, trailing slash and index files as duplicates", () => {
    const k = duplicateKey("https://example.com/about");
    expect(duplicateKey("https://www.example.com/About/")).toBe(k);
    expect(duplicateKey("https://example.com/about/index.html")).toBe(k);
  });
  it("matches hosts with and without www", () => {
    expect(sameSite("https://www.a.com/x", "https://a.com")).toBe(true);
    expect(sameSite("https://b.com", "https://a.com")).toBe(false);
  });
});

describe("isCrawlableHref / slugFromUrl", () => {
  it("skips non-page links", () => {
    expect(isCrawlableHref("mailto:a@b.com")).toBe(false);
    expect(isCrawlableHref("https://a.com/file.pdf")).toBe(false);
    expect(isCrawlableHref("https://a.com/services")).toBe(true);
  });
  it("derives page slugs", () => {
    expect(slugFromUrl("https://a.com/")).toBe("home");
    expect(slugFromUrl("https://a.com/our-services/industrial/")).toBe("our-services-industrial");
  });
});
