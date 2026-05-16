import { useEffect, useState, useCallback, useRef } from "react";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`.replace(/^\/+/, "/");

type Profile = {
  username: string;
  echoBalance: number;
  bonusFlares: number;
  sonarLevel: number;
};

const FLARE_PACKS = [
  { id: "flare_1", label: "+1 FLARE",  flares: 1, cost: 80,  desc: "Single emergency flare." },
  { id: "flare_3", label: "+3 FLARES", flares: 3, cost: 200, desc: "Stockpile for longer dives." },
  { id: "flare_5", label: "+5 FLARES", flares: 5, cost: 300, desc: "Full survival kit." },
] as const;

const SONAR_TIMES = [8.0, 6.5, 5.0, 3.5, 2.0];
const SONAR_COSTS = [150, 250, 400, 600];

// DEMO MODE — no real payment. Each "pack" simply grants the listed Echoes.
const ECHO_PACKS = [
  { id: "echo_100",  echoes: 100,  label: "100 ◈"  },
  { id: "echo_350",  echoes: 350,  label: "350 ◈"  },
  { id: "echo_700",  echoes: 700,  label: "700 ◈"  },
  { id: "echo_1500", echoes: 1500, label: "1500 ◈" },
] as const;

// SECURITY: JWT is held in memory only (module-scoped) per task requirements.
// It is intentionally NOT persisted to sessionStorage / localStorage — a fresh
// page load returns the user to the unauthenticated state and they must log in
// again. This minimizes token exposure (no XSS-readable storage surface) and
// matches the task acceptance criteria for in-memory auth.
let inMemoryToken: string | null = null;
function getStoredToken(): string | null { return inMemoryToken; }
function setStoredToken(tok: string | null) { inMemoryToken = tok; }

async function apiCall<T = unknown>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
  return data as T;
}

export function StoreOverlay({ onProfileChange }: { onProfileChange?: (p: Profile | null) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; cost: string; onConfirm: () => void }>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showBuyEchoes, setShowBuyEchoes] = useState(false);
  const flashTimer = useRef<number | null>(null);

  // Notify parent of profile changes
  useEffect(() => { onProfileChange?.(profile); }, [profile, onProfileChange]);

  // Load profile on mount if token present
  const fetchProfile = useCallback(async (tok: string) => {
    try {
      const p = await apiCall<Profile>("/auth/me", { method: "GET", token: tok });
      setProfile(p);
    } catch {
      setToken(null);
      setStoredToken(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (token) void fetchProfile(token);
  }, [token, fetchProfile]);

  // Listen for store-open events from game.ts
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("echoes:store-open", open);
    return () => window.removeEventListener("echoes:store-open", open);
  }, []);

  function triggerFlash(msg: string) {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }

  function close() {
    setOpen(false);
    setError(null);
    setConfirm(null);
    setShowBuyEchoes(false);
    window.dispatchEvent(new CustomEvent("echoes:store-close"));
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const path = authMode === "login" ? "/auth/login" : "/auth/signup";
      const res = await apiCall<{ token: string; username: string }>(path, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setStoredToken(res.token);
      setToken(res.token);
      setPassword("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setStoredToken(null);
    setToken(null);
    setProfile(null);
    setUsername(""); setPassword("");
  }

  async function buyItem(itemType: "flare" | "sonar", itemId: string, label: string, cost: number) {
    setConfirm({
      title: `Confirm purchase: ${label}`,
      cost: `${cost} ◈`,
      onConfirm: async () => {
        setConfirm(null); setBusy(true); setError(null);
        try {
          const res = await apiCall<{ echoBalance: number; bonusFlares: number; sonarLevel: number }>(
            "/store/buy-item",
            { method: "POST", body: JSON.stringify({ itemType, itemId }), token },
          );
          setProfile(p => p ? { ...p, ...res } : p);
          triggerFlash("✓ ACQUIRED");
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Purchase failed");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function buyEchoes(packId: string, label: string) {
    setConfirm({
      title: `Claim demo pack: ${label}?`,
      cost: "FREE — demo",
      onConfirm: async () => {
        setConfirm(null); setBusy(true); setError(null);
        try {
          const res = await apiCall<{ echoBalance: number; bonusFlares: number; sonarLevel: number; granted: number }>(
            "/store/claim-echoes",
            { method: "POST", body: JSON.stringify({ packId }), token },
          );
          setProfile(p => p ? { ...p, echoBalance: res.echoBalance, bonusFlares: res.bonusFlares, sonarLevel: res.sonarLevel } : p);
          triggerFlash(`✓ +${res.granted.toLocaleString()} ◈ CREDITED`);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Claim failed");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle}>
        {/* Title bar */}
        <div style={titleBarStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "#00E8FF", textShadow: "0 0 14px #00CCFF" }}>◈</span>
            <span>SUPPLY CACHE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {profile && (
              <span style={balanceStyle}>
                ◈ {profile.echoBalance.toLocaleString()}
              </span>
            )}
            {profile && (
              <button onClick={logout} style={smallBtnStyle}>LOGOUT</button>
            )}
            <button onClick={close} style={closeBtnStyle} aria-label="Close">×</button>
          </div>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {!profile ? (
            // ── AUTH PANEL ─────────────────────────────────
            <form onSubmit={handleAuth} style={authFormStyle}>
              <div style={sectionTitleStyle}>{authMode === "login" ? "ACCESS LOG" : "REGISTER OPERATOR"}</div>
              <div style={mutedTextStyle}>
                {authMode === "login"
                  ? "Authenticate to access the supply cache."
                  : "Create credentials for a new operator profile."}
              </div>
              <label style={labelStyle}>OPERATOR NAME</label>
              <input
                type="text" autoComplete="username" required minLength={3} maxLength={32}
                value={username} onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
              />
              <label style={labelStyle}>PASSPHRASE</label>
              <input
                type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"}
                required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
              {error && <div style={errorStyle}>{error}</div>}
              <button type="submit" disabled={busy} style={primaryBtnStyle}>
                {busy ? "..." : (authMode === "login" ? "AUTHENTICATE" : "REGISTER")}
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode(m => m === "login" ? "signup" : "login"); setError(null); }}
                style={linkBtnStyle}
              >
                {authMode === "login" ? "» NEW OPERATOR? REGISTER" : "» HAVE CREDENTIALS? LOGIN"}
              </button>
            </form>
          ) : showBuyEchoes ? (
            // ── BUY ECHOES PANEL ──────────────────────────
            <div>
              <div style={sectionHeaderStyle}>
                <button onClick={() => setShowBuyEchoes(false)} style={backBtnStyle}>‹ BACK</button>
                <div style={sectionTitleStyle}>ACQUIRE ECHOES ◈</div>
              </div>
              <div style={mutedTextStyle}>
                Demo mode — claim dummy Echo packs instantly. No payment required.
              </div>
              <div style={gridStyle}>
                {ECHO_PACKS.map(p => (
                  <div key={p.id} style={cardStyle}>
                    <div style={cardLabelStyle}>{p.label}</div>
                    <div style={cardCostStyle}>FREE</div>
                    <button
                      onClick={() => buyEchoes(p.id, p.label)}
                      disabled={busy}
                      style={buyBtnStyle}
                    >
                      CLAIM
                    </button>
                  </div>
                ))}
              </div>
              {error && <div style={errorStyle}>{error}</div>}
            </div>
          ) : (
            // ── MAIN STORE (FLARES + SONAR) ───────────────
            <div>
              <button onClick={() => setShowBuyEchoes(true)} style={buyEchoesBtnStyle}>
                + CLAIM DEMO ECHOES ◈
              </button>

              {/* FLARES */}
              <div style={sectionTitleStyle}>FLARE STORES</div>
              <div style={mutedTextStyle}>
                Current bonus flares: <span style={{ color: "#00E8FF" }}>+{profile.bonusFlares}</span>
              </div>
              <div style={gridStyle}>
                {FLARE_PACKS.map(p => {
                  const insuff = profile.echoBalance < p.cost;
                  return (
                    <div key={p.id} style={{ ...cardStyle, opacity: insuff ? 0.55 : 1 }}>
                      <div style={cardLabelStyle}>{p.label}</div>
                      <div style={cardDescStyle}>{p.desc}</div>
                      <div style={cardCostStyle}>{p.cost} ◈</div>
                      <button
                        onClick={() => buyItem("flare", p.id, p.label, p.cost)}
                        disabled={insuff || busy}
                        style={{ ...buyBtnStyle, ...(insuff ? disabledBtnStyle : {}) }}
                      >
                        {insuff ? "INSUFFICIENT ◈" : "ACQUIRE"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* SONAR UPGRADES */}
              <div style={{ ...sectionTitleStyle, marginTop: 28 }}>SONAR ARRAY — RECOVERY UPGRADE</div>
              <SonarGauge level={profile.sonarLevel} />
              <div style={{ ...mutedTextStyle, marginBottom: 12 }}>
                Recovery time: <span style={{ color: "#00E8FF" }}>{SONAR_TIMES[profile.sonarLevel].toFixed(1)}s</span>
              </div>
              <div style={sonarRowsStyle}>
                {[0, 1, 2, 3, 4].map(lvl => {
                  const isCurrent = lvl === profile.sonarLevel;
                  const isOwned   = lvl < profile.sonarLevel;
                  const isNext    = lvl === profile.sonarLevel + 1;
                  const cost      = lvl > 0 ? SONAR_COSTS[lvl - 1] : null;
                  const insuff    = cost != null && profile.echoBalance < cost;
                  return (
                    <div key={lvl} style={{
                      ...sonarRowStyle,
                      ...(isCurrent ? sonarRowCurrentStyle : {}),
                      opacity: (isOwned || (isNext && insuff)) ? 0.65 : 1,
                    }}>
                      <div style={{ width: 70, color: "#7fa9b9", fontWeight: 700 }}>LVL {lvl}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#cfe9f4" }}>{SONAR_TIMES[lvl].toFixed(1)}s recovery</div>
                        {isCurrent && <div style={{ fontSize: 10, color: "#00E8FF", letterSpacing: 1 }}>● ACTIVE</div>}
                        {isOwned && <div style={{ fontSize: 10, color: "#5a8a72", letterSpacing: 1 }}>✓ INSTALLED</div>}
                      </div>
                      {cost != null && (
                        <div style={{ width: 100, textAlign: "right", color: "#7fa9b9" }}>{cost} ◈</div>
                      )}
                      <div style={{ width: 130, textAlign: "right" }}>
                        {lvl === 4 && profile.sonarLevel === 4 ? (
                          <span style={{ color: "#00E8FF", fontWeight: 700 }}>FULLY UPGRADED</span>
                        ) : isNext ? (
                          <button
                            onClick={() => buyItem("sonar", `lvl_${lvl}`, `Sonar Lvl ${lvl}`, cost!)}
                            disabled={insuff || busy}
                            style={{ ...buyBtnStyle, ...(insuff ? disabledBtnStyle : {}) }}
                          >
                            {insuff ? "INSUFFICIENT ◈" : "INSTALL"}
                          </button>
                        ) : isOwned ? (
                          <span style={{ color: "#5a8a72", fontSize: 11 }}>OWNED</span>
                        ) : isCurrent ? (
                          <span style={{ color: "#00E8FF", fontSize: 11 }}>ACTIVE</span>
                        ) : (
                          <span style={{ color: "#3a5560", fontSize: 11 }}>LOCKED</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {error && <div style={errorStyle}>{error}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div style={confirmBackdropStyle} onClick={() => setConfirm(null)}>
          <div style={confirmPanelStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, color: "#cfe9f4", marginBottom: 10 }}>{confirm.title}</div>
            <div style={{ fontSize: 22, color: "#00E8FF", marginBottom: 18, textShadow: "0 0 12px #00CCFF" }}>
              {confirm.cost}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={confirm.onConfirm} style={primaryBtnStyle}>CONFIRM</button>
              <button onClick={() => setConfirm(null)} style={{ ...primaryBtnStyle, background: "transparent" }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* Success flash */}
      {flash && (
        <div style={flashStyle}>{flash}</div>
      )}
    </div>
  );
}

function SonarGauge({ level }: { level: number }) {
  const pct = level / 4;
  return (
    <div style={{ margin: "12px 0 6px 0" }}>
      <div style={{
        height: 14,
        background: "#020b14",
        border: "1px solid rgba(0,200,255,0.3)",
        borderRadius: 2,
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          width: `${pct * 100}%`,
          background: "linear-gradient(90deg, #003a55 0%, #00E8FF 100%)",
          boxShadow: "inset 0 0 12px rgba(0,232,255,0.6)",
          transition: "width 600ms ease",
        }} />
        {[1, 2, 3].map(t => (
          <div key={t} style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${(t / 4) * 100}%`, width: 1, background: "rgba(0,0,0,0.5)",
          }} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000,
  background: "rgba(0, 4, 14, 0.78)",
  backdropFilter: "blur(2px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "monospace",
  animation: "echoesStoreFadeIn 220ms ease-out",
  pointerEvents: "auto",
};

