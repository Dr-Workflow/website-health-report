import { useState, useEffect } from "react";

// ─── Types ──────────────────────────────────────────────
interface AuditSection {
  key: string;
  title: string;
  icon: string;
  status: "good" | "warn" | "bad" | "empty";
  items: AuditItem[];
  summary: string;
  score: number;
  subTable?: { headers: string[]; rows: string[][] };
}

interface AuditItem {
  name: string;
  value: string;
  status: "good" | "warn" | "bad" | "empty";
  note?: string;
}

interface AuditResult {
  sections: AuditSection[];
  overallScore: number;
  recommendations: string[];
}

// ─── Audit Engine ────────────────────────────────────────
async function fetchPage(url: string): Promise<{ html: string; headers: Record<string, string>; status: number; finalUrl: string }> {
  // Try direct fetch first
  try {
    const res = await fetch(url, { redirect: "follow", mode: "cors" });
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => { headers[k] = v; });
    return { html, headers, status: res.status, finalUrl: res.url };
  } catch {
    // Direct fetch failed (likely CORS) — use CORS proxy
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { redirect: "follow" });
    if (!res.ok) throw new Error(`Could not fetch ${url} (CORS proxy returned ${res.status})`);
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => { headers[k] = v; });
    return { html, headers, status: res.status, finalUrl: url };
  }
}

