import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageUpload } from "./components/ImageUpload";

type DashboardData = {
  today: { orders: number; sales: number; averageOrder: number; activeOrders: number; completedOrders: number; cancelledOrders: number };
  salesTrend: Array<{ sale_date: string; orders: number; sales: string | number }>;
  popularItems: Array<{ itemName: string; quantity: number; revenue: string | number }>;
  recentOrders: Array<{ id: number; orderNumber: string; customerName: string | null; status: string; totalAmount: string; placedAt: string }>;
};

type Category = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
};

type MenuItem = {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sku: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  stockQuantity: number;
  lowStockThreshold: number;
  lowStockAlertEnabled: boolean;
  sortOrder: number;
  price: string | number | null;
};

const menuItems = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Orders", icon: "▣" },
  { label: "Menu", icon: "☷" },
  { label: "Reports", icon: "▥" },
  { label: "Settings", icon: "⚙" }
];



function money(value: string | number | null | undefined) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "Something went wrong");
  return data as T;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="login-page">
      {loginSuccess && <div className="chef-success-toast login-success-toast-top" role="status" aria-live="polite">
        <div className="chef-success-bubble"><strong>Chef says</strong><span>Welcome back! Login successful. Taking you to the dashboard.</span></div>
        <div className="chef-success-character" aria-hidden="true"><img src="/assets/kumari-bites-chef.png" alt="" /></div>
      </div>}
      <div className="login-shell">
        <section className="login-visual" aria-hidden="true">
          <div className="login-visual-vignette" />
        </section>

        <section className="login-form-panel">
          <div className="login-brand">
            <div className="login-brand-name"><span>Kumari</span> <em>Bites</em></div>
            <div className="login-brand-tagline">GOOD FOOD BRINGS PEOPLE TOGETHER</div>
          </div>

          <div className="login-heading">
            <h2>Welcome Back</h2>
            <p>Sign in to continue to Kumari Bites</p>
          </div>

          <form onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (!identifier.trim()) { setError("👨‍🍳 Chef says: Enter your email or phone to get started!"); return; }
            if (!password) { setError("👨‍🍳 Chef says: Add your password and we’ll get you in!"); return; }
            setLoading(true);
            try {
              await api("/api/v1/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier, password })
              });
              setLoginSuccess(true);
              window.setTimeout(onLogin, 700);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to sign in");
            } finally {
              setLoading(false);
            }
          }}>
            <label className="login-field">
              <span>Email or phone</span>
              <div className="input-wrap">
                <input disabled={loginSuccess} value={identifier} onChange={e => { setIdentifier(e.target.value); setError(""); setLoginSuccess(false); }} placeholder="Enter your email or phone" autoComplete="username" />
              </div>
            </label>

            <label className="login-field">
              <span>Password</span>
              <div className="input-wrap">
                <input disabled={loginSuccess} type={showPassword ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setError(""); setLoginSuccess(false); }} placeholder="Enter your password" autoComplete="current-password" />
                <button disabled={loginSuccess} type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <div className="login-options">
              <label className="checkbox"><input type="checkbox" /> <span>Remember me</span></label>
              <button disabled={loginSuccess} type="button" className="link-button">Forgot password?</button>
            </div>

            {error && <div className="chef-guide has-error" role="alert">
              <div className="chef-character" aria-hidden="true"><img src="/assets/kumari-bites-chef.png" alt="" /></div>
              <div className="chef-bubble"><strong>Chef says</strong><span>{error.replace(/^👨‍🍳 Chef says: /, "")}</span></div>
            </div>}

            <button className="primary-button login-submit" disabled={loading || loginSuccess}>
              <span>{loading ? "…" : ""}</span>
              <span>{loading ? "Signing in..." : "Sign In"}</span>
            </button>
          </form>

        </section>
      </div>
    </main>
  );
}

function useRealtimeRefresh(onEvent: (event: { type: string; payload?: unknown }) => void) {
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.onmessage = event => {
      try { onEvent(JSON.parse(event.data)); } catch { /* ignore malformed events */ }
    };
    return () => socket.close();
  }, [onEvent]);
}

