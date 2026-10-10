import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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

const featuredMenuItems = [
  "Momos",
  "Veg Mojito",
  "Combo Platter",
  "Custom Chips",
  "French Fries",
  "Kathi Rolls"
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
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api<DashboardData>("/api/v1/dashboard").then(setData).catch(e => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(useCallback((event) => {
    if (event.type === "order.created" || event.type === "order.status_changed") load();
  }, [load]));

  if (error) return <section className="panel"><h3>Dashboard unavailable</h3><p className="muted">{error}</p><button className="primary-button compact" onClick={load}>Retry</button></section>;
  if (!data) return <section className="panel"><p className="muted">Loading dashboard...</p></section>;

  const top = data.popularItems[0];

  return <>
    <section className="welcome">
      <div><p className="eyebrow">KITCHEN TODAY</p><h1>Good morning, Admin</h1><p className="muted">A live view of today’s orders, sales and the Kumari Bites menu.</p></div>
      <button className="primary-button compact">+ New order</button>
    </section>
    <section className="menu-spotlight">
      <div className="menu-spotlight-copy">
        <p className="eyebrow">FROM OUR MENU</p>
        <h3>Fresh favourites, ready to serve</h3>
        <p className="muted">The menu behind today’s kitchen activity.</p>
      </div>
      <div className="menu-spotlight-items">
        {featuredMenuItems.map(item => <span key={item}>{item}</span>)}
      </div>
    </section>
    <section className="stats">
      <article><span>Today's sales</span><strong>{money(data.today.sales)}</strong><small>{data.today.completedOrders} orders completed</small></article>
      <article><span>Live orders</span><strong>{data.today.orders}</strong><small>{data.today.activeOrders} in the kitchen</small></article>
      <article><span>Average order</span><strong>{money(data.today.averageOrder)}</strong><small>Per order today</small></article>
      <article><span>Menu favourite</span><strong>{top?.itemName ?? "—"}</strong><small>{top?.quantity ?? 0} sold today</small></article>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="panel-head"><div><h3>Fresh from the kitchen</h3><p className="muted">Latest orders and service status</p></div><span className="status-dot">Live</span></div>
        {data.recentOrders.slice(0, 5).map(o => <div className="order-row" key={o.id}><div><strong>{o.orderNumber}</strong><span>{o.customerName ?? "Walk-in customer"}</span></div><span className={`badge ${o.status}`}>{statusLabel(o.status)}</span><strong>{money(o.totalAmount)}</strong></div>)}
        {!data.recentOrders.length && <p className="muted">No orders yet.</p>}
      </article>
      <article className="panel"><div className="panel-head"><div><h3>Menu favourites</h3><p className="muted">What customers are ordering today</p></div></div>
        {data.popularItems.map((item, i) => <div className="popular-row" key={item.itemName}><span className="rank">{i + 1}</span><span>{item.itemName}</span><strong>{item.quantity}</strong></div>)}
        {!data.popularItems.length && <p className="muted">No sales yet.</p>}
      </article>
    </section>
    <section className="panel"><div className="panel-head"><div><h3>Sales rhythm</h3><p className="muted">Last 7 days of Kumari Bites orders</p></div></div>
      <div className="trend-row">{data.salesTrend.map(day => <span key={String(day.sale_date)}>{String(day.sale_date).slice(5)} · {money(day.sales)}</span>)}</div>
    </section>
  </>;
}

function Orders() {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<DashboardData["recentOrders"]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(() => {
    setLoading(true);
    api<DashboardData["recentOrders"]>("/api/v1/orders").then(setOrders).catch(() => setOrders([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useRealtimeRefresh(useCallback((event) => {
    if (event.type === "order.created" || event.type === "order.status_changed") loadOrders();
  }, [loadOrders]));

  const filtered = orders.filter(o =>
    (status === "all" || o.status === status) &&
    [o.orderNumber, o.customerName ?? ""].some(v => v.toLowerCase().includes(query.toLowerCase()))
  );

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">KITCHEN SERVICE</p><h3>Orders</h3><p className="muted">Keep every Kumari Bites order moving from new to ready.</p></div><span className="status-dot">Live</span></div>
    <div className="orders-toolbar"><input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search order or customer" />
      <select aria-label="Filter orders by kitchen status" className="filter-select" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All kitchen statuses</option>{["new","confirmed","preparing","ready","completed","cancelled"].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
    </div>
    <div style={{ overflowX: "auto" }}>{loading ? <p className="muted" style={{ padding: 25 }}>Loading orders...</p> : <table className="orders-table"><thead><tr><th>Order</th><th>Customer</th><th>Kitchen status</th><th>Total</th></tr></thead><tbody>
      {filtered.map(o => <tr key={o.id}><td className="order-number">{o.orderNumber}</td><td><div className="order-customer"><strong>{o.customerName ?? "Walk-in customer"}</strong><small>{o.placedAt ? new Date(o.placedAt).toLocaleString("en-IN") : "—"}</small></div></td><td><span className={`order-status ${o.status}`}>{statusLabel(o.status)}</span></td><td><strong>{money(o.totalAmount)}</strong></td></tr>)}
    </tbody></table>}{!loading && !filtered.length && <p className="muted" style={{ padding: 25, textAlign: "center" }}>No orders found.</p>}</div>
  </section>;
}

function MenuManagement() {
  const [tab, setTab] = useState<"items" | "categories">("items");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemModal, setItemModal] = useState<MenuItem | null | "new">(null);
  const [categoryModal, setCategoryModal] = useState<Category | "new" | null>(null);
  const [saving, setSaving] = useState(false);

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

  const visibleItems = useMemo(() => items.filter(item => {
    const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = categoryFilter === "all" || String(item.categoryId) === categoryFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "available" ? item.isAvailable : !item.isAvailable);
    return matchesQuery && matchesCategory && matchesStatus;
  }), [items, query, categoryFilter, statusFilter]);

  const categoryName = (id: number) => categories.find(category => category.id === id)?.name ?? "Unassigned";

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        categoryId: Number(form.get("categoryId")),
        name: String(form.get("name") ?? "").trim(),
        slug: String(form.get("slug") ?? "").trim(),
        description: String(form.get("description") ?? "").trim() || undefined,
        imageUrl: String(form.get("imageUrl") ?? "").trim() || undefined,
        sku: String(form.get("sku") ?? "").trim() || undefined,
        isVeg: form.get("isVeg") === "on",
        isAvailable: form.get("isAvailable") === "on",
        price: Number(form.get("price")),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      };
      if (itemModal === "new") {
        await api("/api/v1/menu-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else if (itemModal) {
        await api(`/api/v1/menu-items/${itemModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      setItemModal(null);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Unable to save menu item");
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

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        name: String(form.get("name") ?? "").trim(),
        slug: String(form.get("slug") ?? "").trim(),
        description: String(form.get("description") ?? "").trim() || undefined,
        imageUrl: String(form.get("imageUrl") ?? "").trim() || undefined,
        sortOrder: Number(form.get("sortOrder") ?? 0)
      };
      if (categoryModal === "new") {
        await api("/api/v1/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else if (categoryModal) {
        await api(`/api/v1/categories/${categoryModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      setCategoryModal(null);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Unable to save category");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(category: Category) {
    try {
      if (category.isActive) await api(`/api/v1/categories/${category.id}`, { method: "DELETE" });
      else await api(`/api/v1/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: true }) });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Unable to update category");
    }
  }

  const itemDefaults = itemModal === "new" ? {
    name: "", slug: "", categoryId: categories[0]?.id ?? 0, price: "", description: "", imageUrl: "", sku: "", isVeg: false, isAvailable: true, sortOrder: 0
  } : itemModal ? itemModal : null;

  const categoryDefaults = categoryModal === "new" ? { name: "", slug: "", description: "", imageUrl: "", sortOrder: 0 } : categoryModal;

  return <section className="menu-management">
    <div className="welcome menu-heading">
      <div><p className="eyebrow">MENU MANAGEMENT</p><h1>Menu</h1><p className="muted">Keep categories, dishes and pricing simple and up to date.</p></div>
      <button className="primary-button compact" onClick={() => tab === "items" ? setItemModal("new") : setCategoryModal("new")}>+ {tab === "items" ? "Add menu item" : "Add category"}</button>
    </div>

    <div className="menu-tabs">
      <button className={tab === "items" ? "active" : ""} onClick={() => setTab("items")}>Menu Items <span>{items.length}</span></button>
      <button className={tab === "categories" ? "active" : ""} onClick={() => setTab("categories")}>Categories <span>{categories.length}</span></button>
    </div>

    {error && <div className="inline-error">{error} <button onClick={load}>Retry</button></div>}

    {tab === "items" ? <article className="panel menu-panel">
      <div className="menu-toolbar">
        <input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search menu items..." />
        <select className="filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">All status</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select>
      </div>
      {loading ? <p className="muted">Loading menu...</p> : <div className="menu-table-wrap"><table className="menu-table"><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Type</th><th>Availability</th><th></th></tr></thead><tbody>
        {visibleItems.map(item => <tr key={item.id}>
          <td><div className="item-cell">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="image-placeholder">🍽️</div>}<div><strong>{item.name}</strong><small>{item.sku || "No SKU"}</small></div></div></td>
          <td>{categoryName(item.categoryId)}</td><td className="price-cell">{money(item.price)}</td>
          <td><span className={item.isVeg ? "veg-badge" : "nonveg-badge"}>{item.isVeg ? "VEG" : "NON-VEG"}</span></td>
          <td><button className={`switch ${item.isAvailable ? "on" : ""}`} onClick={() => toggleItem(item)} aria-label={item.isAvailable ? "Disable item" : "Enable item"}><span /></button></td>
          <td><button className="table-action" onClick={() => setItemModal(item)}>Edit</button></td>
        </tr>)}
      </tbody></table>{!visibleItems.length && <div className="empty-state"><span>🍛</span><strong>No menu items found</strong><p className="muted">Add your first menu item to get started.</p></div>}</div>}
    </article> : <article className="panel menu-panel">
      {loading ? <p className="muted">Loading categories...</p> : <div className="menu-table-wrap"><table className="menu-table"><thead><tr><th>Category</th><th>Description</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>
        {categories.map(category => <tr key={category.id}><td><strong>{category.name}</strong><small>/{category.slug}</small></td><td>{category.description || "—"}</td><td>{items.filter(item => item.categoryId === category.id).length}</td><td><span className={`category-status ${category.isActive ? "active" : "inactive"}`}>{category.isActive ? "Active" : "Inactive"}</span></td><td className="action-group"><button className="table-action" onClick={() => setCategoryModal(category)}>Edit</button><button className="text-action" onClick={() => toggleCategory(category)}>{category.isActive ? "Disable" : "Enable"}</button></td></tr>)}
      </tbody></table>{!categories.length && <div className="empty-state"><span>🗂️</span><strong>No categories yet</strong><p className="muted">Create a category before adding menu items.</p></div>}</div>}
    </article>}

    {itemDefaults && <div className="modal-backdrop" onMouseDown={e => e.currentTarget === e.target && setItemModal(null)}><form className="modal-card" onSubmit={saveItem}>
      <div className="modal-head"><div><p className="eyebrow">MENU ITEM</p><h2>{itemModal === "new" ? "Add menu item" : "Edit menu item"}</h2></div><button type="button" className="icon-button" onClick={() => setItemModal(null)}>×</button></div>
      <div className="menu-item-editor">
        <div className="editor-section">
          <div className="editor-section-head"><span className="editor-step">01</span><div><strong>Basic details</strong><small>Name the dish and place it in the right menu category.</small></div></div>
          <div className="form-grid">
            <label className="field-wide">Item name *<input name="name" defaultValue={itemDefaults.name} required placeholder="e.g. Chicken Kathi Roll" /></label>
            <label>Category *<select name="categoryId" defaultValue={itemDefaults.categoryId} required>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Price *<div className="price-input"><span>₹</span><input name="price" type="number" min="0" step="0.01" defaultValue={itemDefaults.price ?? ""} required placeholder="0" /></div></label>
          </div>
        </div>
        <div className="editor-section">
          <div className="editor-section-head"><span className="editor-step">02</span><div><strong>Dish presentation</strong><small>Add the image and short description customers should see.</small></div></div>
          <div className="editor-media-grid">
            <div className="menu-image-preview">
              {itemDefaults.imageUrl ? <img src={itemDefaults.imageUrl} alt="" /> : <div><span>🍽️</span><strong>Dish image</strong><small>Paste an image URL</small></div>}
            </div>
            <div className="editor-media-fields">
              <label>Image URL<input name="imageUrl" defaultValue={itemDefaults.imageUrl ?? ""} placeholder="https://..." /></label>
              <label>Description<textarea name="description" defaultValue={itemDefaults.description ?? ""} placeholder="Short description for the menu..." /></label>
            </div>
          </div>
        </div>
        <div className="editor-section editor-advanced">
          <div className="editor-section-head"><span className="editor-step">03</span><div><strong>Menu settings</strong><small>Optional internal details and availability.</small></div></div>
          <div className="form-grid">
            <label>SKU<input name="sku" defaultValue={itemDefaults.sku ?? ""} placeholder="Optional" /></label>
            <label>Slug *<input name="slug" defaultValue={itemDefaults.slug} required placeholder="chicken-kathi-roll" /></label>
            <label>Sort order<input name="sortOrder" type="number" min="0" defaultValue={itemDefaults.sortOrder} /></label>
          </div>
          <div className="toggle-row">
            <label className="toggle-check"><input name="isVeg" type="checkbox" defaultChecked={itemDefaults.isVeg} /> <span><strong>Vegetarian</strong><small>Mark this dish as vegetarian</small></span></label>
            <label className="toggle-check"><input name="isAvailable" type="checkbox" defaultChecked={itemDefaults.isAvailable} /> <span><strong>Available</strong><small>Show this item as orderable</small></span></label>
          </div>
        </div>
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setItemModal(null)}>Cancel</button><button className="primary-button editor-save" disabled={saving}>{saving ? "Saving..." : itemModal === "new" ? "Add menu item" : "Save changes"}</button></div>
    </form></div>}

    {categoryDefaults && <div className="modal-backdrop" onMouseDown={e => e.currentTarget === e.target && setCategoryModal(null)}><form className="modal-card small-modal" onSubmit={saveCategory}>
      <div className="modal-head"><div><p className="eyebrow">CATEGORY</p><h2>{categoryModal === "new" ? "Add category" : "Edit category"}</h2></div><button type="button" className="icon-button" onClick={() => setCategoryModal(null)}>×</button></div>
      <div className="form-grid"><label>Category name *<input name="name" defaultValue={categoryDefaults.name} required placeholder="South Indian" /></label><label>Slug *<input name="slug" defaultValue={categoryDefaults.slug} required placeholder="south-indian" /></label><label className="full-field">Description<textarea name="description" defaultValue={categoryDefaults.description ?? ""} /></label><label className="full-field">Image URL<input name="imageUrl" defaultValue={categoryDefaults.imageUrl ?? ""} placeholder="https://..." /></label><label>Sort order<input name="sortOrder" type="number" min="0" defaultValue={categoryDefaults.sortOrder} /></label></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setCategoryModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving..." : categoryModal === "new" ? "Save category" : "Update category"}</button></div>
    </form></div>}
  </section>;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState("Dashboard");

  return <div className="app-shell dashboard-background">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark small">KB</span><span>Kumari Bites</span></div>
      <nav>{menuItems.map(item => <button key={item.label} className={active === item.label ? "nav-item active" : "nav-item"} onClick={() => setActive(item.label)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <button className="nav-item logout" onClick={async () => { await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }); onLogout(); }}><span>↪</span> Sign out</button>
    </aside>
    <main className="dashboard">
      <header className="topbar"><div><p className="eyebrow">KUMARI BITES ADMIN</p><h2>{active === "Menu" ? "Menu Management" : active}</h2></div><div className="admin-chip"><span className="avatar">A</span><span>Admin</span></div></header>
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