const panelStyle: React.CSSProperties = {
  width: "min(820px, 94vw)",
  maxHeight: "92vh",
  background: "linear-gradient(180deg, #0a1822 0%, #04101a 100%)",
  border: "1px solid rgba(0, 200, 255, 0.35)",
  boxShadow: "0 0 40px rgba(0,180,255,0.25), inset 0 0 60px rgba(0,40,80,0.4)",
  borderRadius: 4,
  display: "flex", flexDirection: "column",
  animation: "echoesStoreSlideIn 280ms cubic-bezier(.2,.8,.2,1)",
};

const titleBarStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "14px 20px",
  borderBottom: "1px solid rgba(0,200,255,0.25)",
  background: "linear-gradient(180deg, rgba(0,60,100,0.35) 0%, transparent 100%)",
  color: "#cfe9f4",
  fontSize: 16, fontWeight: 700, letterSpacing: 3,
};

const balanceStyle: React.CSSProperties = {
  color: "#00E8FF",
  textShadow: "0 0 10px #00CCFF",
  fontSize: 16, fontWeight: 700, letterSpacing: 1,
  padding: "4px 12px",
  border: "1px solid rgba(0,232,255,0.4)",
  borderRadius: 2,
  background: "rgba(0,30,50,0.6)",
};

const smallBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#5b8a99",
  border: "1px solid rgba(91,138,153,0.4)",
  padding: "4px 10px", fontSize: 11, letterSpacing: 1,
  cursor: "pointer", fontFamily: "monospace",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#00E8FF",
  border: "1px solid rgba(0,232,255,0.4)",
  width: 32, height: 32, borderRadius: 16,
  fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0,
  fontFamily: "monospace",
};

const bodyStyle: React.CSSProperties = {
  padding: "20px 24px 24px 24px",
  overflowY: "auto",
  color: "#cfe9f4",
  fontSize: 13,
};

const authFormStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  maxWidth: 380, margin: "0 auto", padding: "20px 0",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, letterSpacing: 3,
  color: "#00E8FF", textShadow: "0 0 10px rgba(0,200,255,0.4)",
  marginBottom: 6,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, marginBottom: 6,
};

const backBtnStyle: React.CSSProperties = {
  ...smallBtnStyle, color: "#cfe9f4", borderColor: "rgba(207,233,244,0.3)",
};

const mutedTextStyle: React.CSSProperties = {
  fontSize: 11, color: "#7fa9b9", letterSpacing: 0.5, marginBottom: 14,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, letterSpacing: 2, color: "#5b8a99",
  marginTop: 14, marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  background: "#020b14",
  border: "1px solid rgba(0,200,255,0.3)",
  color: "#cfe9f4",
  padding: "10px 12px", fontSize: 13,
  fontFamily: "monospace",
  outline: "none",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "rgba(0,60,90,0.6)",
  border: "1px solid rgba(0,232,255,0.6)",
  color: "#00E8FF",
  padding: "12px 18px", marginTop: 20,
  fontSize: 13, letterSpacing: 2, fontWeight: 700,
  cursor: "pointer", fontFamily: "monospace",
  textShadow: "0 0 6px rgba(0,200,255,0.6)",
};

const linkBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none",
  color: "#5b8a99", marginTop: 14, fontSize: 11,
  cursor: "pointer", fontFamily: "monospace", letterSpacing: 1,
  textDecoration: "underline",
};

const errorStyle: React.CSSProperties = {
  color: "#ff8a8a", fontSize: 11,
  background: "rgba(60,0,0,0.4)", border: "1px solid rgba(255,60,60,0.35)",
  padding: "8px 12px", marginTop: 12,
};

const buyEchoesBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(0,80,120,0.5), rgba(0,40,70,0.5))",
  border: "1px solid rgba(0,232,255,0.6)",
  color: "#00E8FF", textShadow: "0 0 8px rgba(0,200,255,0.7)",
  padding: "10px 18px", marginBottom: 22,
  fontSize: 13, letterSpacing: 2, fontWeight: 700,
  cursor: "pointer", fontFamily: "monospace",
  width: "100%",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12, marginBottom: 22,
};

const cardStyle: React.CSSProperties = {
  background: "rgba(0,16,28,0.7)",
  border: "1px solid rgba(0,200,255,0.25)",
  padding: 14,
  display: "flex", flexDirection: "column", gap: 6,
  transition: "all 200ms",
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, letterSpacing: 1.5, color: "#cfe9f4",
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 11, color: "#7fa9b9", flex: 1, lineHeight: 1.4,
};

