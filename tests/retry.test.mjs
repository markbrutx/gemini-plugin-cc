import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  isRateLimitError,
  isRetryableError,
  parseRetryAfter,
  computeDelay,
  retryWithBackoff,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  JITTER_FACTOR
} from "../scripts/lib/retry.mjs";

describe("isRateLimitError", () => {
  it("detects 429 status", () => {
    assert.equal(isRateLimitError("status: 429"), true);
    assert.equal(isRateLimitError("HTTP 429 Too Many Requests"), true);
  });

  it("detects Too Many Requests text", () => {
    assert.equal(isRateLimitError("statusText: 'Too Many Requests'"), true);
  });

  it("detects RESOURCE_EXHAUSTED", () => {
    assert.equal(isRateLimitError("RESOURCE_EXHAUSTED: quota exceeded"), true);
  });

  it("detects rate limit text", () => {
    assert.equal(isRateLimitError("rate limit exceeded"), true);
    assert.equal(isRateLimitError("rate-limit hit"), true);
  });

  it("detects quota text", () => {
    assert.equal(isRateLimitError("quota exceeded for project"), true);
  });

  it("returns false for unrelated errors", () => {
    assert.equal(isRateLimitError("syntax error in input"), false);
    assert.equal(isRateLimitError("file not found"), false);
    assert.equal(isRateLimitError(""), false);
  });
});

describe("isRetryableError", () => {
  it("returns false for exit code 0", () => {
    assert.equal(isRetryableError(0, "429 whatever"), false);
  });

  it("retries on rate limit errors", () => {
    assert.equal(isRetryableError(1, "429 Too Many Requests"), true);
  });

  it("retries on 5xx errors", () => {
    assert.equal(isRetryableError(1, "HTTP 500 Internal Server Error"), true);
    assert.equal(isRetryableError(1, "503 Service Unavailable"), true);
  });

  it("retries on network errors", () => {
    assert.equal(isRetryableError(1, "ECONNRESET"), true);
    assert.equal(isRetryableError(1, "ETIMEDOUT"), true);
    assert.equal(isRetryableError(1, "ECONNREFUSED"), true);
  });

  it("does not retry on non-retryable errors", () => {
    assert.equal(isRetryableError(1, "invalid prompt"), false);
    assert.equal(isRetryableError(1, "authentication failed"), false);
  });
});

describe("parseRetryAfter", () => {
  it("parses retry-after header value", () => {
    const delay = parseRetryAfter("retry-after: 5");
    assert.equal(delay, 5000);
  });

  it("parses seconds from rate limit context", () => {
    const delay = parseRetryAfter("429 Too Many Requests. Try again in 10s");
    assert.equal(delay, 10000);
  });

  it("caps at max delay", () => {
    const delay = parseRetryAfter("retry-after: 999");
    assert.equal(delay, DEFAULT_MAX_DELAY_MS);
  });

  it("returns null when no delay found", () => {
    assert.equal(parseRetryAfter("some random error"), null);
  });
});

describe("computeDelay", () => {
  it("returns a positive number", () => {
    const delay = computeDelay(0);
    assert.ok(delay >= 0);
  });

  it("increases with attempt number", () => {
    const delays = Array.from({ length: 5 }, (_, i) => {
      const samples = Array.from({ length: 100 }, () => computeDelay(i));
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    });
    for (let i = 1; i < delays.length - 1; i++) {
      assert.ok(delays[i] >= delays[i - 1] * 0.5, `delay[${i}] should generally increase`);
    }
  });

  it("respects max delay", () => {
    const delay = computeDelay(20);
    const maxWithJitter = DEFAULT_MAX_DELAY_MS * (1 + JITTER_FACTOR);
    assert.ok(delay <= maxWithJitter, `${delay} should be <= ${maxWithJitter}`);
  });

  it("uses custom options", () => {
    const delay = computeDelay(0, { initialDelayMs: 100, maxDelayMs: 200 });
    assert.ok(delay <= 260);
  });
});

describe("retryWithBackoff", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const result = await retryWithBackoff(() => {
      calls++;
      return { exitCode: 0, stdout: "ok", stderr: "", error: null, pid: 1 };
    });
    assert.equal(calls, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "ok");
  });

  it("retries on retryable error then succeeds", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      () => {
        calls++;
        if (calls < 3) {
          return { exitCode: 1, stdout: "", stderr: "429 Too Many Requests", error: null, pid: 1 };
        }
        return { exitCode: 0, stdout: "success", stderr: "", error: null, pid: 1 };
      },
      { initialDelayMs: 10, maxDelayMs: 20 }
    );
    assert.equal(calls, 3);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "success");
  });

  it("does not retry on non-retryable error", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      () => {
        calls++;
        return { exitCode: 1, stdout: "", stderr: "invalid input", error: null, pid: 1 };
      },
      { initialDelayMs: 10 }
    );
    assert.equal(calls, 1);
    assert.equal(result.exitCode, 1);
  });

  it("exhausts all attempts and returns last result", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      () => {
        calls++;
        return { exitCode: 1, stdout: "", stderr: "429 rate limit", error: null, pid: 1 };
      },
      { maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 20 }
    );
    assert.equal(calls, 3);
    assert.equal(result.exitCode, 1);
  });

  it("calls onRetry callback", async () => {
    const retryEvents = [];
    await retryWithBackoff(
      (attempt) => {
        if (attempt < 2) {
          return { exitCode: 1, stdout: "", stderr: "429", error: null, pid: 1 };
        }
        return { exitCode: 0, stdout: "ok", stderr: "", error: null, pid: 1 };
      },
      {
        initialDelayMs: 10,
        maxDelayMs: 20,
        onRetry: (info) => retryEvents.push(info)
      }
    );
    assert.equal(retryEvents.length, 2);
    assert.equal(retryEvents[0].attempt, 1);
    assert.equal(retryEvents[0].isRateLimit, true);
    assert.equal(retryEvents[1].attempt, 2);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await retryWithBackoff(
      () => ({ exitCode: 1, stdout: "", stderr: "429", error: null, pid: 1 }),
      { signal: controller.signal, initialDelayMs: 10 }
    );
    assert.equal(result.stderr, "Aborted");
  });
});
