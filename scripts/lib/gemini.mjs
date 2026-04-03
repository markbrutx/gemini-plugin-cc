import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { readJsonFile } from "./fs.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";
import { retryWithBackoff, isRateLimitError } from "./retry.mjs";
import { globalQueue } from "./request-queue.mjs";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from where you left off. Pick the next highest-value step and follow through until the task is resolved.";

export { DEFAULT_CONTINUE_PROMPT };

export function getGeminiAvailability(cwd) {
  return binaryAvailable("gemini", ["--version"], { cwd });
}

function hasOAuthCredentials() {
  const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
  try {
    const stat = fs.statSync(credsPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function getGeminiAuthStatus(cwd) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
  if (apiKey) {
    return { available: true, loggedIn: true, detail: "API key configured" };
  }

  const gemini = binaryAvailable("gemini", ["--version"], { cwd });
  if (!gemini.available) {
    return { available: false, loggedIn: false, detail: "Gemini CLI not found" };
  }

  if (hasOAuthCredentials()) {
    return { available: true, loggedIn: true, detail: "OAuth credentials found" };
  }

  return { available: true, loggedIn: false, detail: "No auth found. Run `gemini auth login` or export GEMINI_API_KEY." };
}

export function getSessionRuntimeStatus(env) {
  const sessionEnv = env ?? process.env;
  const hasSession = Boolean(sessionEnv.GEMINI_COMPANION_SESSION_ID);
  return {
    active: hasSession,
    label: hasSession ? "active" : "no session"
  };
}

function spawnGeminiOnce(cwd, args, options = {}) {
  return new Promise((resolve) => {
    const child = nodeSpawn("gemini", args, {
      cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    const onProgress = options.onProgress ?? null;

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      onProgress?.({ message: "Gemini is processing...", phase: "running" });
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      onProgress?.({
        message: chunk.trim(),
        phase: "running",
        stderrMessage: chunk.trim()
      });
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr, error: null, pid: child.pid });
    });

    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr, error, pid: child.pid });
    });

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        child.kill("SIGTERM");
      });
    }
  });
}

function spawnGemini(cwd, args, options = {}) {
  return globalQueue.enqueue(() =>
    retryWithBackoff(
      () => spawnGeminiOnce(cwd, args, options),
      {
        signal: options.abortSignal,
        onRetry: (info) => {
          const label = info.isRateLimit ? "Rate limited" : "Retryable error";
          const msg = `${label} — retry ${info.attempt}/${info.maxAttempts} in ${Math.round(info.delayMs / 1000)}s`;
          options.onProgress?.({
            message: msg,
            phase: "retrying",
            stderrMessage: msg
          });
        }
      }
    )
  );
}

export async function runGeminiPrompt(cwd, prompt, options = {}) {
  const args = ["-p", prompt];

  if (options.outputFormat !== "text") {
    args.push("--output-format", options.outputFormat ?? "json");
  }

  if (options.model) {
    args.push("-m", options.model);
  }

  if (options.includeDirs?.length) {
    args.push("--include-directories", options.includeDirs.join(","));
  }

  const result = await spawnGemini(cwd, args, {
    onProgress: options.onProgress,
    env: options.env
  });

  return {
    status: result.exitCode,
    finalMessage: result.stdout.trim(),
    stderr: cleanGeminiStderr(result.stderr),
    reasoningSummary: [],
    threadId: null,
    turnId: null,
    touchedFiles: [],
    error: result.error,
    pid: result.pid
  };
}

export async function runGeminiReview(cwd, options = {}) {
  const prompt = options.prompt;
  if (!prompt) {
    throw new Error("Review prompt is required.");
  }

  const result = await runGeminiPrompt(cwd, prompt, {
    model: options.model ?? DEFAULT_MODEL,
    outputFormat: options.outputSchema ? "json" : "text",
    onProgress: options.onProgress
  });

  return result;
}

export async function runGeminiTask(cwd, options = {}) {
  const prompt = options.prompt || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("Task prompt is required.");
  }

  const result = await runGeminiPrompt(cwd, prompt, {
    model: options.model ?? DEFAULT_MODEL,
    outputFormat: "text",
    onProgress: options.onProgress
  });

  return result;
}

export function parseStructuredOutput(rawMessage, fallback = {}) {
  const text = String(rawMessage ?? "").trim();
  if (!text) {
    return {
      parsed: null,
      rawOutput: text,
      parseError: fallback.failureMessage || "No output received from Gemini."
    };
  }

  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = jsonMatch ? jsonMatch[1].trim() : text;

  try {
    const parsed = JSON.parse(candidate);
    return { parsed, rawOutput: text, parseError: null };
  } catch {
    // noop
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      return { parsed, rawOutput: text, parseError: null };
    } catch {
      // noop
    }
  }

  return {
    parsed: null,
    rawOutput: text,
    parseError: "Could not extract valid JSON from Gemini output."
  };
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

export function buildPersistentTaskThreadName(prompt) {
  const snippet = String(prompt ?? "").trim().slice(0, 60).replace(/\s+/g, " ");
  return `Gemini Companion Task: ${snippet || "unnamed"}`;
}

export async function findLatestTaskThread(workspaceRoot) {
  return null;
}

function cleanGeminiStderr(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("Welcome to Gemini") && !line.includes("https://"))
    .join("\n");
}
