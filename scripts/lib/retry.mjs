const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_INITIAL_DELAY_MS = 3000;
const DEFAULT_MAX_DELAY_MS = 30000;
const JITTER_FACTOR = 0.3;

const RATE_LIMIT_PATTERNS = [
  /429/,
  /too many requests/i,
  /rate.?limit/i,
  /quota/i,
  /RESOURCE_EXHAUSTED/i
];

const RETRYABLE_PATTERNS = [
  ...RATE_LIMIT_PATTERNS,
  /5\d\d/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /EPIPE/,
  /fetch failed/i,
  /server error/i
];

export function isRateLimitError(stderr) {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(stderr));
}

export function isRetryableError(exitCode, stderr) {
  if (exitCode === 0) {
    return false;
  }
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(stderr));
}

export function parseRetryAfter(stderr) {
  const match = stderr.match(/retry.?after[:\s]+(\d+)/i);
  if (match) {
    return Math.min(Number(match[1]) * 1000, DEFAULT_MAX_DELAY_MS);
  }
  const secondsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*s(?:econds?)?/i);
  if (secondsMatch && isRateLimitError(stderr)) {
    return Math.min(Number(secondsMatch[1]) * 1000, DEFAULT_MAX_DELAY_MS);
  }
  return null;
}

export function computeDelay(attempt, options = {}) {
  const initialDelay = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  const exponentialDelay = initialDelay * Math.pow(2, attempt);
  const capped = Math.min(exponentialDelay, maxDelay);
  const jitter = capped * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export async function retryWithBackoff(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const onRetry = options.onRetry ?? null;
  const signal = options.signal ?? null;

  let lastResult = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      return lastResult ?? { exitCode: 1, stdout: "", stderr: "Aborted", error: new Error("Aborted"), pid: null };
    }

    lastResult = await fn(attempt);

    if (lastResult.exitCode === 0) {
      return lastResult;
    }

    const combinedOutput = `${lastResult.stderr} ${lastResult.stdout}`;
    if (!isRetryableError(lastResult.exitCode, combinedOutput)) {
      return lastResult;
    }

    if (attempt >= maxAttempts - 1) {
      return lastResult;
    }

    const serverDelay = parseRetryAfter(combinedOutput);
    const delay = serverDelay ?? computeDelay(attempt, options);

    onRetry?.({
      attempt: attempt + 1,
      maxAttempts,
      delayMs: delay,
      isRateLimit: isRateLimitError(combinedOutput),
      stderr: lastResult.stderr
    });

    await sleep(delay, signal);
  }

  return lastResult;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export { DEFAULT_MAX_ATTEMPTS, DEFAULT_INITIAL_DELAY_MS, DEFAULT_MAX_DELAY_MS, JITTER_FACTOR };
