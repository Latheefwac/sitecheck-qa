import { describe, expect, it } from "vitest";
import { extractHrefs, extractTitle, parseSitemap } from "@/lib/server/engine/util";
import { validateJsonLd } from "@/lib/server/engine/modules/seo";

describe("parseSitemap", () => {
  it("parses urlsets and sitemap indexes", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/about?x=1&amp;y=2 </loc></url></urlset>`;
    expect(parseSitemap(xml).urls).toEqual(["https://a.com/", "https://a.com/about?x=1&y=2"]);
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>`).sitemaps).toEqual(["https://a.com/s1.xml"]);
  });
});

describe("extractHrefs / extractTitle", () => {
  it("resolves links and skips mailto/tel/js/hash", () => {
    const html = `<a href="/about">A</a><a href='contact'>C</a><a href=https://x.com>X</a><a href="mailto:a@b">m</a><a href="#top">t</a><a href="javascript:void(0)">j</a>`;
    expect(extractHrefs(html, "https://a.com/en/")).toEqual(["https://a.com/about", "https://a.com/en/contact", "https://x.com/"]);
  });
  it("extracts and collapses the title", () => {
    expect(extractTitle("<title>\n Home  | Acme </title>")).toBe("Home | Acme");
  });
});

describe("validateJsonLd", () => {
  it("accepts valid Organization schema", () => {
    expect(validateJsonLd([JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "Acme", url: "https://a.com" })])).toEqual({ types: ["Organization"], errors: [] });
  });
  it("reports invalid JSON, missing context and missing required properties", () => {
    const v = validateJsonLd(["{bad", JSON.stringify({ "@type": "Article", headline: "x" })]);
    expect(v.errors.some((e) => e.startsWith("Invalid JSON-LD"))).toBe(true);
    expect(v.errors).toContain("JSON-LD block is missing @context");
    expect(v.errors).toContain('Article is missing required property "datePublished"');
  });
  it("walks @graph", () => {
    const v = validateJsonLd([JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "A", url: "https://a.com" }, { "@type": "BreadcrumbList" }] })]);
    expect(v.types).toEqual(["WebSite", "BreadcrumbList"]);
    expect(v.errors).toEqual(['BreadcrumbList is missing required property "itemListElement"']);
  });
});
