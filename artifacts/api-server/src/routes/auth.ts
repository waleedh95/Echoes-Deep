import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, userProfilesTable } from "@workspace/db";
import { signToken, requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/signup", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  if (username.length < 3 || username.length > 32) {
    res.status(400).json({ error: "username must be 3-32 characters" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "password must be at least 6 characters" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({ username, passwordHash }).returning();
  await db.insert(userProfilesTable).values({ userId: user.id, echoBalance: 0, bonusFlares: 0, sonarLevel: 0 });

  const token = signToken({ userId: user.id, username: user.username });
  req.log.info({ userId: user.id }, "User signed up");
  res.status(201).json({ token, username: user.username });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username });
  req.log.info({ userId: user.id }, "User logged in");
  res.json({ token, username: user.username });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json({
    username: req.user!.username,
    echoBalance: profile.echoBalance,
    bonusFlares: profile.bonusFlares,
    sonarLevel: profile.sonarLevel,
  });
});

export default router;
