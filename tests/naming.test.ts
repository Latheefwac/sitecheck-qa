import { describe, expect, it } from "vitest";
import { checkImageName } from "@/lib/naming";

describe("checkImageName", () => {
  it("accepts names following page-section-description.webp", () => {
    for (const n of ["homepage-main-banner.webp", "about-us-company-overview.webp", "our-services-industrial-solutions.webp"]) {
      expect(checkImageName(`https://cdn.a.com/img/${n}`).ok).toBe(true);
    }
  });
  it("flags camera names, uppercase, spaces, underscores and legacy formats", () => {
    const r = checkImageName("https://a.com/uploads/IMG_1234.JPG");
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining(["contains uppercase letters", "uses underscores instead of hyphens", "is a generic / camera-generated name"]));
    expect(checkImageName("https://a.com/My Banner.png").issues).toContain("contains spaces");
    expect(checkImageName("https://a.com/team-photo-group.jpg").issues).toContain("uses .jpg instead of a modern format (.webp/.avif)");
  });
  it("flags hashes and single-word names and suggests a fix with the page prefix", () => {
    expect(checkImageName("https://a.com/3f2a9c1b7d6e5f40a1b2.webp").ok).toBe(false);
    const r = checkImageName("https://a.com/Banner_Hero.png", "about-us");
    expect(r.suggestion).toBe("about-us-banner-hero.webp");
  });
  it("decodes URL-encoded names", () => {
    expect(checkImageName("https://a.com/hero%20image.webp").issues).toContain("contains spaces");
  });
});
