import { useEffect, useState } from "react";

type DashboardData = {
  today: { orders: number; sales: number; averageOrder: number; activeOrders: number; completedOrders: number; cancelledOrders: number };
  salesTrend: Array<{ sale_date: string; orders: number; sales: string | number }>;
  popularItems: Array<{ itemName: string; quantity: number; revenue: string | number }>;
  recentOrders: Array<{ id: number; orderNumber: string; customerName: string | null; status: string; totalAmount: string; placedAt: string }>;
};

const menuItems = [
  { label: "Dashboard", icon: "⌂" }, { label: "Orders", icon: "▣" }, { label: "Menu", icon: "☷" },
  { label: "Reports", icon: "▥" }, { label: "Settings", icon: "⚙" }
];

function Login({ onLogin }: { onLogin: () => void }) {
  const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [loginSuccess, setLoginSuccess] = useState(false);

  return <main className="login-page"><section className="login-card">
    <div className="brand-mark">KB</div><p className="eyebrow">KUMARI BITES</p><h1>Welcome back</h1>
    <p className="muted">Sign in to manage your orders, menu and business.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setError(""); setLoading(true);
      try {
        const response = await fetch("/api/v1/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({identifier,password}) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message ?? "Unable to sign in");
        setLoginSuccess(true); window.setTimeout(onLogin, 300);
      } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in"); }
      finally { setLoading(false); }
    }}>
      <label>Phone or email<input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="Enter your phone or email" autoComplete="username" /></label>
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" /></label>
      <div className="form-row"><label className="checkbox"><input type="checkbox" /> Remember me</label></div>
      {error && <p className="login-error">{error}</p>}
      <button className={`primary-button login-submit ${loginSuccess ? "unlocked" : ""}`} disabled={loading || loginSuccess}><span className="lock-icon">{loginSuccess ? "🔓" : "🔒"}</span><span>{loginSuccess ? "Signed in" : loading ? "Signing in..." : "Sign in"}</span></button>
    </form><p className="login-footer">Kumari Bites Admin · Secure access</p>
  </section></main>;
}