function DashboardHome() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [orders, setOrders] = useState<Array<DashboardData["recentOrders"][number]>>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await api<DashboardData>("/api/v1/dashboard");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const result = await api<Array<DashboardData["recentOrders"][number]>>("/api/v1/orders");
      setOrders(result);
    } catch {
      // Keep the dashboard's main metrics available if the order list endpoint is temporarily unavailable.
    }
  }, []);

  const loadMenu = useCallback(async () => {
    try {
      const result = await api<MenuItem[]>("/api/v1/menu-items");
      setMenuItems(result);
    } catch {
      // Menu metrics are supplementary; don't block the dashboard if they fail to load.
    }
  }, []);

  useEffect(() => { load(); loadOrders(); loadMenu(); }, [load, loadOrders, loadMenu]);

  useRealtimeRefresh(useCallback((event) => {
    if (event.type === "order.created" || event.type === "order.status_changed") {
      load();
      loadOrders();
    }
    if (event.type === "menu.low_stock") loadMenu();
  }, [load, loadOrders, loadMenu]));

  if (loading && !data) return <section className="dashboard-home-state panel"><p className="muted">Loading dashboard...</p></section>;
  if (error && !data) return <section className="dashboard-home-state panel"><h3>Dashboard unavailable</h3><p className="muted">{error}</p><button className="primary-button compact" onClick={load}>Retry</button></section>;

  const popular = data?.popularItems ?? [];
  const recentOrders = data?.recentOrders ?? [];
  const activeStatuses = new Set(["new", "confirmed", "preparing", "ready"]);
  const activeOrders = orders.filter(order => activeStatuses.has(order.status)).length;
  const preparingOrders = orders.filter(order => order.status === "preparing").length;
  const readyOrders = orders.filter(order => order.status === "ready").length;
  const availableItems = menuItems.filter(item => item.isAvailable && item.stockQuantity > 0);
  const unavailableItems = menuItems.filter(item => !item.isAvailable || item.stockQuantity <= 0);
  const lowStockItems = menuItems.filter(item => item.isAvailable && item.stockQuantity > 0 && item.stockQuantity <= item.lowStockThreshold);
  const trendMax = Math.max(1, ...(data?.salesTrend ?? []).map(day => Number(day.sales) || 0));
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return <section className="dashboard-home">
    <div className="dashboard-home-heading">
      <div><p className="eyebrow">LIVE SUMMARY</p><h1>Today’s overview</h1><p className="muted">{dateLabel}</p></div>
      <button type="button" className="dashboard-refresh-button" onClick={() => { load(); loadOrders(); loadMenu(); }}><span aria-hidden="true">↻</span> Refresh</button>
    </div>

    <section className="dashboard-metrics" aria-label="Today's business metrics">
      <article className="dashboard-metric-card"><span className="dashboard-metric-label">Today's sales</span><strong>{money(data?.today.sales)}</strong><small>Revenue recorded today</small></article>
      <article className="dashboard-metric-card"><span className="dashboard-metric-label">Orders today</span><strong>{data?.today.orders ?? 0}</strong><small>{data?.today.cancelledOrders ?? 0} cancelled</small></article>
      <article className="dashboard-metric-card dashboard-completed-metric"><span className="dashboard-metric-label">Completed today</span><strong>{data?.today.completedOrders ?? 0}</strong><small>Orders successfully completed</small></article>
      <article className="dashboard-metric-card"><span className="dashboard-metric-label">Preparing now</span><strong>{preparingOrders}</strong><small>Orders in preparation</small></article>
      <article className="dashboard-metric-card"><span className="dashboard-metric-label">Ready for pickup</span><strong>{readyOrders}</strong><small>Awaiting collection</small></article>
    </section>

    <section className="dashboard-home-grid">
      <article className="dashboard-clean-panel dashboard-orders-panel">
        <div className="dashboard-section-heading"><div><h2>Recent orders</h2><p>Latest orders and their current status</p></div><span className="dashboard-live-indicator"><i /> Live</span></div>
        {recentOrders.length ? <div className="dashboard-recent-orders">{recentOrders.slice(0, 5).map(order => <div className="dashboard-recent-order" key={order.id}>
          <div className="dashboard-order-info"><strong>{order.orderNumber}</strong><span>{order.customerName || "Walk-in customer"}</span></div>
          <span className={`badge ${order.status}`}>{statusLabel(order.status)}</span>
          <strong className="dashboard-order-total">{money(order.totalAmount)}</strong>
        </div>)}</div> : <div className="dashboard-empty-state"><strong>No orders yet</strong><span>New orders will appear here.</span></div>}
        <div className="dashboard-active-summary"><span>Active orders</span><strong>{activeOrders}</strong></div>
      </article>

      <article className="dashboard-clean-panel dashboard-menu-panel">
        <div className="dashboard-section-heading"><div><h2>Menu overview</h2><p>Live figures from Menu Management</p></div></div>
        <div className="dashboard-menu-stats">
          <div><span>Available items</span><strong>{menuItems.length ? availableItems.length : "—"}</strong></div>
          <div><span>Low stock</span><strong className={lowStockItems.length ? "dashboard-warning-value" : ""}>{menuItems.length ? lowStockItems.length : "—"}</strong></div>
          <div><span>Unavailable</span><strong>{menuItems.length ? unavailableItems.length : "—"}</strong></div>
        </div>
        <div className="dashboard-section-subheading"><h3>Top sellers today</h3><span>Items sold</span></div>
        {popular.length ? <div className="dashboard-top-sellers">{popular.slice(0, 5).map((item, index) => <div className="dashboard-top-seller" key={item.itemName}><span className="dashboard-rank">{index + 1}</span><span>{item.itemName}</span><strong>{item.quantity}</strong></div>)}</div> : <div className="dashboard-empty-state compact"><span>No sales data yet.</span></div>}
      </article>
    </section>

    <section className="dashboard-clean-panel dashboard-sales-panel">
      <div className="dashboard-section-heading"><div><h2>Sales trend</h2><p>Daily sales over the last 7 days</p></div></div>
      {data?.salesTrend.length ? <div className="dashboard-sales-chart">{data.salesTrend.map(day => {
        const sales = Number(day.sales) || 0;
        const height = Math.max(5, (sales / trendMax) * 100);
        return <div className="dashboard-sales-day" key={String(day.sale_date)} title={`${String(day.sale_date)}: ${money(sales)}`}>
          <div className="dashboard-sales-bar-track"><div className="dashboard-sales-bar" style={{ height: `${height}%` }} /></div>
          <strong>{money(sales)}</strong><span>{String(day.sale_date).slice(5)}</span>
        </div>;
      })}</div> : <div className="dashboard-empty-state compact"><span>Sales data will appear when orders are completed.</span></div>}
    </section>
  </section>;
}
function ImagePreviewDrawer({ preview, onClose }: { preview: { url: string; type: "item" | "category"; name: string; category?: string; price?: string | number | null; description?: string | null; isVeg?: boolean; isAvailable?: boolean; stockQuantity?: number; slug?: string; itemCount?: number; isActive?: boolean }; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return <div className="image-preview-drawer-backdrop" role="dialog" aria-modal="true" aria-label={`${preview.name} preview`} onMouseDown={event => event.currentTarget === event.target && onClose()}>
    <aside className="image-preview-drawer" onMouseDown={event => event.stopPropagation()}>
      <div className="image-preview-drawer-head">
        <div><p className="eyebrow">{preview.type === "item" ? "MENU ITEM" : "CATEGORY"}</p><h2>{preview.name}</h2></div>
        <button type="button" className="image-preview-drawer-close" onClick={onClose} aria-label="Close image preview">×</button>
      </div>
      <div className="image-preview-drawer-image-wrap">
        <img src={preview.url} alt={preview.name} className="image-preview-drawer-image" />
      </div>
      <div className="image-preview-drawer-details">
        {preview.type === "item" ? <>
          <div className="preview-detail-row"><span>Category</span><strong>{preview.category || "—"}</strong></div>
          <div className="preview-detail-row"><span>Price</span><strong>{money(preview.price)}</strong></div>
          <div className="preview-detail-row"><span>Type</span><strong>{preview.isVeg ? "VEG" : "NON-VEG"}</strong></div>
          <div className="preview-detail-row"><span>Availability</span><strong>{preview.isAvailable ? "Available" : "Unavailable"}</strong></div>
          <div className="preview-detail-row"><span>Stock</span><strong>{preview.stockQuantity ?? 0}</strong></div>
          {preview.description && <div className="preview-description"><span>Description</span><p>{preview.description}</p></div>}
        </> : <>
          <div className="preview-detail-row"><span>Slug</span><strong>/{preview.slug || "—"}</strong></div>
          <div className="preview-detail-row"><span>Menu items</span><strong>{preview.itemCount ?? 0}</strong></div>
          <div className="preview-detail-row"><span>Status</span><strong>{preview.isActive ? "Active" : "Inactive"}</strong></div>
          {preview.description && <div className="preview-description"><span>Description</span><p>{preview.description}</p></div>}
        </>}
      </div>
    </aside>
  </div>;
}

function Pagination({ currentPage, totalPages, totalItems, pageSize, onPageChange }: { currentPage: number; totalPages: number; totalItems: number; pageSize: number; onPageChange: (page: number) => void }) {
  if (totalItems <= pageSize) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  return <div className="table-pagination">
    <span>Showing {start}–{end} of {totalItems}</span>
    <div className="table-pagination-controls">
      <button type="button" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} aria-label="Previous page">‹</button>
      {Array.from({ length: totalPages }, (_, index) => index + 1).map(page =>
        <button type="button" key={page} className={page === currentPage ? "active" : ""} onClick={() => onPageChange(page)}>{page}</button>
      )}
      <button type="button" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)} aria-label="Next page">›</button>
    </div>
  </div>;
}

