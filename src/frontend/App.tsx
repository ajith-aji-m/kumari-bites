import { useState } from "react";

const menuItems = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Orders", icon: "▣" },
  { label: "Menu", icon: "☷" },
  { label: "Reports", icon: "▥" },
  { label: "Settings", icon: "⚙" }
];

function Login({ onLogin }: { onLogin: () => void }) {
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">KB</div>
        <p className="eyebrow">KUMARI BITES</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage your orders, menu and business.</p>

        <form onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setLoading(true);
          try {
            const response = await fetch("/api/v1/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ identifier, password })
            });
            const contentType = response.headers.get("content-type") ?? "";
            const raw = await response.text();
            let data: { message?: string } = {};
            if (raw.trim() && contentType.includes("application/json")) {
              try { data = JSON.parse(raw) as { message?: string }; } catch { /* handled below */ }
            }
            if (!response.ok) throw new Error(data.message ?? (raw.trim() || "Unable to sign in"));
            if (!raw.trim() || !contentType.includes("application/json")) throw new Error("Login server returned an invalid response");
            setLoginSuccess(true);
            window.setTimeout(onLogin, 650);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to sign in");
          } finally {
            setLoading(false);
          }
        }}>
          <label>
            Phone or email
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Enter your phone or email" autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" />
          </label>
          <div className="form-row">
            <label className="checkbox"><input type="checkbox" /> Remember me</label>
            
          </div>
          {error && <p className="login-error">{error}</p>}
          <button className={`primary-button login-submit ${loginSuccess ? "unlocked" : ""}`} type="submit" disabled={loading || loginSuccess}><span className="lock-icon" aria-hidden="true">{loginSuccess ? "🔓" : "🔒"}</span><span>{loginSuccess ? "Signed in" : loading ? "Signing in..." : "Sign in"}</span></button>
        </form>

        <p className="login-footer">Kumari Bites Admin · Secure access</p>
      </section>
    </main>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState("Dashboard");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-mark small">KB</span><span>Kumari Bites</span></div>
        <nav>
          {menuItems.map((item) => (
            <button key={item.label} className={active === item.label ? "nav-item active" : "nav-item"} onClick={() => setActive(item.label)}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <button className="nav-item logout" onClick={async () => {
          await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
          onLogout();
        }}><span>↪</span> Sign out</button>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">OVERVIEW</p>
            <h2>{active}</h2>
          </div>
          <div className="admin-chip"><span className="avatar">A</span><span>Admin</span></div>
        </header>

        <section className="welcome">
          <div>
            <p className="eyebrow">TODAY</p>
            <h1>Good evening, Admin</h1>
            <p className="muted">Here’s what’s happening with Kumari Bites today.</p>
          </div>
          <button className="primary-button compact">+ New order</button>
        </section>

        <section className="stats">
          <article><span>Today's sales</span><strong>₹24,850</strong><small>+12.5% vs yesterday</small></article>
          <article><span>Orders</span><strong>86</strong><small>18 currently preparing</small></article>
          <article><span>Average order</span><strong>₹289</strong><small>+₹24 this week</small></article>
          <article><span>Top item</span><strong>Parotta</strong><small>32 orders today</small></article>
        </section>

        <section className="dashboard-grid">
          <article className="panel">
            <div className="panel-head"><div><h3>Live orders</h3><p className="muted">Real-time kitchen activity</p></div><span className="status-dot">Live</span></div>
            {[
              ["#KB-1048", "Chicken Kothu Parotta", "Preparing", "₹420"],
              ["#KB-1047", "Parotta · Chicken Curry", "Ready", "₹360"],
              ["#KB-1046", "Egg Dosa · Tea", "New", "₹180"]
            ].map(([id, item, status, amount]) => (
              <div className="order-row" key={id}><div><strong>{id}</strong><span>{item}</span></div><span className={"badge " + status.toLowerCase()}>{status}</span><strong>{amount}</strong></div>
            ))}
          </article>
          <article className="panel">
            <div className="panel-head"><div><h3>Popular today</h3><p className="muted">Top selling items</p></div></div>
            {[["Chicken Kothu Parotta", "42"], ["Parotta", "32"], ["Chicken 65", "28"], ["Egg Dosa", "24"]].map(([name, count], i) => (
              <div className="popular-row" key={name}><span className="rank">{i + 1}</span><span>{name}</span><strong>{count}</strong></div>
            ))}
          </article>
        </section>
      </main>
    </div>
  );
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  return loggedIn ? <Dashboard onLogout={() => setLoggedIn(false)} /> : <Login onLogin={() => setLoggedIn(true)} />;
}
