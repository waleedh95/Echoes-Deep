import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userProfilesTable, stripeOrdersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const SONAR_UPGRADE_COSTS = [150, 250, 400, 600];

const FLARE_PACKS = [
  { id: "flare_1", label: "+1 Flare", flares: 1, cost: 80 },
  { id: "flare_3", label: "+3 Flares", flares: 3, cost: 200 },
  { id: "flare_5", label: "+5 Flares", flares: 5, cost: 300 },
] as const;

const ECHO_PACKS = [
  { id: "echo_100",  echoes: 100,  price: 99,   label: "100 Echoes"  },
  { id: "echo_350",  echoes: 350,  price: 299,  label: "350 Echoes"  },
  { id: "echo_700",  echoes: 700,  price: 499,  label: "700 Echoes"  },
  { id: "echo_1500", echoes: 1500, price: 999,  label: "1500 Echoes" },
] as const;

router.post("/store/buy-item", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { itemType, itemId } = req.body ?? {};

  if (typeof itemType !== "string" || typeof itemId !== "string") {
    res.status(400).json({ error: "itemType and itemId are required" });
    return;
  }

  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  if (itemType === "flare") {
    const pack = FLARE_PACKS.find(p => p.id === itemId);
    if (!pack) {
      res.status(400).json({ error: "Unknown flare pack" });
      return;
    }
    if (profile.echoBalance < pack.cost) {
      res.status(402).json({ error: "Insufficient Echoes" });
      return;
    }
    const [updated] = await db
      .update(userProfilesTable)
      .set({
        echoBalance: profile.echoBalance - pack.cost,
        bonusFlares: profile.bonusFlares + pack.flares,
      })
      .where(eq(userProfilesTable.userId, userId))
      .returning();
    req.log.info({ userId, itemId, flares: pack.flares }, "Flare pack purchased");
    res.json({
      echoBalance: updated.echoBalance,
      bonusFlares: updated.bonusFlares,
      sonarLevel: updated.sonarLevel,
    });
    return;
  }

  if (itemType === "sonar") {
    const targetLevel = profile.sonarLevel + 1;
    if (targetLevel > 4) {
      res.status(400).json({ error: "Already fully upgraded" });
      return;
    }
    const cost = SONAR_UPGRADE_COSTS[targetLevel - 1];
    if (profile.echoBalance < cost) {
      res.status(402).json({ error: "Insufficient Echoes" });
      return;
    }
    const [updated] = await db
      .update(userProfilesTable)
      .set({
        echoBalance: profile.echoBalance - cost,
        sonarLevel: targetLevel,
      })
      .where(eq(userProfilesTable.userId, userId))
      .returning();
    req.log.info({ userId, sonarLevel: targetLevel }, "Sonar upgrade purchased");
    res.json({
      echoBalance: updated.echoBalance,
      bonusFlares: updated.bonusFlares,
      sonarLevel: updated.sonarLevel,
    });
    return;
  }

  res.status(400).json({ error: "Unknown itemType" });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE — no real payment method.
// Instead of Stripe checkout, the client can call /store/claim-echoes with a
// packId from the fixed ECHO_PACKS table and the server credits the dummy
// Echo amount directly. The credit pipeline is otherwise identical to the
// real (verified-webhook) flow: server-side catalog lookup → idempotent
// insert into the orders ledger → balance update. The client cannot specify
// the amount — only the pack id — so the catalog remains the source of truth.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/store/claim-echoes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { packId } = req.body ?? {};

  if (typeof packId !== "string") {
    res.status(400).json({ error: "packId is required" });
    return;
  }
  const pack = ECHO_PACKS.find(p => p.id === packId);
  if (!pack) {
    res.status(400).json({ error: "Unknown echo pack" });
    return;
  }

  // Ledger entry (also gives us a clean audit trail for demo grants).
  // Idempotency key is per-request so each claim is its own ledger entry.
  const demoOrderId = `demo_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(stripeOrdersTable).values({
    userId,
    stripeSessionId: demoOrderId,
    echoAmount: pack.echoes,
    status: "demo_granted",
  });

  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const [updated] = await db
    .update(userProfilesTable)
    .set({ echoBalance: profile.echoBalance + pack.echoes })
    .where(eq(userProfilesTable.userId, userId))
    .returning();

  req.log.info({ userId, packId, echoes: pack.echoes }, "Demo echoes granted");
  res.json({
    echoBalance: updated.echoBalance,
    bonusFlares: updated.bonusFlares,
    sonarLevel: updated.sonarLevel,
    granted: pack.echoes,
  });
});

export { FLARE_PACKS, ECHO_PACKS, SONAR_UPGRADE_COSTS };
export default router;