function Orders() {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Array<DashboardData["recentOrders"][number] & { customerPhone?: string | null; source?: string; notes?: string | null; subtotal?: string | number; items?: Array<{ id: number; itemName: string; quantity: number; unitPrice: string | number; lineTotal: string | number }> }>>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [ordersPage, setOrdersPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [source, setSource] = useState("walk_in");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<Array<{ menuItemId: number; quantity: number }>>([]);
  const pageSize = 5;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<Array<DashboardData["recentOrders"][number] & { customerPhone?: string | null; source?: string; notes?: string | null; subtotal?: string | number; items?: Array<{ id: number; itemName: string; quantity: number; unitPrice: string | number; lineTotal: string | number }> }>>("/api/v1/orders");
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMenu = useCallback(async () => {
    try {
      const data = await api<MenuItem[]>("/api/v1/menu-items");
      setMenu(data.filter(item => item.isAvailable && item.stockQuantity > 0 && Number(item.price ?? 0) > 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load menu items");
    }
  }, []);

  useEffect(() => { loadOrders(); loadMenu(); }, [loadOrders, loadMenu]);
  useRealtimeRefresh(useCallback((event) => {
    if (event.type === "order.created" || event.type === "order.status_changed") loadOrders();
  }, [loadOrders]));

  const filtered = orders.filter(o =>
    (status === "all" || o.status === status) &&
    [o.orderNumber, o.customerName ?? "", o.customerPhone ?? ""].some(v => v.toLowerCase().includes(query.toLowerCase()))
  );
  const ordersTotalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedOrders = filtered.slice((ordersPage - 1) * pageSize, ordersPage * pageSize);
  const cartItems = cart.map(entry => {
    const item = menu.find(candidate => candidate.id === entry.menuItemId);
    return item ? { ...item, quantity: entry.quantity } : null;
  }).filter((item): item is MenuItem & { quantity: number } => item !== null);
  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.price ?? 0) * item.quantity, 0);

  useEffect(() => { setOrdersPage(1); }, [status, query]);
  useEffect(() => { if (ordersPage > ordersTotalPages) setOrdersPage(ordersTotalPages); }, [ordersPage, ordersTotalPages]);

  function resetCreateForm() {
    setCustomerName("");
    setCustomerPhone("");
    setSource("walk_in");
    setNotes("");
    setCart([]);
    setError("");
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!cartItems.length) { setError("Add at least one available menu item."); return; }
    if (customerPhone.trim() && !/^[+0-9()\-\s]{7,30}$/.test(customerPhone.trim())) {
      setError("Enter a valid customer phone number.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          source,
          notes: notes.trim() || undefined,
          items: cartItems.map(item => ({
            menuItemId: item.id,
            itemName: item.name,
            unitPrice: Number(item.price ?? 0),
            quantity: item.quantity
          }))
        })
      });
      setShowCreate(false);
      resetCreateForm();
      setSuccess("Order created successfully.");
      window.setTimeout(() => setSuccess(""), 3200);
      await Promise.all([loadOrders(), loadMenu()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create order");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(orderId: number, nextStatus: string) {
    const current = orders.find(order => order.id === orderId);
    if (!current || current.status === nextStatus || current.status === "completed") return;
    if (nextStatus === "completed") {
      const approved = window.confirm(
        `Complete order ${current.orderNumber}? Once completed, this order will be locked and its status cannot be changed.`
      );
      if (!approved) return;
    }
    setError("");
    try {
      await api("/api/v1/orders/" + orderId + "/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      setOrders(currentOrders => currentOrders.map(order => order.id === orderId ? { ...order, status: nextStatus } : order));
      setSuccess("Order status updated.");
      window.setTimeout(() => setSuccess(""), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update order status");
    }
  }

  return <section className="menu-management orders-page">
    {success && <div className="chef-success-toast category-success-toast" role="status" aria-live="polite"><div className="chef-success-bubble"><strong>Chef says</strong><span>{success}</span></div><div className="chef-success-character" aria-hidden="true"><img src="/assets/kumari-bites-chef.png" alt="" /></div></div>}
    <article className="panel menu-panel orders-panel">
      {error && !showCreate && <div className="inline-error" role="alert">{error} <button type="button" onClick={loadOrders}>Retry</button></div>}
      <div className="menu-toolbar menu-index-controls orders-toolbar">
        <input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search order, customer or phone..." />
        <CustomSelect value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, ...["new","confirmed","preparing","ready","completed","cancelled"].map(s => ({ value: s, label: statusLabel(s) }))]} />
      </div>
      {loading ? <p className="muted">Loading orders...</p> : <div className="menu-table-wrap orders-table-wrap">
        <table className="menu-table orders-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Total</th><th>Update</th></tr></thead>
          <tbody>{pagedOrders.map(order => <tr key={order.id}>
            <td><div className="order-main-cell"><strong>{order.orderNumber}</strong><small>{order.placedAt ? new Date(order.placedAt).toLocaleString("en-IN") : "—"}</small></div></td>
            <td><div className="order-main-cell"><strong>{order.customerName || "Walk-in customer"}</strong><small>{order.customerPhone || "No phone provided"}</small></div></td>
            <td><div className="order-items-cell">{order.items?.length ? order.items.map(item => <span key={item.id}>{item.itemName} <small>× {item.quantity}</small></span>) : <span className="muted">Items unavailable</span>}</div></td>
            <td><span className={"order-status " + order.status}>{statusLabel(order.status)}</span></td>
            <td><strong>{money(order.totalAmount)}</strong></td>
            <td>{order.status === "completed" ? <span className="order-status-lock" title="Completed orders cannot be changed"><span aria-hidden="true">🔒</span> Locked</span> : <CustomSelect value={order.status} onChange={value => updateStatus(order.id, value)} portalMenu statusTone options={["new","confirmed","preparing","ready","completed","cancelled"].map(s => ({ value: s, label: statusLabel(s) }))} />}</td>
          </tr>)}</tbody>
        </table>
        {!filtered.length && <div className="empty-state orders-empty-state"><span className="orders-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg></span><strong>{query || status !== "all" ? "No matching orders" : "No orders yet"}</strong><p className="muted">{query || status !== "all" ? "Try changing your search or status filter." : "Use the + button at the bottom-right to create your first order."}</p></div>}
        <Pagination currentPage={ordersPage} totalPages={ordersTotalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setOrdersPage} />
      </div>}
    </article>

    <button type="button" className="menu-add-fab" aria-label="Create order" title="Create order" onClick={() => { resetCreateForm(); setShowCreate(true); }}><span aria-hidden="true">+</span></button>

    {showCreate && <div className="order-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}>
      <section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="add-order-title">
        <div className="order-modal-heading"><div><p className="eyebrow">KITCHEN SERVICE</p><h2 id="add-order-title">Add Order</h2><p className="muted">Add customer details and choose items for this order.</p></div><button type="button" className="image-preview-drawer-close" onClick={() => !saving && setShowCreate(false)} aria-label="Close add order">×</button></div>
        <form className="order-create-form" onSubmit={createOrder}>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="order-form-grid">
            <label>Customer name <input value={customerName} onChange={e => setCustomerName(e.target.value)} maxLength={120} placeholder="Name (optional)" /></label>
            <label>Phone number <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} maxLength={30} inputMode="tel" placeholder="WhatsApp / contact number" /></label>
            <label>Order source <CustomSelect value={source} onChange={setSource} options={[{value:"walk_in",label:"Walk-in"},{value:"admin",label:"Admin entry"},{value:"qr",label:"QR order"}]} /></label>
            <label className="order-notes-field">Order notes <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="Special instructions (optional)" /></label>
          </div>
          <div className="order-item-picker">
            <div className="order-section-heading"><h3>Order items</h3><span>{cartItems.length} selected</span></div>
            <div className="order-add-item-row"><CustomSelect value="" onChange={value => { const id = Number(value); if (!cart.some(entry => entry.menuItemId === id)) setCart(current => [...current, { menuItemId: id, quantity: 1 }]); }} placeholder="Choose menu item..." options={menu.map(item => ({value:String(item.id),label:item.name + " · " + money(item.price)}))} /><span className="muted">Only available items</span></div>
            {cartItems.length ? <div className="order-cart-list">{cartItems.map(item => <div className="order-cart-row" key={item.id}><div><strong>{item.name}</strong><small>{money(item.price)} each</small></div><div className="quantity-control"><button type="button" onClick={() => setCart(current => current.map(entry => entry.menuItemId === item.id ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))} aria-label={"Decrease " + item.name}>−</button><span>{item.quantity}</span><button type="button" onClick={() => setCart(current => current.map(entry => entry.menuItemId === item.id ? { ...entry, quantity: Math.min(item.stockQuantity, entry.quantity + 1) } : entry))} disabled={item.quantity >= item.stockQuantity} aria-label={"Increase " + item.name}>+</button><strong>{money(Number(item.price ?? 0) * item.quantity)}</strong><button type="button" className="remove-order-item" onClick={() => setCart(current => current.filter(entry => entry.menuItemId !== item.id))} aria-label={"Remove " + item.name}>×</button></div></div>)}</div> : <div className="order-empty-cart">Choose one or more menu items to build this order.</div>}
          </div>
          <div className="order-total-row"><span>Order total</span><strong>{money(cartTotal)}</strong></div>
          <div className="order-modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !cartItems.length}>{saving ? "Creating order..." : "Create Order · " + money(cartTotal)}</button></div>
        </form>
      </section>
    </div>}
  </section>;
}

