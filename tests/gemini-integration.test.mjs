import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getGeminiAuthStatus, runGeminiPrompt, runGeminiTask } from "../scripts/lib/gemini.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_HTML_PATH = path.join(ROOT, ".wb", "tests", "ugly-landing.html");

describe("Gemini integration (live)", () => {
  before(() => {
    const auth = getGeminiAuthStatus(ROOT);
    if (!auth.loggedIn) {
      console.log("Skipping live tests — Gemini not authenticated.");
      process.exit(0);
    }
  });

  it("responds to a simple prompt", async () => {
    const result = await runGeminiPrompt(ROOT, "Reply with exactly: PONG", {
      outputFormat: "text"
    });
    assert.equal(result.status, 0, `Gemini failed: ${result.stderr}`);
    assert.ok(result.finalMessage.includes("PONG"), `Expected PONG, got: ${result.finalMessage}`);
  });

  it("handles HTML redesign task", async () => {
    const html = fs.readFileSync(TEST_HTML_PATH, "utf8");
    const prompt = [
      "Here is an ugly HTML landing page. Rewrite it as a modern, professional landing page.",
      "Use semantic HTML5, clean CSS (inline <style> tag), good typography, and a cohesive color palette.",
      "Keep the same content/features but make it look professional.",
      "Return ONLY the complete HTML file, no explanation.",
      "",
      "```html",
      html,
      "```"
    ].join("\n");

    const progressEvents = [];
    const result = await runGeminiTask(ROOT, {
      prompt,
      onProgress: (event) => progressEvents.push(event)
    });

    assert.equal(result.status, 0, `Gemini failed: ${result.stderr}`);
    assert.ok(result.finalMessage.length > 200, "Response too short for a full HTML page");
    assert.ok(
      result.finalMessage.includes("<!DOCTYPE html>") || result.finalMessage.includes("<html"),
      "Response should contain HTML"
    );
    assert.ok(progressEvents.length > 0, "Should have received progress events");

    const outputPath = path.join(ROOT, ".wb", "tests", "redesigned-landing.html");
    const htmlOutput = extractHtmlFromResponse(result.finalMessage);
    fs.writeFileSync(outputPath, htmlOutput, "utf8");
    console.log(`Redesigned HTML saved to: ${outputPath}`);
  });

  it("serializes concurrent requests (no parallel 429 bombing)", async () => {
    const results = await Promise.all([
      runGeminiPrompt(ROOT, "Reply with exactly: ONE", { outputFormat: "text" }),
      runGeminiPrompt(ROOT, "Reply with exactly: TWO", { outputFormat: "text" }),
      runGeminiPrompt(ROOT, "Reply with exactly: THREE", { outputFormat: "text" })
    ]);

    for (const result of results) {
      assert.equal(result.status, 0, `Gemini failed: ${result.stderr}`);
      assert.ok(result.finalMessage.length > 0, "Should have a response");
    }

    const responses = results.map((r) => r.finalMessage);
    assert.ok(responses.some((r) => r.includes("ONE")), "Should have ONE response");
    assert.ok(responses.some((r) => r.includes("TWO")), "Should have TWO response");
    assert.ok(responses.some((r) => r.includes("THREE")), "Should have THREE response");
  });
});

function extractHtmlFromResponse(text) {
  const fenceMatch = text.match(/```html\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const docStart = text.indexOf("<!DOCTYPE");
  if (docStart !== -1) {
    return text.slice(docStart).trim();
  }
  const htmlStart = text.indexOf("<html");
  if (htmlStart !== -1) {
    return text.slice(htmlStart).trim();
  }
  return text;
}