async function runAudit(
  url: string,
  onProgress: (pct: number, label: string, stageStatus: ("pending" | "running" | "done")[]) => void
): Promise<AuditResult> {
  const sections: AuditSection[] = [];
  const recommendations: string[] = [];
  let stageStatus: ("pending" | "running" | "done")[] = new Array(12).fill("pending");

  const updateProgress = (stageIdx: number, pct: number, label: string) => {
    stageStatus = stageStatus.map((s, i) => (i === stageIdx ? "running" : i < stageIdx ? "done" : "pending"));
    onProgress(pct, label, [...stageStatus]);
  };

  const finishStage = (stageIdx: number) => {
    stageStatus = stageStatus.map((s, i) => (i <= stageIdx ? "done" : "pending"));
  };

  let html = "";
  let headers: Record<string, string> = {};
  let statusCode = 0;
  let finalUrl = url;

  try {
    const pageData = await fetchPage(url);
    html = pageData.html;
    headers = pageData.headers;
    statusCode = pageData.status;
    finalUrl = pageData.finalUrl;
  } catch (e: any) {
    throw new Error(`Could not fetch ${url}. Check the URL and try again. Error: ${e?.message || "Unknown error"}`);
  }

  // Parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent || "";
  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const h1s = doc.querySelectorAll("h1");
  const h2s = doc.querySelectorAll("h2");
  const imgs = doc.querySelectorAll("img");
  const links = doc.querySelectorAll("a[href]");
  const scripts = doc.querySelectorAll("script[src]");
  const stylesheets = doc.querySelectorAll('link[rel="stylesheet"]');
  const metas = doc.querySelectorAll("meta");
  const forms = doc.querySelectorAll("form");
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
  const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
  const ogDescription = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
  const favicon = doc.querySelector('link[rel="icon"]')?.getAttribute("href") || doc.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") || "";
  const jsonLd = doc.querySelectorAll('script[type="application/ld+json"]');
  const hreflangTags = doc.querySelectorAll('link[rel="alternate"][hreflang]');

  // ─── 1. Tech Stack Detection ───
  updateProgress(0, 5, "Detecting tech stack...");
  const techStack: string[] = [];
  if (html.includes("wp-content") || html.includes("wp-includes")) techStack.push("WordPress");
  if (html.includes("shopify")) techStack.push("Shopify");
  if (html.includes("wix.com") || html.includes("static.wixstatic")) techStack.push("Wix");
  if (html.includes("squarespace") || html.includes("static1.squarespace")) techStack.push("Squarespace");
  if (html.includes("webflow")) techStack.push("Webflow");
  if (html.includes("hubspot")) techStack.push("HubSpot");
  if (html.includes("drupal")) techStack.push("Drupal");
  if (html.includes("react") || html.includes("__REACT_DEVTOOLS")) techStack.push("React");
  if (html.includes("next.js") || html.includes("_next/")) techStack.push("Next.js");
  if (html.includes("vue") || html.includes("__vue__")) techStack.push("Vue.js");
  if (html.includes("nuxt")) techStack.push("Nuxt");
  if (html.includes("angular")) techStack.push("Angular");
  if (html.includes("svelte") || html.includes("sveltekit")) techStack.push("Svelte/SvelteKit");
  if (html.includes("lovable")) techStack.push("Lovable");
  if (html.includes("tanstack") || html.includes("__tanstack")) techStack.push("TanStack");
  // CDN
  if (headers["server"]?.includes("cloudflare") || html.includes("cloudflare")) techStack.push("Cloudflare CDN");
  if (headers["server"]?.includes("nginx")) techStack.push("Nginx");
  if (headers["server"]?.includes("apache")) techStack.push("Apache");
  // Analytics
  if (html.includes("google-analytics") || html.includes("gtag")) techStack.push("Google Analytics");
  if (html.includes("googletagmanager") || html.includes("GTM-")) techStack.push("Google Tag Manager");
  if (html.includes("hotjar")) techStack.push("Hotjar");
  if (html.includes("facebook.net") || html.includes("fbq(")) techStack.push("Facebook Pixel");
  // CSS
  if (html.includes("tailwind") || html.includes("tw-")) techStack.push("Tailwind CSS");
  if (html.includes("bootstrap")) techStack.push("Bootstrap");
  // JS libs
  if (html.includes("jquery")) techStack.push("jQuery");
  if (html.includes("gsap")) techStack.push("GSAP");
  if (html.includes("swiper")) techStack.push("Swiper.js");

  const techScore = techStack.length > 0 ? 100 : 0;
  sections.push({
    key: "techstack", title: "Tech Stack Detection", icon: "🔧", status: "good", score: techScore,
    summary: `${techStack.length} technologies detected`,
    items: [
      { name: "Technologies Detected", value: techStack.join(", "), status: "good" },
      { name: "Page Title", value: title ? title.substring(0, 80) : "Missing", status: title ? "good" : "bad" },
      { name: "HTTP Status", value: String(statusCode), status: statusCode === 200 ? "good" : "warn" },
      { name: "Final URL", value: finalUrl.substring(0, 80), status: "good" },
    ],
    subTable: techStack.length > 0 ? { headers: ["Technology"], rows: techStack.map(t => [t]) } : undefined,
  });
  finishStage(0);

  // ─── 2. Domain & DNS ───
  updateProgress(1, 12, "Checking domain and DNS...");
  let domain = "";
  try { domain = new URL(finalUrl).hostname; } catch { domain = ""; }
  const hasSSL = finalUrl.startsWith("https://");
  const sslIssuer = headers["x-ssl-issuer"] || (hasSSL ? "SSL Active" : "No SSL");
  const dnsScore = hasSSL ? 100 : 0;
  sections.push({
    key: "domain", title: "Domain & DNS", icon: "🌐", status: hasSSL ? "good" : "bad", score: dnsScore,
    summary: `${domain} — ${hasSSL ? "HTTPS ✓" : "No SSL ✗"}`,
    items: [
      { name: "Domain", value: domain, status: "good" },
      { name: "SSL Certificate", value: hasSSL ? "Active (HTTPS)" : "MISSING", status: hasSSL ? "good" : "bad", note: hasSSL ? undefined : "CRITICAL: No SSL certificate — browsers will show 'Not Secure'" },
      { name: "Server", value: headers["server"] || "Unknown", status: "good" },
      { name: "IP Address", value: headers["x-forwarded-for"] || headers["x-real-ip"] || "Check via DNS", status: "good" },
      { name: "Redirects", value: finalUrl !== url ? `Redirected to ${domain}` : "None", status: finalUrl !== url ? "warn" : "good", note: finalUrl !== url ? "Page redirects — check if intentional" : undefined },
    ],
  });
  if (!hasSSL) recommendations.push("CRITICAL: Install an SSL certificate immediately. Browsers block and warn users on non-HTTPS sites.");
  finishStage(1);

  // ─── 3. Performance ───
  updateProgress(2, 20, "Testing page speed and performance...");
  const htmlSize = Math.round((html.length / 1024) * 10) / 10;
  const scriptCount = scripts.length;
  const styleCount = stylesheets.length;
  const inlineScripts = doc.querySelectorAll("script:not([src])").length;
  const inlineStyles = doc.querySelectorAll("style").length;
  const totalImgCount = imgs.length;
  const hasLazyLoad = Array.from(imgs).filter(i => i.getAttribute("loading") === "lazy").length;
  const lazyPct = totalImgCount > 0 ? Math.round((hasLazyLoad / totalImgCount) * 100) : 100;
  const domSize = doc.querySelectorAll("*").length;
  const perfScore = htmlSize < 200 && scriptCount < 20 && lazyPct > 50 ? 90 : htmlSize < 500 && scriptCount < 40 ? 70 : 40;
  sections.push({
    key: "performance", title: "Performance & Speed", icon: "⚡", status: perfScore >= 70 ? "good" : perfScore >= 40 ? "warn" : "bad", score: perfScore,
    summary: `Page weight: ${htmlSize}KB HTML, ${scriptCount} scripts, ${totalImgCount} images`,
    items: [
      { name: "HTML Size", value: `${htmlSize} KB`, status: htmlSize < 200 ? "good" : htmlSize < 500 ? "warn" : "bad", note: htmlSize > 500 ? "HTML is large — consider optimization" : undefined },
      { name: "External Scripts", value: String(scriptCount), status: scriptCount < 15 ? "good" : scriptCount < 30 ? "warn" : "bad", note: scriptCount > 30 ? "Too many scripts — each adds load time" : undefined },
      { name: "Stylesheets", value: String(styleCount), status: styleCount < 5 ? "good" : "warn" },
      { name: "Inline Scripts", value: String(inlineScripts), status: inlineScripts < 10 ? "good" : "warn", note: inlineScripts > 15 ? "Consider moving inline scripts to external files" : undefined },
      { name: "Inline Styles", value: String(inlineStyles), status: inlineStyles < 5 ? "good" : "warn" },
      { name: "Images", value: String(totalImgCount), status: totalImgCount < 30 ? "good" : "warn" },
      { name: "Lazy Loading", value: `${hasLazyLoad}/${totalImgCount} (${lazyPct}%)`, status: lazyPct >= 70 ? "good" : lazyPct > 30 ? "warn" : "bad", note: lazyPct < 50 && totalImgCount > 5 ? "Add loading=\"lazy\" to below-the-fold images" : undefined },
      { name: "DOM Elements", value: String(domSize), status: domSize < 1500 ? "good" : domSize < 3000 ? "warn" : "bad", note: domSize > 3000 ? "Very large DOM — can slow rendering" : undefined },
    ],
  });
  if (scriptCount > 30) recommendations.push(`Reduce the number of external scripts (${scriptCount} found). Each script adds a network request and delays rendering.`);
  if (lazyPct < 50 && totalImgCount > 5) recommendations.push(`Add loading="lazy" to images — only ${lazyPct}% of ${totalImgCount} images use lazy loading.`);
  if (htmlSize > 500) recommendations.push(`HTML is ${htmlSize}KB — consider minifying and removing unnecessary markup.`);
  finishStage(2);

  // ─── 4. SEO On-Page ───
  updateProgress(3, 30, "Auditing SEO...");
  const hasTitle = !!title;
  const titleLen = title.length;
  const hasMetaDesc = !!metaDesc;
  const metaDescLen = metaDesc.length;
  const hasCanonical = !!canonical;
  const hasViewport = !!viewport;
  const hasJsonLd = jsonLd.length > 0;
  const hasHreflang = hreflangTags.length > 0;
  const hasOgTitle = !!ogTitle;
  const hasOgImage = !!ogImage;
  const hasOgDesc = !!ogDescription;
  const hasFavicon = !!favicon;
  const h1Count = h1s.length;
  const h2Count = h2s.length;
  const headingHierarchy = h1Count === 1 ? "good" : h1Count === 0 ? "bad" : "warn";
  const internalLinks = Array.from(links).filter(l => (l.getAttribute("href") || "").startsWith("/") || (l.getAttribute("href") || "").includes(domain)).length;
  const externalLinks = Array.from(links).filter(l => { const h = l.getAttribute("href") || ""; return h.startsWith("http") && !h.includes(domain); }).length;
  const nofollowLinks = Array.from(links).filter(l => (l.getAttribute("rel") || "").includes("nofollow")).length;

  // Check for robots.txt and sitemap.xml
  let hasRobotsTxt = false;
  let hasSitemapXml = false;
  try {
    const robotsData = await fetchPage(`${hasSSL ? "https" : "http"}://${domain}/robots.txt`);
    hasRobotsTxt = robotsData.status === 200 && robotsData.html.length > 0;
  } catch {}
  try {
    const sitemapData = await fetchPage(`${hasSSL ? "https" : "http"}://${domain}/sitemap.xml`);
    hasSitemapXml = sitemapData.status === 200 && sitemapData.html.length > 0;
  } catch {}

  const seoChecks = [hasTitle, hasMetaDesc, hasCanonical, hasViewport, hasJsonLd, hasOgTitle, hasOgImage, hasFavicon, hasRobotsTxt, hasSitemapXml, h1Count === 1];
  const seoScore = Math.round((seoChecks.filter(Boolean).length / seoChecks.length) * 100);
  sections.push({
    key: "seo", title: "SEO On-Page Audit", icon: "🔍", status: seoScore >= 70 ? "good" : seoScore >= 40 ? "warn" : "bad", score: seoScore,
    summary: `${seoScore}/100 — ${seoChecks.filter(Boolean).length}/${seoChecks.length} checks passed`,
    items: [
      { name: "Title Tag", value: title ? `${titleLen} chars` : "MISSING", status: hasTitle && titleLen <= 60 ? "good" : hasTitle ? "warn" : "bad", note: !hasTitle ? "CRITICAL: No title tag" : titleLen > 60 ? `Title is ${titleLen} chars — keep under 60` : undefined },
      { name: "Meta Description", value: metaDesc ? `${metaDescLen} chars` : "MISSING", status: hasMetaDesc && metaDescLen <= 160 ? "good" : hasMetaDesc ? "warn" : "bad", note: !hasMetaDesc ? "Missing meta description — critical for search snippets" : metaDescLen > 160 ? `Description is ${metaDescLen} chars — keep under 160` : undefined },
      { name: "Canonical URL", value: hasCanonical ? "Present" : "MISSING", status: hasCanonical ? "good" : "warn", note: !hasCanonical ? "Add canonical tag to prevent duplicate content issues" : undefined },
      { name: "Viewport Meta", value: hasViewport ? "Present" : "MISSING", status: hasViewport ? "good" : "bad", note: !hasViewport ? "CRITICAL: No viewport meta — mobile will not render correctly" : undefined },
      { name: "Structured Data (JSON-LD)", value: `${jsonLd.length} blocks`, status: hasJsonLd ? "good" : "warn", note: !hasJsonLd ? "Add schema.org structured data for rich snippets" : undefined },
      { name: "Open Graph Tags", value: `${[hasOgTitle, hasOgImage, hasOgDesc].filter(Boolean).length}/3`, status: hasOgTitle && hasOgImage ? "good" : "warn", note: !hasOgImage ? "Add og:image for social media sharing" : undefined },
      { name: "Favicon", value: hasFavicon ? "Present" : "MISSING", status: hasFavicon ? "good" : "warn" },
      { name: "H1 Tags", value: String(h1Count), status: headingHierarchy as any, note: h1Count === 0 ? "CRITICAL: No H1 tag" : h1Count > 1 ? `Multiple H1 tags (${h1Count}) — use only one` : undefined },
      { name: "H2 Tags", value: String(h2Count), status: h2Count > 0 ? "good" : "warn" },
      { name: "Internal Links", value: String(internalLinks), status: internalLinks > 5 ? "good" : internalLinks > 0 ? "warn" : "bad", note: internalLinks === 0 ? "No internal links found — add internal linking" : undefined },
      { name: "External Links", value: String(externalLinks), status: "good" },
      { name: "Nofollow Links", value: String(nofollowLinks), status: "good" },
      { name: "Hreflang Tags", value: String(hreflangTags.length), status: hasHreflang ? "good" : "empty", note: !hasHreflang ? "Add hreflang for international SEO (if applicable)" : undefined },
      { name: "robots.txt", value: hasRobotsTxt ? "Found" : "Not found", status: hasRobotsTxt ? "good" : "warn" },
      { name: "sitemap.xml", value: hasSitemapXml ? "Found" : "Not found", status: hasSitemapXml ? "good" : "warn", note: !hasSitemapXml ? "Create and submit sitemap.xml to Google Search Console" : undefined },
    ],
  });
  if (!hasTitle) recommendations.push("CRITICAL: Add a title tag to the page. This is the most important on-page SEO element.");
  if (!hasMetaDesc) recommendations.push("Add a meta description (150-160 characters) to control how the page appears in search results.");
  if (h1Count === 0) recommendations.push("CRITICAL: Add an H1 heading. Search engines use this to understand the page topic.");
  if (h1Count > 1) recommendations.push(`Use only one H1 tag (currently ${h1Count}). Multiple H1s confuse search engines.`);
  if (!hasSitemapXml) recommendations.push("Create and submit a sitemap.xml to Google Search Console for faster indexing.");
  if (!hasJsonLd) recommendations.push("Add schema.org structured data (JSON-LD) to qualify for rich snippets in search results.");
  finishStage(3);

  // ─── 5. Accessibility (ADA) ───
  updateProgress(4, 40, "Scanning accessibility (WCAG)...", stageStatus);
  const imgsWithoutAlt = Array.from(imgs).filter(i => !i.getAttribute("alt")).length;
  const imgAltPct = totalImgCount > 0 ? Math.round(((totalImgCount - imgsWithoutAlt) / totalImgCount) * 100) : 100;
  const hasLangAttr = !!doc.documentElement.getAttribute("lang");
  const hasSkipLink = !!doc.querySelector('a[href^="#"]:not([href="#"])') && html.includes("skip");
  const formLabels = Array.from(forms).filter(f => {
    const labels = f.querySelectorAll("label");
    const inputs = f.querySelectorAll("input, select, textarea");
    return labels.length >= inputs.length;
  }).length;
  const formLabelPct = forms.length > 0 ? Math.round((formLabels / forms.length) * 100) : 100;
  const ariaLabels = doc.querySelectorAll("[aria-label], [aria-labelledby], [role]").length;
  const buttonChecks = doc.querySelectorAll("button:not([aria-label]):not([aria-labelledby])");
  const buttonsWithoutText = Array.from(buttonChecks as NodeListOf<HTMLElement>).filter(b => !b.textContent?.trim()).length;
  const adaScore = Math.round(((imgAltPct + (hasLangAttr ? 100 : 0) + formLabelPct + (buttonsWithoutText === 0 ? 100 : 50)) / 4));
  sections.push({
    key: "accessibility", title: "Accessibility (ADA/WCAG)", icon: "♿", status: adaScore >= 70 ? "good" : adaScore >= 40 ? "warn" : "bad", score: adaScore,
    summary: `${adaScore}/100 — ${imgsWithoutAlt} images without alt text`,
    items: [
      { name: "Images with Alt Text", value: `${totalImgCount - imgsWithoutAlt}/${totalImgCount} (${imgAltPct}%)`, status: imgAltPct >= 90 ? "good" : imgAltPct > 50 ? "warn" : "bad", note: imgAltPct < 90 ? `${imgsWithoutAlt} images missing alt text — required for WCAG compliance` : undefined },
      { name: "HTML lang Attribute", value: hasLangAttr ? doc.documentElement.getAttribute("lang") || "Present" : "MISSING", status: hasLangAttr ? "good" : "warn" },
      { name: "Form Labels", value: forms.length > 0 ? `${formLabels}/${forms.length} (${formLabelPct}%)` : "No forms", status: formLabelPct >= 90 ? "good" : "warn", note: forms.length > 0 && formLabelPct < 100 ? "Some form inputs are missing labels" : undefined },
      { name: "ARIA Attributes", value: String(ariaLabels), status: ariaLabels > 0 ? "good" : "empty" },
      { name: "Buttons without Text", value: String(buttonsWithoutText), status: buttonsWithoutText === 0 ? "good" : "warn", note: buttonsWithoutText > 0 ? `${buttonsWithoutText} buttons have no accessible text` : undefined },
      { name: "Skip Navigation Link", value: hasSkipLink ? "Present" : "Not found", status: hasSkipLink ? "good" : "empty" },
    ],
  });
  if (imgsWithoutAlt > 0) recommendations.push(`${imgsWithoutAlt} images are missing alt text — this is a WCAG 2.2 AA compliance issue and can result in ADA lawsuits.`);
  if (!hasLangAttr) recommendations.push("Add a lang attribute to the <html> element (e.g., <html lang=\"en\">) for screen readers.");
  finishStage(4);

  // ─── 6. Content Quality ───
  updateProgress(5, 50, "Analyzing content quality...");
  const bodyText = doc.body?.innerText || "";
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const avgWordsPerSentence = wordCount / (bodyText.split(/[.!?]+/).length || 1);
  const hasHeadings = h1Count + h2Count > 0;
  const contentDensity = wordCount / (domSize || 1);
  const hasVideoEmbed = html.includes("youtube.com/embed") || html.includes("player.vimeo") || html.includes("iframe");
  const hasAudioContent = html.includes("audio") || html.includes("podcast");
  const contentScore = wordCount > 300 && hasHeadings ? 85 : wordCount > 100 ? 60 : 30;
  sections.push({
    key: "content", title: "Content Quality", icon: "📝", status: contentScore >= 70 ? "good" : "warn", score: contentScore,
    summary: `${wordCount} words, ${h1Count + h2Count} headings`,
    items: [
      { name: "Word Count", value: String(wordCount), status: wordCount >= 300 ? "good" : wordCount >= 100 ? "warn" : "bad", note: wordCount < 300 ? "Thin content — search engines prefer 300+ words on key pages" : undefined },
      { name: "Avg Words/Sentence", value: String(Math.round(avgWordsPerSentence)), status: avgWordsPerSentence < 25 ? "good" : "warn", note: avgWordsPerSentence > 25 ? "Sentences are long — consider breaking them up for readability" : undefined },
      { name: "Headings", value: `${h1Count} H1, ${h2Count} H2`, status: hasHeadings ? "good" : "bad", note: !hasHeadings ? "No headings found — structure content with H1-H6" : undefined },
      { name: "Content Density", value: `${(contentDensity * 100).toFixed(1)}%`, status: contentDensity > 0.1 ? "good" : "warn" },
      { name: "Video Content", value: hasVideoEmbed ? "Found" : "None", status: hasVideoEmbed ? "good" : "empty" },
    ],
  });
  if (wordCount < 300) recommendations.push(`Page has only ${wordCount} words — search engines consider this thin content. Aim for 300+ words on important pages.`);
  finishStage(5);

  // ─── 7. Image Audit ───
  updateProgress(6, 58, "Auditing images...");
  const imgFormats = Array.from(imgs).map(i => {
    const src = i.getAttribute("src") || i.getAttribute("data-src") || "";
    const ext = src.split(".").pop()?.split("?")[0] || "";
    return ext.toLowerCase();
  });
  const webpCount = imgFormats.filter(f => f.includes("webp")).length;
  const avifCount = imgFormats.filter(f => f.includes("avif")).length;
  const pngCount = imgFormats.filter(f => f.includes("png")).length;
  const jpgCount = imgFormats.filter(f => f.includes("jpg") || f.includes("jpeg")).length;
  const modernFormatPct = totalImgCount > 0 ? Math.round(((webpCount + avifCount) / totalImgCount) * 100) : 100;
  const imgWithWidth = Array.from(imgs).filter(i => i.getAttribute("width")).length;
  const imgWithHeight = Array.from(imgs).filter(i => i.getAttribute("height")).length;
  const imgDimensionsPct = totalImgCount > 0 ? Math.round((imgWithWidth / totalImgCount) * 100) : 100;
  const imgScore = Math.round(((imgAltPct + modernFormatPct + imgDimensionsPct) / 3));
  sections.push({
    key: "images", title: "Image Audit", icon: "🖼️", status: imgScore >= 70 ? "good" : imgScore >= 40 ? "warn" : "bad", score: imgScore,
    summary: `${totalImgCount} images — ${imgAltPct}% with alt, ${modernFormatPct}% modern format`,
    items: [
      { name: "Total Images", value: String(totalImgCount), status: "good" },
      { name: "Alt Text Coverage", value: `${imgAltPct}%`, status: imgAltPct >= 90 ? "good" : imgAltPct > 50 ? "warn" : "bad" },
      { name: "Modern Formats (WebP/AVIF)", value: `${webpCount + avifCount}/${totalImgCount} (${modernFormatPct}%)`, status: modernFormatPct > 50 ? "good" : modernFormatPct > 0 ? "warn" : "bad", note: modernFormatPct === 0 && totalImgCount > 3 ? "Convert images to WebP/AVIF for 30-50% smaller file sizes" : undefined },
      { name: "PNG Images", value: String(pngCount), status: pngCount > 5 ? "warn" : "good", note: pngCount > 5 ? "PNGs are large — consider WebP for photos" : undefined },
      { name: "JPEG Images", value: String(jpgCount), status: "good" },
      { name: "Width/Height Attributes", value: `${imgWithWidth}/${totalImgCount} (${imgDimensionsPct}%)`, status: imgDimensionsPct >= 80 ? "good" : "warn", note: imgDimensionsPct < 80 ? "Missing image dimensions can cause layout shift (CLS)" : undefined },
      { name: "Lazy Loading", value: `${hasLazyLoad}/${totalImgCount} (${lazyPct}%)`, status: lazyPct >= 70 ? "good" : "warn" },
    ],
  });
  if (modernFormatPct === 0 && totalImgCount > 3) recommendations.push("Convert images to WebP or AVIF format — modern formats are 30-50% smaller than JPEG/PNG.");
  if (imgDimensionsPct < 80 && totalImgCount > 3) recommendations.push("Add width and height attributes to images to prevent Cumulative Layout Shift (CLS).");
  finishStage(6);

  // ─── 8. Link Audit ───
  updateProgress(7, 65, "Checking links...");
  const allLinks = Array.from(links).map(l => l.getAttribute("href") || "");
  const internalLinksList = allLinks.filter(h => h.startsWith("/") || h.includes(domain));
  const externalLinksList = allLinks.filter(h => h.startsWith("http") && !h.includes(domain));
  const anchorLinks = allLinks.filter(h => h.startsWith("#"));
  const mailtoLinks = allLinks.filter(h => h.startsWith("mailto:"));
  const telLinks = allLinks.filter(h => h.startsWith("tel:"));
  const emptyLinks = allLinks.filter(h => h === "" || h === "#");
  const brokenLinkCandidates = allLinks.filter(h => h && !h.startsWith("#") && !h.startsWith("mailto") && !h.startsWith("tel") && !h.startsWith("javascript"));
  const linkScore = emptyLinks.length === 0 && internalLinksList.length > 0 ? 85 : 50;
  sections.push({
    key: "links", title: "Link Audit", icon: "🔗", status: linkScore >= 70 ? "good" : "warn", score: linkScore,
    summary: `${allLinks.length} links — ${internalLinksList.length} internal, ${externalLinksList.length} external`,
    items: [
      { name: "Total Links", value: String(allLinks.length), status: "good" },
      { name: "Internal Links", value: String(internalLinksList.length), status: internalLinksList.length > 3 ? "good" : "warn", note: internalLinksList.length < 3 ? "Very few internal links — add more for SEO and navigation" : undefined },
      { name: "External Links", value: String(externalLinksList.length), status: "good" },
      { name: "Anchor Links", value: String(anchorLinks.length), status: "good" },
      { name: "Email Links", value: String(mailtoLinks.length), status: "good" },
      { name: "Phone Links", value: String(telLinks.length), status: "good" },
      { name: "Empty/Broken Links", value: String(emptyLinks.length), status: emptyLinks.length === 0 ? "good" : "warn", note: emptyLinks.length > 0 ? `${emptyLinks.length} links have empty href attributes` : undefined },
    ],
  });
  if (emptyLinks.length > 0) recommendations.push(`${emptyLinks.length} links have empty href attributes — fix these to avoid broken navigation.`);
  finishStage(7);

  // ─── 9. Conversion (CRO) ───
  updateProgress(8, 72, "Reviewing conversion elements...");
  const hasCtaButton = !!doc.querySelector("button, a[href*='contact'], a[href*='signup'], a[href*='subscribe'], a[href*='buy'], a[href*='get-started'], input[type='submit']");
  const hasContactForm = forms.length > 0;
  const hasSocialProof = html.includes("testimonial") || html.includes("review") || html.includes("rating") || html.includes("trust") || html.includes("client") || html.includes("customer");
  const hasPhone = html.match(/\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}/) !== null;
  const hasEmailVisible = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) !== null;
  const hasChatWidget = html.includes("intercom") || html.includes("drift") || html.includes("tawk") || html.includes("crisp") || html.includes("hubspot") || html.includes("chat");
  const hasStatsNumbers = html.match(/\d+,\d{3}/) !== null;
  const hasVideoTestimonial = hasVideoEmbed && (html.includes("testimonial") || html.includes("case-study"));
  const croScore = Math.round(([hasCtaButton, hasContactForm, hasSocialProof, hasPhone || hasEmailVisible, hasChatWidget].filter(Boolean).length / 5) * 100);
  sections.push({
    key: "cro", title: "Conversion (CRO)", icon: "💰", status: croScore >= 60 ? "good" : "warn", score: croScore,
    summary: `${croScore}/100 — ${[hasCtaButton, hasContactForm, hasSocialProof, hasPhone || hasEmailVisible, hasChatWidget].filter(Boolean).length}/5 conversion elements found`,
    items: [
      { name: "CTA Button", value: hasCtaButton ? "Found" : "MISSING", status: hasCtaButton ? "good" : "bad", note: !hasCtaButton ? "No call-to-action found — add clear CTAs" : undefined },
      { name: "Contact Form", value: hasContactForm ? `${forms.length} forms` : "None", status: hasContactForm ? "good" : "warn" },
      { name: "Social Proof", value: hasSocialProof ? "Found" : "Not found", status: hasSocialProof ? "good" : "warn", note: !hasSocialProof ? "Add testimonials, reviews, or client logos for trust" : undefined },
      { name: "Contact Info (Phone/Email)", value: hasPhone || hasEmailVisible ? "Found" : "Not found", status: hasPhone || hasEmailVisible ? "good" : "warn" },
      { name: "Chat Widget", value: hasChatWidget ? "Found" : "None", status: hasChatWidget ? "good" : "empty", note: !hasChatWidget ? "Consider adding a live chat widget for conversions" : undefined },
    ],
  });
  if (!hasCtaButton) recommendations.push("No clear call-to-action found on the page. Add a prominent CTA button (e.g., 'Get Started', 'Contact Us', 'Book Now').");
  if (!hasSocialProof) recommendations.push("Add social proof — testimonials, client logos, or review badges to build trust and increase conversions.");
  finishStage(8);

  // ─── 10. Mobile ───
  updateProgress(9, 80, "Testing mobile responsiveness...");
  const hasViewportMeta = !!viewport;
  const viewportContent = viewport.includes("width=device-width") ? "correct" : viewport ? "needs update" : "missing";
  const hasResponsiveImages = Array.from(imgs).filter(i => i.getAttribute("srcset") || i.getAttribute("sizes")).length;
  const responsiveImgPct = totalImgCount > 0 ? Math.round((hasResponsiveImages / totalImgCount) * 100) : 100;
  const hasMobileMetaTags = html.includes("apple-mobile-web-app-capable") || html.includes("theme-color");
  const hasMaxWidth = html.includes("max-width") || html.includes("max-w-");
  const mobileScore = Math.round(((hasViewportMeta ? 50 : 0) + (viewport.includes("width=device-width") ? 30 : 0) + (responsiveImgPct > 50 ? 20 : 10)));
  sections.push({
    key: "mobile", title: "Mobile Responsiveness", icon: "📱", status: mobileScore >= 70 ? "good" : mobileScore >= 40 ? "warn" : "bad", score: mobileScore,
    summary: `${mobileScore}/100 — viewport ${viewportContent}`,
    items: [
      { name: "Viewport Meta Tag", value: hasViewportMeta ? viewport.substring(0, 50) : "MISSING", status: hasViewportMeta && viewport.includes("width=device-width") ? "good" : "bad", note: !hasViewportMeta ? "CRITICAL: Missing viewport meta tag" : !viewport.includes("width=device-width") ? "Viewport should include width=device-width" : undefined },
      { name: "Responsive Images (srcset)", value: `${hasResponsiveImages}/${totalImgCount} (${responsiveImgPct}%)`, status: responsiveImgPct > 50 ? "good" : responsiveImgPct > 0 ? "warn" : "empty", note: responsiveImgPct === 0 && totalImgCount > 3 ? "Add srcset attributes for responsive images" : undefined },
      { name: "Mobile Meta Tags", value: hasMobileMetaTags ? "Found" : "None", status: "empty" },
      { name: "Responsive CSS (max-width)", value: hasMaxWidth ? "Detected" : "Not detected", status: hasMaxWidth ? "good" : "warn" },
    ],
  });
  if (!hasViewportMeta) recommendations.push("CRITICAL: Add a viewport meta tag: <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
  finishStage(9);

  // ─── 11. Security ───
  updateProgress(10, 88, "Scanning security headers...");
  const securityHeaders = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "x-xss-protection", "referrer-policy"];
  const foundHeaders = securityHeaders.filter(h => headers[h]);
  const missingHeaders = securityHeaders.filter(h => !headers[h]);
  const hasHSTS = !!headers["strict-transport-security"];
  const hasCSP = !!headers["content-security-policy"];
  const hasXFrame = !!headers["x-frame-options"];
  const hasXContentType = !!headers["x-content-type-options"];
  const hasMixedContent = hasSSL && html.includes('src="http://') && !html.includes('src="https://');
  const securityScore = Math.round((foundHeaders.length / securityHeaders.length) * 70) + (hasSSL ? 20 : 0) + (hasMixedContent ? -10 : 10);
  sections.push({
    key: "security", title: "Security", icon: "🛡️", status: securityScore >= 70 ? "good" : securityScore >= 40 ? "warn" : "bad", score: securityScore,
    summary: `${securityScore}/100 — ${foundHeaders.length}/${securityHeaders.length} security headers present`,
    items: [
      { name: "SSL/HTTPS", value: hasSSL ? "Active" : "MISSING", status: hasSSL ? "good" : "bad", note: !hasSSL ? "CRITICAL: No SSL" : undefined },
      { name: "HSTS Header", value: hasHSTS ? "Present" : "MISSING", status: hasHSTS ? "good" : "warn", note: !hasHSTS ? "Add Strict-Transport-Security header to enforce HTTPS" : undefined },
      { name: "Content Security Policy", value: hasCSP ? "Present" : "MISSING", status: hasCSP ? "good" : "warn", note: !hasCSP ? "Add CSP header to prevent XSS attacks" : undefined },
      { name: "X-Frame-Options", value: hasXFrame ? "Present" : "MISSING", status: hasXFrame ? "good" : "warn", note: !hasXFrame ? "Add X-Frame-Options to prevent clickjacking" : undefined },
      { name: "X-Content-Type-Options", value: hasXContentType ? "Present" : "MISSING", status: hasXContentType ? "good" : "warn", note: !hasXContentType ? "Add X-Content-Type-Options: nosniff" : undefined },
      { name: "Mixed Content", value: hasMixedContent ? "Found" : "None", status: hasMixedContent ? "bad" : "good", note: hasMixedContent ? "HTTPS page loads HTTP resources — will cause browser warnings" : undefined },
    ],
  });
  if (!hasHSTS) recommendations.push("Add a Strict-Transport-Security (HSTS) header to force browsers to use HTTPS.");
  if (!hasCSP) recommendations.push("Add a Content-Security-Policy (CSP) header to protect against XSS and data injection attacks.");
  if (hasMixedContent) recommendations.push("Fix mixed content — the page loads some resources over HTTP despite being HTTPS.");
  finishStage(10);

  // ─── 12. Social Presence ───
  updateProgress(11, 95, "Checking social media presence...");
  const socialLinks = allLinks.filter(h =>
    h.includes("facebook.com") || h.includes("twitter.com") || h.includes("x.com") ||
    h.includes("instagram.com") || h.includes("linkedin.com") || h.includes("youtube.com") ||
    h.includes("tiktok.com") || h.includes("pinterest.com") || h.includes("github.com") ||
    h.includes("threads.net") || h.includes("discord") || h.includes("whatsapp")
  );
  const socialPlatforms: string[] = [];
  if (socialLinks.some(h => h.includes("facebook.com"))) socialPlatforms.push("Facebook");
  if (socialLinks.some(h => h.includes("twitter.com") || h.includes("x.com"))) socialPlatforms.push("X/Twitter");
  if (socialLinks.some(h => h.includes("instagram.com"))) socialPlatforms.push("Instagram");
  if (socialLinks.some(h => h.includes("linkedin.com"))) socialPlatforms.push("LinkedIn");
  if (socialLinks.some(h => h.includes("youtube.com"))) socialPlatforms.push("YouTube");
  if (socialLinks.some(h => h.includes("tiktok.com"))) socialPlatforms.push("TikTok");
  if (socialLinks.some(h => h.includes("pinterest.com"))) socialPlatforms.push("Pinterest");
  if (socialLinks.some(h => h.includes("github.com"))) socialPlatforms.push("GitHub");
  if (socialLinks.some(h => h.includes("threads.net"))) socialPlatforms.push("Threads");
  if (socialLinks.some(h => h.includes("discord"))) socialPlatforms.push("Discord");
  const socialScore = socialPlatforms.length >= 3 ? 100 : socialPlatforms.length > 0 ? 70 : 0;
  sections.push({
    key: "social", title: "Social Media Presence", icon: "📱", status: socialScore >= 70 ? "good" : socialScore > 0 ? "warn" : "empty", score: socialScore,
    summary: `${socialPlatforms.length} platforms linked`,
    items: [
      { name: "Social Links Found", value: String(socialLinks.length), status: "good" },
      { name: "Platforms Detected", value: socialPlatforms.join(", ") || "None", status: socialPlatforms.length > 0 ? "good" : "warn", note: socialPlatforms.length === 0 ? "No social media links found — add social profile links" : undefined },
    ],
    subTable: socialPlatforms.length > 0 ? { headers: ["Platform"], rows: socialPlatforms.map(p => [p]) } : undefined,
  });
  if (socialPlatforms.length === 0) recommendations.push("No social media links found on the page — add links to your social profiles for social proof and engagement.");
  finishStage(11);

  onProgress(100, "Audit complete!", stageStatus.map(() => "done") as any);

  // Calculate overall score
  const scores = sections.map(s => s.score);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  // Sort recommendations by priority
  const sortedRecs = recommendations.sort((a, b) => {
    if (a.includes("CRITICAL")) return -1;
    if (b.includes("CRITICAL")) return 1;
    return 0;
  });

  return { sections, overallScore, recommendations: sortedRecs };
}

