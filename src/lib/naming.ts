// Image file-naming convention validator (unit tested).
// Recommended format: page-name-section-image-description.webp

export interface NamingResult {
  ok: boolean;
  fileName: string;
  issues: string[];
  suggestion: string;
}

const GENERIC = /^(img|image|dsc|dscn|photo|pic|picture|screenshot|untitled|banner|file|unnamed|whatsapp-image|pexels|unsplash|shutterstock)[-_ ]?\d*$/i;

export function checkImageName(src: string, pageSlug?: string): NamingResult {
  let path = src;
  try {
    path = decodeURIComponent(new URL(src, "http://x").pathname);
  } catch {
    /* keep raw */
  }
  const fileName = path.split("/").pop() || "";
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  const issues: string[] = [];

  // CMS/CDN-generated names (hashes, size suffixes) are reported but explained.
  const stripped = base.replace(/-\d{2,4}x\d{2,4}$/, "").replace(/[-_.][a-f0-9]{8,}$/i, "");

  if (/[A-Z]/.test(base)) issues.push("contains uppercase letters");
  if (/\s/.test(base)) issues.push("contains spaces");
  if (/_/.test(base)) issues.push("uses underscores instead of hyphens");
  if (/[^a-zA-Z0-9\-_ ]/.test(base)) issues.push("contains special characters");
  if (/--/.test(base)) issues.push("contains repeated hyphens");
  if (GENERIC.test(stripped) || /^\d+$/.test(stripped)) issues.push("is a generic / camera-generated name");
  if (/^[a-f0-9-]{16,}$/i.test(stripped)) issues.push("is a hash or UUID, not descriptive");
  const words = stripped.split(/[-_ ]+/).filter(Boolean);
  if (words.length < 2) issues.push("is not descriptive enough (use page-section-description)");
  if (ext && !["webp", "avif", "svg"].includes(ext)) issues.push(`uses .${ext} instead of a modern format (.webp/.avif)`);

  const slug =
    words
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "image";
  const prefix = pageSlug && !slug.startsWith(pageSlug) ? `${pageSlug}-` : "";
  const suggestion = `${prefix}${slug}.${ext === "svg" ? "svg" : "webp"}`;

  return { ok: issues.length === 0, fileName, issues, suggestion };
}