function statusLabel(status: string) { return status.charAt(0).toUpperCase() + status.slice(1); }
function money(value: string | number) { return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`; }

function Orders() {
  const [status, setStatus] = useState("all"); const [query, setQuery] = useState(""); const [orders, setOrders] = useState<DashboardData["recentOrders"]>([]);
  const [loading, setLoading] = useState(true);
  const loadOrders = () => fetch("/api/v1/orders", {credentials:"include"}).then(r=>r.ok?r.json():Promise.reject()).then(setOrders).catch(()=>setOrders([])).finally(()=>setLoading(false)); }, []);
  const filtered = orders.filter(o => (status==="all" || o.status===status) && [o.orderNumber,o.customerName??""].some(v=>v.toLowerCase().includes(query.toLowerCase())));
  return <section className="panel"><div className="panel-head"><div><h3>Orders</h3><p className="muted">Manage customer orders and kitchen status.</p></div><span className="status-dot">Live</span></div>
    <div className="orders-toolbar"><input className="search-input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search order or customer" />
    <select className="filter-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option>{["new","confirmed","preparing","ready","completed","cancelled"].map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select></div>
    <div style={{overflowX:"auto"}}>{loading?<p className="muted" style={{padding:"25px"}}>Loading orders...</p>:<table className="orders-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead><tbody>
      {filtered.map(o=><tr key={o.id}><td className="order-number">{o.orderNumber}</td><td><div className="order-customer"><strong>{o.customerName??"Walk-in customer"}</strong><small>Customer</small></div></td><td><span className={`order-status ${o.status}`}>{statusLabel(o.status)}</span></td><td><strong>{money(o.totalAmount)}</strong></td></tr>)}
    </tbody></table>}{!loading&&!filtered.length&&<p className="muted" style={{padding:"25px",textAlign:"center"}}>No orders found.</p>}</div>
  </section>;
}

function useRealtimeRefresh(onEvent: (event: { type: string; payload?: unknown }) => void) {\n  useEffect(() => {\n    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";\n    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);\n    socket.onmessage = event => { try { onEvent(JSON.parse(event.data)); } catch { /* ignore malformed events */ } };\n    return () => socket.close();\n  }, [onEvent]);\n}\n\nfunction DashboardHome() {
  const [data, setData] = useState<DashboardData | null>(null); const [error, setError] = useState("");
  const load = () => { setError(""); fetch("/api/v1/dashboard",{credentials:"include"}).then(async r=>{if(!r.ok) throw new Error((await r.json().catch(()=>({}))).message??"Unable to load dashboard"); return r.json();}).then(setData).catch(e=>setError(e.message)); };
  useEffect(() => { load(); }, []);\n  useRealtimeRefresh((event) => { if (event.type === "order.created" || event.type === "order.status_changed") load(); });
  if (error) return <section className="panel"><h3>Dashboard unavailable</h3><p className="muted">{error}</p><button className="primary-button compact" onClick={load}>Retry</button></section>;
  if (!data) return <section className="panel"><p className="muted">Loading dashboard...</p></section>;
  const top = data.popularItems[0];
  return <><section className="welcome"><div><p className="eyebrow">TODAY</p><h1>Good evening, Admin</h1><p className="muted">Here’s what’s happening with Kumari Bites today.</p></div><button className="primary-button compact">+ New order</button></section>
    <section className="stats"><article><span>Today's sales</span><strong>{money(data.today.sales)}</strong><small>{data.today.completedOrders} completed orders</small></article>
      <article><span>Orders</span><strong>{data.today.orders}</strong><small>{data.today.activeOrders} currently active</small></article>
      <article><span>Average order</span><strong>{money(data.today.averageOrder)}</strong><small>Today's average</small></article>
      <article><span>Top item</span><strong>{top?.itemName ?? "—"}</strong><small>{top?.quantity ?? 0} sold today</small></article></section>
    <section className="dashboard-grid"><article className="panel"><div className="panel-head"><div><h3>Recent orders</h3><p className="muted">Latest customer activity</p></div><span className="status-dot">Live</span></div>
      {data.recentOrders.slice(0,5).map(o=><div className="order-row" key={o.id}><div><strong>{o.orderNumber}</strong><span>{o.customerName??"Walk-in customer"}</span></div><span className={"badge "+o.status}>{statusLabel(o.status)}</span><strong>{money(o.totalAmount)}</strong></div>)}
      {!data.recentOrders.length&&<p className="muted">No orders yet.</p>}</article>
      <article className="panel"><div className="panel-head"><div><h3>Popular today</h3><p className="muted">Top selling items</p></div></div>
      {data.popularItems.map((item,i)=><div className="popular-row" key={item.itemName}><span className="rank">{i+1}</span><span>{item.itemName}</span><strong>{item.quantity}</strong></div>)}{!data.popularItems.length&&<p className="muted">No sales yet.</p>}</article></section>
    <section className="panel"><div className="panel-head"><div><h3>Sales trend</h3><p className="muted">Last 7 days</p></div></div>
      <div className="popular-row">{data.salesTrend.map(day=><span key={String(day.sale_date)}>{String(day.sale_date).slice(5)} · {money(day.sales)}</span>)}</div></section></>;
}

function Dashboard({ onLogout }: {onLogout:()=>void}) {
  const [active,setActive]=useState("Dashboard");
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><span className="brand-mark small">KB</span><span>Kumari Bites</span></div><nav>
    {menuItems.map(item=><button key={item.label} className={active===item.label?"nav-item active":"nav-item"} onClick={()=>setActive(item.label)}><span>{item.icon}</span>{item.label}</button>)}</nav>
    <button className="nav-item logout" onClick={async()=>{await fetch("/api/v1/auth/logout",{method:"POST",credentials:"include"});onLogout();}}><span>↪</span> Sign out</button></aside>
    <main className="dashboard"><header className="topbar"><div><p className="eyebrow">OVERVIEW</p><h2>{active}</h2></div><div className="admin-chip"><span className="avatar">A</span><span>Admin</span></div></header>
      {active==="Dashboard"?<DashboardHome/>:active==="Orders"?<Orders/>:<section className="panel"><h3>{active}</h3><p className="muted">This module is coming next.</p></section>}
    </main></div>;
}

export function App() {
  const [loggedIn,setLoggedIn]=useState<boolean|null>(null);
  useEffect(()=>{fetch("/api/v1/auth/me",{credentials:"include"}).then(r=>{setLoggedIn(r.ok);}).catch(()=>setLoggedIn(false));},[]);
  if(loggedIn===null) return <main className="login-page"><section className="login-card"><p className="muted">Checking your session...</p></section></main>;
  return loggedIn?<Dashboard onLogout={()=>setLoggedIn(false)}/>:<Login onLogin={()=>setLoggedIn(true)}/>;
}
