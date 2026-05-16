import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// SECURITY NOTE — demo build.
// In a production deployment, JWT_SECRET MUST be provided as an environment
// secret (long random string). For this demo, if the env var is missing we
// generate a fresh random 64-byte secret in memory at startup. The secret
// is never written to disk and is rotated on every server restart (so all
// outstanding tokens become invalid). This keeps the repo free of any
// committed credential while still guaranteeing the signing key is not
// predictable.
import { randomBytes } from "node:crypto";
function loadJwtSecret(): string {
  const env = process.env.JWT_SECRET;
  if (env && env.length >= 16) return env;
  const generated = randomBytes(64).toString("base64url");
  // Use console.warn here (auth.ts loads before pino logger module wiring);
  // it's a one-shot startup notice, never logs the secret itself.
  console.warn(
    "[auth] JWT_SECRET env not set (>=16 chars) — generated a fresh in-memory " +
    "signing key for this process. Tokens will be invalidated on restart. " +
    "Set JWT_SECRET in deployment for stable sessions.",
  );
  return generated;
}
const JWT_SECRET: string = loadJwtSecret();
const JWT_EXPIRY = "7d";

export interface JwtPayload {
  userId: number;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = payload;
  next();
}