// ─── UI Components ────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cls = status === "good" ? "badge-green" : status === "warn" ? "badge-yellow" : status === "bad" ? "badge-red" : "badge-blue";
  const label = status === "good" ? "✓ Good" : status === "warn" ? "⚠ Review" : status === "bad" ? "✗ Issue" : "○ None";
  return <span className={`section-badge ${cls}`}>{label}</span>;
}

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-${status === "empty" ? "empty" : status}`} />;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444";
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="score-ring">
      <svg viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)", width: "100%", height: "100%", maxWidth: "100px", maxHeight: "100px", display: "block" }}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="6" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="score-number" style={{ color }}>{score}</span>
    </div>
  );
}

function SectionCard({ section, forceExpand }: { section: AuditSection; forceExpand?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || forceExpand;
  return (
    <div className="section-card">
      <div className="section-header" onClick={() => setExpanded(!isOpen)}>
        <div className="section-title">
          <span className="section-icon">{section.icon}</span>
          {section.title}
          <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 8 }}>{section.summary}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBadge status={section.status} />
          <span className="expand-arrow" style={{ fontSize: 16, color: "var(--text-muted)" }}>{isOpen ? "▲" : "▼"}</span>
        </div>
      </div>
      <div className={`section-body ${isOpen ? "expanded" : "collapsed"}`}>
        <table className="audit-table">
          <thead><tr><th></th><th>Item</th><th>Value</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>
            {section.items.map((item, i) => (
              <tr key={i}>
                <td><StatusDot status={item.status} /></td>
                <td>{item.name}</td>
                <td style={{ fontWeight: 600 }}>{item.value}</td>
                <td><StatusBadge status={item.status} /></td>
                <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{item.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {section.subTable && section.subTable.rows.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Detailed Breakdown</div>
            <table className="audit-table">
              <thead><tr>{section.subTable.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {section.subTable.rows.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j} style={{ fontSize: 13 }}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const STAGE_NAMES = [
  "Tech Stack Detection", "Domain & DNS", "Performance & Speed", "SEO On-Page",
  "Accessibility (ADA)", "Content Quality", "Image Audit", "Link Audit",
  "Conversion (CRO)", "Mobile Responsiveness", "Security", "Social Presence"
];
const STAGE_ICONS = ["🔧", "🌐", "⚡", "🔍", "♿", "📝", "🖼️", "🔗", "💰", "📱", "🛡️", "📊"];

// ─── Main App ─────────────────────────────────────────────
type AppState = "landing" | "loading" | "report" | "error";

export default function App() {
  const [state, setState] = useState<AppState>("landing");
  const [url, setUrl] = useState("");
  const [clientName, setClientName] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [stageStatus, setStageStatus] = useState<("pending" | "running" | "done")[]>(new Array(12).fill("pending"));
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [isDark, setIsDark] = useState(true);
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("whr-theme");
    if (stored === "light") { setIsDark(false); document.documentElement.setAttribute("data-theme", "light"); }
  }, []);

  const toggleTheme = () => {
    const next = !isDark; setIsDark(next);
    if (!next) { document.documentElement.setAttribute("data-theme", "light"); localStorage.setItem("whr-theme", "light"); }
    else { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("whr-theme", "dark"); }
  };

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    let cleanUrl = url.trim();
    if (!cleanUrl) { setError("Please enter a website URL."); return; }
    if (!cleanUrl.startsWith("http")) cleanUrl = "https://" + cleanUrl;
    setError(""); setState("loading"); setProgress(0);
    setStageStatus(new Array(12).fill("pending"));
    try {
      const result = await runAudit(cleanUrl, (pct, label, stages) => {
        setProgress(pct); setProgressLabel(label); setStageStatus(stages);
      });
      setAuditResult(result);
      setState("report");
    } catch (err: any) {
      setError(err?.message || "Failed to audit the website.");
      setState("error");
    }
  };

  const handlePrint = () => {
    setExpandAll(true);
    setTimeout(() => {
      window.print();
      setTimeout(() => setExpandAll(false), 500);
    }, 300);
  };

  const handleReset = () => { setState("landing"); setAuditResult(null); setProgress(0); };

  if (state === "landing") {
    return (
      <div>
        <header className="header">
          <div className="header-left"><span className="logo">HeyJoe AI</span><span className="logo-sub">Website Health Report</span></div>
          <div className="header-right"><button className="btn-icon" onClick={toggleTheme}>{isDark ? "☀️" : "🌙"}</button></div>
        </header>
        <div className="container">
          <div className="hero">
            <h1>Website Health Report</h1>
            <p>The most comprehensive website audit available. We run 12 checks — tech stack, performance, SEO, accessibility, content, images, links, conversion, mobile, security, and social — and produce a professional PDF report any VA would be proud to hand to a client.</p>
            <div className="input-card">
              <form onSubmit={handleAudit}>
                <div className="input-group">
                  <label>Client Name (shown on report)</label>
                  <input className="input" type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Corp" required />
                </div>
                <div className="input-group">
                  <label>Website URL</label>
                  <input className="input" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" required />
                </div>
                {error && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 16 }}>{error}</p>}
                <button type="submit" className="btn btn-accent" style={{ width: "100%", padding: "14px", fontSize: 16 }}>🔍 Run Full Website Audit</button>
              </form>
              <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>🔒 Read-only audit. We only fetch and analyze your public page. No login or credentials needed.</p>
            </div>
          </div>
          <div className="how-it-works">
            <div className="step"><div className="step-icon">1</div><h3>Enter URL</h3><p>Paste in any website URL and client name. No login or credentials needed.</p></div>
            <div className="step"><div className="step-icon">2</div><h3>We Audit 12 Areas</h3><p>Tech stack, domain, performance, SEO, accessibility, content, images, links, conversion, mobile, security, and social presence.</p></div>
            <div className="step"><div className="step-icon">3</div><h3>Get Your Report</h3><p>Professional PDF with health score, detailed findings, and prioritized recommendations — ready to hand to your client.</p></div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div>
        <header className="header"><div className="header-left"><span className="logo">HeyJoe AI</span><span className="logo-sub">Auditing...</span></div></header>
        <div className="loading-container">
          <div className="spinner" />
          <div className="loading-text">{progressLabel || "Starting audit..."}</div>
          <div className="loading-sub">{progress}% complete</div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <div className="audit-stages">
            {STAGE_NAMES.map((name, i) => (
              <div key={i} className={`audit-stage ${stageStatus[i]}`}>
                <span className="stage-icon">{STAGE_ICONS[i]}</span>
                <span>{name}</span>
                <span style={{ marginLeft: "auto", fontSize: 16 }}>
                  {stageStatus[i] === "done" ? "✅" : stageStatus[i] === "running" ? "⏳" : "⬜"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div>
        <header className="header"><div className="header-left"><span className="logo">HeyJoe AI</span><span className="logo-sub">Audit Failed</span></div></header>
        <div className="container" style={{ textAlign: "center", paddingTop: 64 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>Audit Failed</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>{error}</p>
          <button className="btn btn-primary" onClick={handleReset}>Try Again</button>
        </div>
      </div>
    );
  }

  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const auditedUrl = url.startsWith("http") ? url : "https://" + url;

  return (
    <div>
      <header className="header">
        <div className="header-left"><span className="logo">HeyJoe AI</span><span className="logo-sub">Website Health Report</span></div>
        <div className="header-right">
          <button className="btn" onClick={handlePrint}>📄 Download PDF</button>
          <button className="btn" onClick={handleReset}>← New Audit</button>
          <button className="btn-icon" onClick={toggleTheme}>{isDark ? "☀️" : "🌙"}</button>
        </div>
      </header>

      <div className="print-header">
        <div className="print-header-left">
          <span className="print-logo">{clientName || "Client"}</span>
          <span className="print-header-sub">Website Health Report</span>
        </div>
        <div className="print-header-right">{dateStr}</div>
      </div>
      <div className="print-footer">
        <div className="print-footer-left">HeyJoe AI · Website Health Report · {clientName || ""}</div>
        <div className="print-footer-right">HeyJoe AI — Website Health Report</div>
      </div>

      <div className="container">
        <div className="print-cover-page">
          <div className="print-cover-client">{clientName || "Client"}</div>
          <h1 className="print-cover-title">Website Health Report</h1>
          <div className="print-cover-meta">
            <p><strong>Date:</strong> {dateStr}</p>
            <p><strong>Client:</strong> {clientName || "N/A"}</p>
            <p><strong>URL:</strong> {auditedUrl}</p>
            <p><strong>Health Score:</strong> {auditResult!.overallScore}/100</p>
            <p><strong>Audit Areas:</strong> 12</p>
          </div>
          <div className="print-cover-note">
            This report was generated by HeyJoe AI using read-only analysis of the public website listed above.
            It covers 12 critical areas of website health. No data was modified during this audit.
          </div>
        </div>

        <div className="score-card">
          <ScoreRing score={auditResult!.overallScore} />
          <div className="score-label">Overall Website Health Score</div>
          <div style={{ marginTop: 8, fontSize: 13, color: auditResult!.overallScore >= 80 ? "var(--green)" : auditResult!.overallScore >= 60 ? "var(--yellow)" : auditResult!.overallScore >= 40 ? "var(--orange)" : "var(--red)" }}>
            {auditResult!.overallScore >= 80 ? "Excellent! Your website is well-optimized." : auditResult!.overallScore >= 60 ? "Good foundation, but there's room for improvement." : auditResult!.overallScore >= 40 ? "Several areas need attention. See recommendations below." : "Your website needs significant work. See recommendations below."}
          </div>
        </div>

        <div className="stats-grid">
          {auditResult!.sections.map((s, i) => (
            <div key={i} className="stat-card">
              <div className="stat-value" style={{ color: s.score >= 70 ? "var(--green)" : s.score >= 40 ? "var(--yellow)" : "var(--red)" }}>{s.score}</div>
              <div className="stat-label">{STAGE_ICONS[i]} {s.title.split(" ")[0]}</div>
            </div>
          ))}
        </div>

        {auditResult!.recommendations.length > 0 && (
          <div className="section-card">
            <div className="section-header" style={{ cursor: "default" }}>
              <div className="section-title">
                <span className="section-icon">💡</span>
                Priority Recommendations
                <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 8 }}>{auditResult!.recommendations.length} items</span>
              </div>
            </div>
            <div style={{ padding: "16px 20px" }}>
              {auditResult!.recommendations.map((rec, i) => (
                <div key={i} className="recommendation"><strong>Fix #{i + 1}:</strong> {rec}</div>
              ))}
            </div>
          </div>
        )}

        {auditResult!.sections.map((section) => (
          <SectionCard key={section.key} section={section} forceExpand={expandAll} />
        ))}

        <div style={{ textAlign: "center", padding: "32px 0 0.8in", color: "var(--text-dim)", fontSize: 12 }}>
          <p>Generated by HeyJoe AI — Website Health Report</p>
          <p style={{ marginTop: 4 }}>{dateStr} · Read-only audit · 12 audit areas checked · {auditedUrl}</p>
        </div>
      </div>
    </div>
  );
}
