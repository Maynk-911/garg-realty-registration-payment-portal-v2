// Channel Partner application route: rate limit and request-size settings.
// Kept free of database imports so the exact middleware server.ts uses can be tested on its own (tests/cp_rate_limit_test.ts).
import express, { Request, Response, NextFunction, RequestHandler } from 'express';

export const CP_SUBMIT_PATH = '/api/cp/applications';

export const MB = 1024 * 1024;
const envNumber = (name: string, fallback: number, min: number, max: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : fallback;
};
export const MAX_FILE_BYTES = Math.round(envNumber('CP_MAX_FILE_MB', 2, 0.5, 5) * MB);
export const MAX_TOTAL_BYTES = Math.round(envNumber('CP_MAX_TOTAL_MB', 10, 1, 12) * MB);
export const SUBMISSIONS_PER_HOUR = envNumber('CP_SUBMISSIONS_PER_HOUR', 10, 1, 1000);

export const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

/**
 * True for a POST to the application route in any spelling Express itself would route there:
 * Express ignores letter case and trailing slashes by default, so the guard compares the path the same way.
 */
export const isCpSubmission = (req: Request) =>
  req.method === 'POST' && req.path.toLowerCase().replace(/\/+$/, '') === CP_SUBMIT_PATH;

const GUARDED = Symbol('cpSubmissionGuarded');
/** True when the request went through the rate limit (the route refuses anything else) */
export const passedCpGuard = (req: Request) => Boolean((req as any)[GUARDED]);

const submitAttempts = new Map<string, { count: number; expires: number }>();

/**
 * Body parsing for every request: application submissions are counted against the per-visitor hourly limit first
 * and then read with a limit that fits the allowed documents; all other requests use `defaultParser` unchanged.
 */
export function cpAwareBodyParser(defaultParser: RequestHandler): RequestHandler {
  // inflate: false, like the main parsers in server.ts: compressed bodies are refused (415), never decompressed
  const cpParser = express.json({ limit: Math.ceil(MAX_TOTAL_BYTES * 1.37) + 512 * 1024, inflate: false });
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isCpSubmission(req)) return defaultParser(req, res, next);
    const now = Date.now();
    for (const [key, value] of submitAttempts) if (value.expires <= now) submitAttempts.delete(key);
    const ip = clientIp(req);
    const attempts = submitAttempts.get(ip) || { count: 0, expires: now + 60 * 60 * 1000 };
    if (++attempts.count > SUBMISSIONS_PER_HOUR) {
      return res.status(429).json({ error: 'Too many applications from this connection. Please try again in an hour.' });
    }
    submitAttempts.set(ip, attempts);
    (req as any)[GUARDED] = true;
    cpParser(req, res, next);
  };
}