function CustomSelect({ value, onChange, options, placeholder = "Select...", portalMenu = false, statusTone = false }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string; portalMenu?: boolean; statusTone?: boolean }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 180 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open || !portalMenu) return;
    const positionMenu = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 180);
      const menuHeight = Math.min(options.length * 38 + 10, 250);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const top = rect.bottom + menuHeight + 8 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - menuHeight - 6);
      setMenuPosition({ top, left, width });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, portalMenu, options.length]);

  const menu = open && <div
    className={`custom-select-menu${statusTone ? " order-status-menu" : ""}`}
    style={portalMenu ? { position: "fixed", top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, zIndex: 10000 } : undefined}
    role="listbox"
  >
    {options.map(option => <button
      type="button"
      key={option.value}
      role="option"
      aria-selected={option.value === value}
      className={`custom-select-option${option.value === value ? " selected" : ""}${statusTone ? ` order-status-option order-status-option-${option.value}` : ""}`}
      onClick={() => { onChange(option.value); setOpen(false); }}
    >{option.label}</button>)}
  </div>;

  return <div className={`custom-select${statusTone ? " order-status-select" : ""}`}>
    <button
      ref={triggerRef}
      type="button"
      className={`custom-select-trigger${statusTone ? ` order-status-trigger order-status-trigger-${value}` : ""}`}
      onClick={() => setOpen(current => !current)}
      aria-expanded={open}
    >
      <span>{selected?.label ?? placeholder}</span><span className="custom-select-chevron">⌄</span>
    </button>
    {open && portalMenu && typeof document !== "undefined" ? createPortal(menu, document.body) : menu}
  </div>;
}
function MenuManagement() {
  const [tab, setTab] = useState<"items" | "categories">("items");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemsPage, setItemsPage] = useState(1);
  const [categoriesPage, setCategoriesPage] = useState(1);
  const pageSize = 5;
  const [itemModal, setItemModal] = useState<MenuItem | null | "new">(null);
  const [categoryModal, setCategoryModal] = useState<Category | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [itemImage, setItemImage] = useState("");
  const [categoryImage, setCategoryImage] = useState("");
  const [lowStockAlert, setLowStockAlert] = useState<{ itemName: string; quantity: number; threshold: number } | null>(null);
  const [categorySuccess, setCategorySuccess] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState("");
  const [previewImage, setPreviewImage] = useState<{ url: string; type: "item" | "category"; name: string; category?: string; price?: string | number | null; description?: string | null; isVeg?: boolean; isAvailable?: boolean; stockQuantity?: number; slug?: string; itemCount?: number; isActive?: boolean } | null>(null);

  useEffect(() => {
    if (!itemModal) {
      setItemImage("");
      return;
    }
    setItemImage(itemModal === "new" ? "" : itemModal.imageUrl ?? "");
    const initialCategoryId = itemModal === "new" ? (categories.find(category => category.isActive)?.id ?? 0) : itemModal?.categoryId ?? 0;
    setItemCategoryId(initialCategoryId ? String(initialCategoryId) : "");
  }, [itemModal]);

  useEffect(() => {
    setCategoryImage(categoryModal === "new" ? "" : categoryModal?.imageUrl ?? "");
  }, [categoryModal]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [categoryData, itemData] = await Promise.all([
        api<Category[]>("/api/v1/categories"),
        api<MenuItem[]>("/api/v1/menu-items")
      ]);
      setCategories(categoryData);
      setItems(itemData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load menu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtimeRefresh(useCallback((event) => {
    if (event.type === "menu.low_stock") {
      const payload = event.payload as { itemName?: string; quantity?: number; threshold?: number } | undefined;
      if (payload?.itemName) setLowStockAlert({ itemName: payload.itemName, quantity: Number(payload.quantity ?? 0), threshold: Number(payload.threshold ?? 0) });
      load();
    }
  }, [load]));

  const visibleItems = useMemo(() => items.filter(item => {
    const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = categoryFilter === "all" || String(item.categoryId) === categoryFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "available" ? item.isAvailable : !item.isAvailable);
    return matchesQuery && matchesCategory && matchesStatus;
  }), [items, query, categoryFilter, statusFilter]);

  const itemsTotalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pagedItems = visibleItems.slice((itemsPage - 1) * pageSize, itemsPage * pageSize);

  const categoryName = (id: number) => categories.find(category => category.id === id)?.name ?? "Unassigned";

  const visibleCategories = useMemo(() => categories.filter(category => {
    const matchesQuery = category.name.toLowerCase().includes(categoryQuery.toLowerCase()) ||
      (category.description ?? "").toLowerCase().includes(categoryQuery.toLowerCase());
    const matchesStatus = categoryStatusFilter === "all" ||
      (categoryStatusFilter === "active" ? category.isActive : !category.isActive);
    return matchesQuery && matchesStatus;
  }), [categories, categoryQuery, categoryStatusFilter]);

  const categoriesTotalPages = Math.max(1, Math.ceil(visibleCategories.length / pageSize));
  const pagedCategories = visibleCategories.slice((categoriesPage - 1) * pageSize, categoriesPage * pageSize);

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const categoryId = itemCategoryId;
    const price = Number(form.get("price"));
    if (!name) { setError("Please enter the menu item name."); return; }
    if (!categoryId || categoryId === "0") { setError("Please choose a menu category."); return; }
    if (!Number.isFinite(price) || price <= 0) { setError("Please enter a valid price greater than ₹0."); return; }
    setSaving(true);
    try {
      const payload = {
        categoryId: Number(categoryId),
        name,
        description: String(form.get("description") ?? "").trim() || undefined,
        imageUrl: itemImage || undefined,
        isVeg: form.get("isVeg") === "on",
        isAvailable: form.get("isAvailable") === "on",
        stockQuantity: Number(form.get("stockQuantity") ?? 0),
        lowStockThreshold: Number(form.get("lowStockThreshold") ?? 5),
        lowStockAlertEnabled: form.get("lowStockAlertEnabled") === "on",
        price
      };
      const isNewItem = itemModal === "new";
      if (isNewItem) {
        await api("/api/v1/menu-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else if (itemModal) {
        await api(`/api/v1/menu-items/${itemModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      setItemModal(null);
      await load();
      setCategorySuccess(isNewItem ? "Menu item added successfully." : "Menu item updated successfully.");
      window.setTimeout(() => setCategorySuccess(""), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save menu item");
    } finally {
      setSaving(false);
    }
  }

  async function toggleItem(item: MenuItem) {
    try {
      if (item.isAvailable) {
        await api(`/api/v1/menu-items/${item.id}`, { method: "DELETE" });
      } else {
        await api(`/api/v1/menu-items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isAvailable: true }) });
      }
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Unable to update availability");
    }
  }

  async function reorderCategories(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ordered = [...categories];
    const from = ordered.findIndex(category => category.id === draggedId);
    const to = ordered.findIndex(category => category.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const reordered = ordered.map((category, index) => ({ ...category, sortOrder: index }));
    setCategories(reordered);
    setDraggedCategoryId(null);
    setError("");
    try {
      await Promise.all(reordered.map(category => api(`/api/v1/categories/${category.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: category.sortOrder })
      })));
      setCategorySuccess("Category order updated successfully.");
      window.setTimeout(() => setCategorySuccess(""), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update category order");
      await load();
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) { setError("Please enter the category name."); return; }

    setSaving(true);
    try {
      const payload = {
        name,
        slug: String(form.get("slug") ?? "").trim() || undefined,
        description: String(form.get("description") ?? "").trim() || undefined,
        imageUrl: categoryImage || undefined
      };
      if (categoryModal === "new") {
        await api("/api/v1/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else if (categoryModal) {
        await api(`/api/v1/categories/${categoryModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      setCategoryModal(null);
      await load();
      setCategorySuccess(categoryModal === "new" ? "Category added successfully." : "Category updated successfully.");
      window.setTimeout(() => setCategorySuccess(""), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save category");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(category: Category) {
    const nextActive = !category.isActive;
    setError("");
    setCategorySuccess("");
    setCategories(current => current.map(entry => entry.id === category.id ? { ...entry, isActive: nextActive } : entry));

    try {
      if (category.isActive) {
        await api(`/api/v1/categories/${category.id}`, { method: "DELETE" });
      } else {
        await api(`/api/v1/categories/${category.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true })
        });
      }
      setCategorySuccess(`${category.name} is now ${nextActive ? "active" : "inactive"}.`);
      window.setTimeout(() => setCategorySuccess(""), 3200);
    } catch (err) {
      setCategories(current => current.map(entry => entry.id === category.id ? { ...entry, isActive: category.isActive } : entry));
      setError(err instanceof Error ? err.message : "Unable to update category");
    }
  }

  const activeCategories = useMemo(() => categories.filter(category => category.isActive), [categories]);

  const itemDefaults = itemModal === "new" ? {
    name: "", categoryId: activeCategories[0]?.id ?? 0, price: "", description: "", imageUrl: "", isVeg: false, isAvailable: true, stockQuantity: 0, lowStockThreshold: 5, lowStockAlertEnabled: true
  } : itemModal ? itemModal : null;

  const categoryDefaults = categoryModal === "new" ? { name: "", slug: "", description: "", imageUrl: "" } : categoryModal;

  return <section className="menu-management">
    {lowStockAlert && <div className="inline-error low-stock-alert" role="alert"><strong>Low stock:</strong> {lowStockAlert.itemName} has {lowStockAlert.quantity} left (threshold {lowStockAlert.threshold}). It is now unavailable. <button onClick={() => setLowStockAlert(null)}>Dismiss</button></div>}
    {categorySuccess && <div className="chef-success-toast category-success-toast" role="status" aria-live="polite">
      <div className="chef-success-bubble"><strong>Chef says</strong><span>{categorySuccess}</span></div>
      <div className="chef-success-character" aria-hidden="true"><img src="/assets/kumari-bites-chef.png" alt="" /></div>
    </div>}

    <div className="menu-tabs" role="tablist" aria-label="Menu management sections">
      <button type="button" role="tab" aria-selected={tab === "items"} className={tab === "items" ? "active" : ""} onClick={() => setTab("items")}>
        <span>Menu Items</span><span className="menu-tab-count">{items.length}</span>
      </button>
      <button type="button" role="tab" aria-selected={tab === "categories"} className={tab === "categories" ? "active" : ""} onClick={() => setTab("categories")}>
        <span>Categories</span><span className="menu-tab-count">{categories.length}</span>
      </button>
    </div>

    {error && <div className="inline-error">{error} <button onClick={load}>Retry</button></div>}

    {tab === "items" ? <article className="panel menu-panel">
      <div className="menu-toolbar menu-index-controls">
        <input className="search-input" value={query} onChange={e => { setQuery(e.target.value); setItemsPage(1); }} placeholder="Search menu items..." />
        <CustomSelect value={categoryFilter} onChange={value => { setCategoryFilter(value); setItemsPage(1); }} options={[{ value: "all", label: "All categories" }, ...categories.map(c => ({ value: String(c.id), label: c.name }))]} />
        <CustomSelect value={statusFilter} onChange={value => { setStatusFilter(value); setItemsPage(1); }} options={[{ value: "all", label: "All status" }, { value: "available", label: "Available" }, { value: "unavailable", label: "Unavailable" }]} />
      </div>
      {loading ? <p className="muted">Loading menu...</p> : <div className="menu-table-wrap"><table className="menu-table"><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Type</th><th>Availability</th><th></th></tr></thead><tbody>
        {pagedItems.map(item => <tr key={item.id}>
          <td><div className="item-cell">{item.imageUrl ? <button type="button" className="table-image-button" onClick={() => setPreviewImage({ url: item.imageUrl!, type: "item", name: item.name, category: categoryName(item.categoryId), price: item.price, description: item.description, isVeg: item.isVeg, isAvailable: item.isAvailable, stockQuantity: item.stockQuantity })} aria-label={`Preview ${item.name} image`}><img src={item.imageUrl} alt="" /></button> : <div className="image-placeholder">🍽️</div>}<div><strong>{item.name}</strong><small>{item.stockQuantity} in stock</small></div></div></td>
          <td>{categoryName(item.categoryId)}</td><td className="price-cell">{money(item.price)}</td>
          <td><span className={item.isVeg ? "veg-badge" : "nonveg-badge"}>{item.isVeg ? "VEG" : "NON-VEG"}</span></td>
          <td><button className={`switch ${item.isAvailable ? "on" : ""}`} onClick={() => toggleItem(item)} aria-label={item.isAvailable ? "Disable item" : "Enable item"}><span /></button></td>
          <td><button className="table-action menu-action-edit" onClick={() => setItemModal(item)}><span className="button-icon">✎</span><span>Edit</span></button></td>
        </tr>)}
      </tbody></table><Pagination currentPage={itemsPage} totalPages={itemsTotalPages} totalItems={visibleItems.length} pageSize={pageSize} onPageChange={setItemsPage} />{!visibleItems.length && <div className="empty-state"><span>🍛</span><strong>No menu items found</strong><p className="muted">Add your first menu item to get started.</p></div>}</div>}
    </article> : <article className="panel menu-panel category-management-panel">
      <div className="category-overview">
        <div className="category-stat"><span>Total</span><strong>{categories.length}</strong><small>All menu categories</small></div>
        <div className="category-stat"><span>Active</span><strong>{categories.filter(category => category.isActive).length}</strong><small>Available for new dishes</small></div>
        <div className="category-stat"><span>Inactive</span><strong>{categories.filter(category => !category.isActive).length}</strong><small>Can be enabled anytime</small></div>
      </div>
      <div className="category-toolbar">
        <input className="search-input" value={categoryQuery} onChange={e => setCategoryQuery(e.target.value)} placeholder="Search categories..." />
        <CustomSelect value={categoryStatusFilter} onChange={value => setCategoryStatusFilter(value as "all" | "active" | "inactive")} options={[{ value: "all", label: "All status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
      </div>
      {loading ? <p className="muted">Loading categories...</p> : <div className="menu-table-wrap"><table className="menu-table category-table"><thead><tr><th>Category</th><th>Description</th><th>Items</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {pagedCategories.map(category => <tr key={category.id} draggable onDragStart={() => setDraggedCategoryId(category.id)} onDragOver={event => event.preventDefault()} onDrop={() => draggedCategoryId !== null && reorderCategories(draggedCategoryId, category.id)} className={draggedCategoryId === category.id ? "category-dragging" : ""}>
          <td><div className="category-name-cell"><button type="button" className="category-drag-handle" draggable aria-label={`Drag ${category.name} to reorder`} title="Drag to reorder">⠿</button><div className="category-avatar">{category.imageUrl ? <button type="button" className="table-image-button category-table-image-button" onClick={() => setPreviewImage({ url: category.imageUrl!, type: "category", name: category.name, slug: category.slug, description: category.description, itemCount: items.filter(item => item.categoryId === category.id).length, isActive: category.isActive })} aria-label={`Preview ${category.name} image`}><img src={category.imageUrl} alt="" /></button> : <span>🍽️</span>}</div><div><strong>{category.name}</strong><small>/{category.slug}</small></div></div></td>
          <td>{category.description || "No description added"}</td>
          <td><span className="category-item-count">{items.filter(item => item.categoryId === category.id).length}</span></td>
          <td><span className={`category-status ${category.isActive ? "active" : "inactive"}`}><span className="status-dot" />{category.isActive ? "Active" : "Inactive"}</span></td>
          <td><div className="action-group"><button className="table-action menu-action-edit" onClick={() => setCategoryModal(category)}><span className="button-icon">✎</span><span>Edit</span></button><button className={`category-enable-button ${category.isActive ? "disable" : "enable"}`} onClick={() => toggleCategory(category)}><span>{category.isActive ? "Disable" : "Enable"}</span></button></div></td>
        </tr>)}
      </tbody></table><Pagination currentPage={categoriesPage} totalPages={categoriesTotalPages} totalItems={visibleCategories.length} pageSize={pageSize} onPageChange={setCategoriesPage} />{!visibleCategories.length && <div className="empty-state"><span>🗂️</span><strong>No matching categories</strong><p className="muted">{categories.length ? "Try another search or status filter." : "Create a category before adding menu items."}</p></div>}</div>}
    </article>}

    <button
      type="button"
      className="menu-add-fab"
      aria-label={tab === "items" ? "Add menu item" : "Add category"}
      title={tab === "items" ? "Add menu item" : "Add category"}
      onClick={() => tab === "items" ? setItemModal("new") : setCategoryModal("new")}
    >
      <span aria-hidden="true">+</span>
    </button>

    {itemDefaults && <div className="modal-backdrop" onMouseDown={e => e.currentTarget === e.target && setItemModal(null)}><form className="modal-card" onSubmit={saveItem}>
      <div className="modal-head"><div><p className="eyebrow">MENU ITEM</p><h2>{itemModal === "new" ? "Add menu item" : "Edit menu item"}</h2></div><button type="button" className="icon-button menu-action-close" onClick={() => setItemModal(null)} aria-label="Close menu item editor">×</button></div>
      <div className="menu-item-editor">
        {error && <div className="chef-guide menu-item-feedback has-error" role="alert" aria-live="polite"><div className="chef-character" aria-hidden="true"><img src="/assets/kumari-bites-chef.png" alt="" /></div><div className="chef-bubble"><strong>Chef says</strong><span>{error}</span></div></div>}
        <div className="editor-section">
          <div className="editor-section-head"><span className="editor-step">01</span><div><strong>Basic details</strong><small>Name the dish and place it in the right menu category.</small></div></div>
          <div className="form-grid">
            <label className="field-wide">Item name *<input name="name" defaultValue={itemDefaults.name} placeholder="e.g. Momos" /></label>
            <label>Category *<div className="custom-form-select"><CustomSelect value={itemCategoryId} onChange={value => setItemCategoryId(value)} options={activeCategories.map(c => ({ value: String(c.id), label: c.name }))} placeholder="Select category" /></div><input className="visually-hidden-field" name="categoryId" value={itemCategoryId} readOnly /></label>
            <label>Price *<div className="price-input"><span>₹</span><input name="price" type="number" min="0" step="0.01" defaultValue={itemDefaults.price ?? ""} placeholder="0" /></div></label>
          </div>
        </div>
        <div className="editor-section">
          <div className="editor-section-head"><span className="editor-step">02</span><div><strong>Dish presentation</strong><small>Add the image and short description customers should see.</small></div></div>
          <div className="editor-media-grid">
            <ImageUpload value={itemImage} onChange={setItemImage} onError={setError} name="imageUrl" alt="Selected dish" />
            <div className="editor-media-fields">
              <label>Description<textarea name="description" defaultValue={itemDefaults.description ?? ""} placeholder="Short description customers should see..." /></label>
            </div>
          </div>
        </div>
        <div className="editor-section editor-advanced">
          <div className="editor-section-head"><span className="editor-step">03</span><div><strong>Menu settings</strong><small>Optional internal details and availability.</small></div></div>
          <div className="form-grid stock-settings-grid">
            <label>Stock quantity<input name="stockQuantity" type="number" min="0" step="1" defaultValue={itemDefaults.stockQuantity ?? 0} /></label>
            <label>Low stock threshold<input name="lowStockThreshold" type="number" min="0" step="1" defaultValue={itemDefaults.lowStockThreshold ?? 5} /></label>
          </div>
          <div className="toggle-row">
            <label className="toggle-check"><input name="lowStockAlertEnabled" type="checkbox" defaultChecked={itemDefaults.lowStockAlertEnabled ?? true} /> <span><strong>Low stock alert</strong><small>Notify and mark unavailable at the threshold</small></span></label>
            <label className="toggle-check"><input name="isVeg" type="checkbox" defaultChecked={itemDefaults.isVeg} /> <span><strong>Vegetarian</strong><small>Mark this dish as vegetarian</small></span></label>
            <label className="toggle-check"><input name="isAvailable" type="checkbox" defaultChecked={itemDefaults.isAvailable} /> <span><strong>Available</strong><small>Show this item as orderable</small></span></label>
          </div>
        </div>
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button menu-action-secondary" onClick={() => setItemModal(null)}><span className="button-icon">×</span><span>Cancel</span></button><button className="primary-button editor-save menu-action-primary" disabled={saving}><span className="button-icon">{saving ? "…" : "＋"}</span><span>{saving ? "Saving..." : itemModal === "new" ? "Add menu item" : "Save changes"}</span></button></div>
    </form></div>}

    {previewImage && <ImagePreviewDrawer preview={previewImage} onClose={() => setPreviewImage(null)} />}

    {categoryDefaults && <div className="modal-backdrop" onMouseDown={e => e.currentTarget === e.target && setCategoryModal(null)}><form className="modal-card category-modal-card" onSubmit={saveCategory}>
      <div className="modal-head"><div><p className="eyebrow">CATEGORY</p><h2>{categoryModal === "new" ? "Add category" : "Edit category"}</h2><p className="modal-subtitle">Create a clean category for your menu and keep it easy to recognise.</p></div><button type="button" className="icon-button menu-action-close" onClick={() => setCategoryModal(null)} aria-label="Close category editor">×</button></div>
      <div className="menu-item-editor category-editor">
        {error && <div className="chef-guide menu-item-feedback has-error" role="alert" aria-live="polite"><div className="chef-character" aria-hidden="true"><img src="/assets/kumari-bites-chef.png" alt="" /></div><div className="chef-bubble"><strong>Chef says</strong><span>{error}</span></div></div>}
        <div className="editor-section">
          <div className="editor-section-head"><span className="editor-step">01</span><div><strong>Basic details</strong><small>Name the category and add a short description for your menu.</small></div></div>
          <div className="form-grid">
            <label className="field-wide">Category name *<input name="name" defaultValue={categoryDefaults.name} placeholder="e.g. South Indian" /></label>
            <label className="field-wide">Description<textarea name="description" defaultValue={categoryDefaults.description ?? ""} placeholder="Short description customers should see..." /></label>
          </div>
        </div>
        <div className="editor-section">
          <div className="editor-section-head"><span className="editor-step">02</span><div><strong>Category presentation</strong><small>Add a visual image that represents this category.</small></div></div>
          <div className="editor-media-grid category-media-grid">
            <ImageUpload value={categoryImage} onChange={setCategoryImage} onError={setError} name="imageUrl" alt="Selected category" />
          </div>
        </div>
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button menu-action-secondary" onClick={() => setCategoryModal(null)}><span className="button-icon">×</span><span>Cancel</span></button><button className="primary-button menu-action-primary" disabled={saving}><span className="button-icon">{saving ? "…" : "✓"}</span><span>{saving ? "Saving..." : categoryModal === "new" ? "Save category" : "Update category"}</span></button></div>
    </form></div>}
  </section>;
}

const dashboardRoutes: Record<string, string> = {
  Dashboard: "/dashboard",
  Orders: "/orders",
  Menu: "/menu",
  Reports: "/reports",
  Settings: "/settings"
};

const dashboardPages: Record<string, string> = Object.fromEntries(
  Object.entries(dashboardRoutes).map(([name, path]) => [path, name])
);

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState(() => dashboardPages[window.location.pathname] ?? "Dashboard");

  useEffect(() => {
    const syncRoute = () => setActive(dashboardPages[window.location.pathname] ?? "Dashboard");
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const navigate = (page: string) => {
    const path = dashboardRoutes[page] ?? "/dashboard";
    window.history.pushState({}, "", path);
    setActive(page);
  };

  return <div className="app-shell dashboard-background">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark small">KB</span><span>Kumari Bites</span></div>
      <nav>{menuItems.map(item => <button key={item.label} className={active === item.label ? "nav-item active" : "nav-item"} onClick={() => navigate(item.label)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-admin"><span className="avatar">A</span><div><strong>Admin</strong><small>Kumari Bites</small></div></div>
      <button className="nav-item logout" onClick={async () => { await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }); window.history.replaceState({}, "", "/"); onLogout(); }}><span>↪</span> Sign out</button>
    </aside>
    <main className="dashboard">
      <header className="topbar"><div>{active === "Menu" || active === "Orders" || active === "Dashboard" ? <h2>{active === "Menu" ? "Menu Management" : active === "Orders" ? "Orders" : "Dashboard"}</h2> : <><p className="eyebrow">KUMARI BITES ADMIN</p><h2>{active}</h2></>}</div></header>
      {active === "Dashboard" ? <DashboardHome /> : active === "Orders" ? <Orders /> : active === "Menu" ? <MenuManagement /> : <section className="panel"><h3>{active}</h3><p className="muted">This module is coming next.</p></section>}
    </main>
  </div>;
}

export function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then(r => setLoggedIn(r.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  if (loggedIn === null) return <main className="login-page"><section className="login-card"><p className="muted">Checking your session...</p></section></main>;
  return loggedIn ? <Dashboard onLogout={() => setLoggedIn(false)} /> : <Login onLogin={() => setLoggedIn(true)} />;
}