const cardCostStyle: React.CSSProperties = {
  fontSize: 18, color: "#00E8FF", fontWeight: 700, marginTop: 4,
  textShadow: "0 0 8px rgba(0,200,255,0.5)",
};

const buyBtnStyle: React.CSSProperties = {
  background: "rgba(0,232,255,0.15)",
  border: "1px solid rgba(0,232,255,0.5)",
  color: "#00E8FF", padding: "8px 12px",
  fontSize: 11, letterSpacing: 1.5, fontWeight: 700,
  cursor: "pointer", fontFamily: "monospace",
  marginTop: 6,
};

const disabledBtnStyle: React.CSSProperties = {
  background: "rgba(40,40,40,0.3)", border: "1px solid rgba(120,120,120,0.3)",
  color: "#5a6a72", cursor: "not-allowed", textShadow: "none",
};

const sonarRowsStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6,
};

const sonarRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  background: "rgba(0,16,28,0.65)",
  border: "1px solid rgba(0,200,255,0.2)",
  padding: "10px 14px",
};

const sonarRowCurrentStyle: React.CSSProperties = {
  border: "1px solid rgba(0,232,255,0.65)",
  background: "rgba(0,30,50,0.7)",
  boxShadow: "inset 0 0 12px rgba(0,200,255,0.2)",
};

const confirmBackdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1100,
  background: "rgba(0,0,0,0.65)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const confirmPanelStyle: React.CSSProperties = {
  background: "#0a1822", border: "1px solid rgba(0,232,255,0.5)",
  padding: "28px 32px", borderRadius: 4,
  textAlign: "center", maxWidth: 380,
  boxShadow: "0 0 30px rgba(0,180,255,0.3)",
  fontFamily: "monospace",
};

const flashStyle: React.CSSProperties = {
  position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)",
  zIndex: 1200,
  background: "rgba(0,40,30,0.92)",
  border: "1px solid rgba(0,255,180,0.8)",
  color: "#00ffaa",
  padding: "14px 32px", fontSize: 17, fontWeight: 700, letterSpacing: 3,
  fontFamily: "monospace",
  textShadow: "0 0 14px rgba(0,255,180,0.9)",
  boxShadow: "0 0 30px rgba(0,255,180,0.5)",
  animation: "echoesStoreFlash 1.8s ease-out forwards",
  pointerEvents: "none",
};

// Inject keyframes once
if (typeof document !== "undefined" && !document.getElementById("echoes-store-keyframes")) {
  const styleEl = document.createElement("style");
  styleEl.id = "echoes-store-keyframes";
  styleEl.textContent = `
    @keyframes echoesStoreFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes echoesStoreSlideIn {
      from { transform: translateY(24px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes echoesStoreFlash {
      0%   { opacity: 0; transform: translateX(-50%) scale(0.85); }
      15%  { opacity: 1; transform: translateX(-50%) scale(1.05); }
      30%  { transform: translateX(-50%) scale(1); }
      80%  { opacity: 1; }
      100% { opacity: 0; transform: translateX(-50%) scale(1); }
    }
  `;
  document.head.appendChild(styleEl);
}
