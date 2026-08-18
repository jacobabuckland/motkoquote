/**
 * @vitest-environment happy-dom
 *
 * Issue #196: Bundle a native offline fallback screen for cold start
 *
 * These tests verify that:
 * 1. An offline fallback HTML page exists in the native payload
 * 2. The page is self-contained (no external assets that would fail offline)
 * 3. The page contains Motko branding
 * 4. The page contains a retry button for re-attempting the remote load
 * 5. The page uses the Motko brand color
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

const parseHTML = (html: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
};

describe("Issue #196: Bundle a native offline fallback screen for cold start", () => {
  describe("Offline fallback HTML file", () => {
    it("exists in the native payload directory", () => {
      const offlinePath = "native/www/offline.html";
      const fullPath = join(process.cwd(), offlinePath);

      expect(existsSync(fullPath)).toBe(true);
    });

    it("is a valid HTML document with a title", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      const title = doc.querySelector("title");
      expect(title).toBeTruthy();
      expect(title?.textContent).toBeTruthy();
    });

    it("contains Motko branding", () => {
      const html = readFile("native/www/offline.html");

      // Should mention "Motko" somewhere in the page
      expect(html).toMatch(/Motko/i);
    });

    it("contains a message explaining the network failure", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      const bodyText = doc.body.textContent || "";

      // Should mention network, connection, or offline in the message
      expect(bodyText).toMatch(/network|connection|offline|internet/i);
    });

    it("contains a retry button or control", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      // Look for a button element, or an element with "retry" in its text
      const buttons = Array.from(doc.querySelectorAll("button"));
      const clickableElements = Array.from(
        doc.querySelectorAll('[onclick], [role="button"], .retry, #retry')
      );

      const hasRetryControl =
        buttons.length > 0 ||
        clickableElements.length > 0 ||
        html.match(/retry|try.{0,5}again/i);

      expect(hasRetryControl).toBe(true);
    });

    it("uses the Motko brand color (#004225)", () => {
      const html = readFile("native/www/offline.html");

      // Should reference the brand color somewhere (CSS, inline styles, etc.)
      expect(html).toMatch(/#004225/i);
    });
  });

  describe("Self-contained asset requirements", () => {
    it("has no external stylesheet links", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      // External stylesheets would have href pointing to http:// or https:// or //
      const externalLinks = Array.from(
        doc.querySelectorAll('link[rel="stylesheet"]')
      ).filter((link) => {
        const href = link.getAttribute("href") || "";
        return href.startsWith("http://") ||
               href.startsWith("https://") ||
               href.startsWith("//");
      });

      expect(externalLinks.length).toBe(0);
    });

    it("has no external script sources", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      // External scripts would have src pointing to http:// or https:// or //
      const externalScripts = Array.from(
        doc.querySelectorAll("script[src]")
      ).filter((script) => {
        const src = script.getAttribute("src") || "";
        return src.startsWith("http://") ||
               src.startsWith("https://") ||
               src.startsWith("//");
      });

      expect(externalScripts.length).toBe(0);
    });

    it("has no external image sources", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      // External images would have src pointing to http:// or https:// or //
      const externalImages = Array.from(
        doc.querySelectorAll("img[src]")
      ).filter((img) => {
        const src = img.getAttribute("src") || "";
        return src.startsWith("http://") ||
               src.startsWith("https://") ||
               src.startsWith("//");
      });

      expect(externalImages.length).toBe(0);
    });

    it("has inline styles or embedded CSS", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      // Should have either inline styles or a <style> tag
      const hasStyleTag = doc.querySelectorAll("style").length > 0;
      const hasInlineStyles = Array.from(
        doc.querySelectorAll("[style]")
      ).length > 0;

      expect(hasStyleTag || hasInlineStyles).toBe(true);
    });
  });

  describe("Retry mechanism", () => {
    it("includes JavaScript for the retry mechanism", () => {
      const html = readFile("native/www/offline.html");
      const doc = parseHTML(html);

      // Should have at least one <script> tag with inline JavaScript
      const scripts = Array.from(doc.querySelectorAll("script"));
      const hasInlineScript = scripts.some(
        (script) => !script.hasAttribute("src") && script.textContent
      );

      // Or inline onclick handlers
      const hasOnclickHandlers = html.includes("onclick=");

      expect(hasInlineScript || hasOnclickHandlers).toBe(true);
    });

    it("retry mechanism references window.location or similar reload pattern", () => {
      const html = readFile("native/www/offline.html");

      // Retry typically involves window.location.reload() or window.location.href = ...
      expect(html).toMatch(/window\.location|location\.reload|location\.href/i);
    });
  });

  describe("Integration with native payload", () => {
    it("native/www directory contains both splash and offline fallback", () => {
      const splashExists = existsSync(
        join(process.cwd(), "native/www/index.html")
      );
      const offlineExists = existsSync(
        join(process.cwd(), "native/www/offline.html")
      );

      expect(splashExists).toBe(true);
      expect(offlineExists).toBe(true);
    });
  });
});
