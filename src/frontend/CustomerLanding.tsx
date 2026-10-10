import { useEffect, useMemo, useState } from "react";

type Category = { id: number; name: string; slug: string; description: string | null; imageUrl: string | null; isActive?: boolean; is_active?: boolean; active?: boolean; status?: string };
type MenuItem = { id: number; categoryId: number; name: string; description: string | null; imageUrl: string | null; isVeg: boolean; price: string | number | null; isActive?: boolean; is_active?: boolean; active?: boolean; status?: string };
const money = (v: string | number | null) => "₹" + Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const isMenuEntryActive = (entry: { isActive?: boolean | number | string; is_active?: boolean | number | string; active?: boolean | number | string; status?: string }) => { const flags = [entry.isActive, entry.is_active, entry.active].filter(v => v !== undefined && v !== null); const explicitlyOff = flags.some(v => v === false || v === 0 || ["false", "0", "inactive", "disabled", "draft", "archived"].includes(String(v).toLowerCase())); return !explicitlyOff && !["inactive", "disabled", "draft", "archived"].includes(String(entry.status ?? "").toLowerCase()); };

export function CustomerLanding() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [menuPage, setMenuPage] = useState(0);
  const [isWidePlate, setIsWidePlate] = useState(() => window.matchMedia("(min-width: 761px)").matches);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(0);
  const [categoryIntroPlaying, setCategoryIntroPlaying] = useState(false);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [placedOrder, setPlacedOrder] = useState<{ orderId: number; orderNumber: string; totalAmount?: string; trackingToken: string; status: string } | null>(() => {
    try {
      const saved = window.localStorage.getItem("kb-active-order");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [trackerMinimized, setTrackerMinimized] = useState(false);
  const [addingItemId, setAddingItemId] = useState<number | null>(null);
  const [flyingBite, setFlyingBite] = useState<{ id: number; imageUrl: string | null; x: number; y: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!placedOrder) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    const refreshStatus = async () => {
      try {
        const response = await fetch(`/api/v1/public/orders/${placedOrder.orderId}/status?token=${encodeURIComponent(placedOrder.trackingToken)}`);
        if (!response.ok) return;
        const data = await response.json() as { status?: string };
        if (!stopped && data.status) {
          setPlacedOrder(current => {
            if (!current || current.orderId !== placedOrder.orderId || current.status === data.status) return current;
            const next = { ...current, status: data.status! };
            window.localStorage.setItem("kb-active-order", JSON.stringify(next));
            return next;
          });
        }
      } catch { /* A temporary network failure is recovered on the next WebSocket reconnect. */ }
    };
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.onopen = () => { void refreshStatus(); };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: { orderId?: number; status?: string } };
          if (message.type === "order.status_changed" && message.payload?.orderId === placedOrder.orderId && message.payload.status) {
            setPlacedOrder(current => {
              if (!current || current.orderId !== placedOrder.orderId) return current;
              const next = { ...current, status: message.payload!.status! };
              window.localStorage.setItem("kb-active-order", JSON.stringify(next));
              return next;
            });
          }
        } catch { /* Ignore malformed WebSocket messages. */ }
      };
      socket.onclose = () => {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1800);
      };
      socket.onerror = () => socket?.close();
    };
    void refreshStatus();
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [placedOrder?.orderId, placedOrder?.trackingToken]);

  // The landing experience is click-driven; native page scrolling no longer changes stages.
  const openCategories = () => {
    if (categoryIntroPlaying || stage !== 0) return;
    setCategoryIntroPlaying(true);
    window.setTimeout(() => {
      setStage(1);
      window.setTimeout(() => setCategoryIntroPlaying(false), 900);
    }, 650);
  };
  const openItems = (categoryId?: number) => {
    if (typeof categoryId === "number") setSelectedCategory(categoryId);
    setMenuPage(0);
    setStage(1);
  };
  const goToStage = (target: number) => setStage(Math.max(0, Math.min(2, target)));
  const hasPendingOrder = !!placedOrder && placedOrder.status !== "completed" && placedOrder.status !== "cancelled";
  const startFreshOrder = () => {
    if (hasPendingOrder) {
      setStage(0);
      return;
    }
    window.localStorage.removeItem("kb-active-order");
    setPlacedOrder(null);
    setTrackerMinimized(false);
    setCart({});
    setCartOpen(false);
    setCustomerPhone("");
    setCheckoutError("");
    setSelectedCategory(null);
    setMenuPage(0);
    setCategoryIntroPlaying(false);
    setStage(0);
  };
  const handleWelcome = () => {
    if (placedOrder && !hasPendingOrder) {
      startFreshOrder();
      return;
    }
    setSelectedCategory(null);
    setMenuPage(0);
    setStage(0);
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/menu").then(async r => {
      if (!r.ok) throw new Error("We couldn't load the menu just now.");
      return r.json();
    }).then((data: { categories?: Category[]; items?: MenuItem[] }) => {
      if (cancelled) return;
      setCategories(data.categories ?? []);
      setItems(data.items ?? []);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the menu."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const activeCategories = useMemo(() => categories.filter(isMenuEntryActive).filter(category => items.some(item => isMenuEntryActive(item) && item.categoryId === category.id)), [categories, items]);
  const activeItems = useMemo(() => items.filter(isMenuEntryActive).filter(i => activeCategories.some(c => c.id === i.categoryId)), [items, activeCategories]);
  const categoryItems = useMemo(() => activeItems.filter(i => selectedCategory === null || i.categoryId === selectedCategory), [activeItems, selectedCategory]);
  const menuPageSize = isWidePlate ? 10 : 4;
  const menuPageCount = Math.max(1, Math.ceil(categoryItems.length / menuPageSize));
  const visibleItems = useMemo(() => categoryItems.slice(menuPage * menuPageSize, (menuPage + 1) * menuPageSize), [categoryItems, menuPage]);
  useEffect(() => { setMenuPage(0); }, [selectedCategory, menuPageSize]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 761px)");
    const sync = () => setIsWidePlate(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  const total = items.reduce((s, i) => s + Number(i.price ?? 0) * (cart[i.id] ?? 0), 0);
  const add = (id: number, event?: React.MouseEvent<HTMLButtonElement>) => {
    setCart(c => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    const item = items.find(entry => entry.id === id);
    const imageBox = event?.currentTarget.closest(".customer-menu-bubble-image") as HTMLElement | null;
    if (item && imageBox) {
      const rect = imageBox.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      window.setTimeout(() => {
        const packingBox = document.querySelector(".customer-packing-box") as HTMLElement | null;
        if (!packingBox) return;
        const target = packingBox.getBoundingClientRect();
        setFlyingBite({ id, imageUrl: item.imageUrl, x: startX, y: startY, dx: target.left + target.width * 0.55 - startX, dy: target.top + target.height * 0.58 - startY });
        window.setTimeout(() => setFlyingBite(current => current?.id === id ? null : current), 760);
      }, 0);
    }
  };
  const change = (id: number, delta: number) => setCart(c => { const n = { ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }; if (!n[id]) delete n[id]; return n; });
  const placeOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (placingOrder || !cartCount) return;
    setPlacingOrder(true);
    setCheckoutError("");
    try {
      const response = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerPhone: customerPhone.trim() || undefined,
          source: "qr",
          paymentMethod: "cash",
          items: Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([menuItemId, quantity]) => ({ menuItemId: Number(menuItemId), quantity }))
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "We couldn't place your order. Please try again.");
      const order = { orderId: Number(data.orderId), orderNumber: String(data.orderNumber), totalAmount: data.totalAmount, trackingToken: String(data.trackingToken), status: String(data.status ?? "placed") };
      setPlacedOrder(order);
      setTrackerMinimized(false);
      window.localStorage.setItem("kb-active-order", JSON.stringify(order));
      setCart({});
      setCartOpen(false);
      setStage(0);
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "We couldn't place your order. Please try again.");
    } finally {
      setPlacingOrder(false);
    }
  };

  return <main className="customer-landing customer-story-page">
    <section className={"customer-story " + (categoryIntroPlaying ? "category-intro-playing " : "") + (placedOrder ? "has-active-order" : "")} aria-label="Kumari Bites interactive menu story">
      <div className="customer-story-stage">
        <div className="customer-hero-shade" />
        <header className="customer-nav">
          <a className="customer-brand" href="#customer-order"><span className="customer-brand-mark">KB</span><span>Kumari <em>Bites</em></span></a>
        </header>
        <div className={"customer-hero-copy story-copy " + (stage === 0 ? "story-copy-visible" : "")}>
          <p className="customer-kicker"><span /> YOUR NEXT FAVOURITE BITE</p>
          <h1>Good food.<br /><em>Good mood.</em></h1>
          <p className="customer-hero-subtitle">A little scroll. A lot of flavour.</p>
          <span className="customer-primary-cta">Let’s find your flavour <span>↓</span></span>
        </div>
        <div className="customer-order-taker order-taker-visible"><img src="/assets/order-taker.png" alt="Your Kumari Bites order taker" /></div>
        {placedOrder && !trackerMinimized && <div className="customer-order-confirmation" role="status" aria-live="polite">
          <button type="button" className="customer-order-minimize" aria-label="Minimize order tracker" onClick={() => setTrackerMinimized(true)}>−</button>
          <span className="customer-order-confirmation-spark">✦</span>
          <small>ORDER RECEIVED · {placedOrder.orderNumber}</small>
          <h2>Thank you for your order!</h2>
          <p>Your order status will be tracked here. Updates appear automatically.</p>
          <div className={"customer-live-order-status status-" + placedOrder.status}><span className="customer-live-status-icon">{placedOrder.status === "completed" ? "✓" : placedOrder.status === "cancelled" ? "!" : "•"}</span><span><small>LIVE ORDER STATUS</small><strong>{({placed:"Order placed",preparing:"Preparing your order",ready:"Your order is ready",completed:"Order completed",cancelled:"Order cancelled"} as Record<string,string>)[placedOrder.status] ?? "Order placed"}</strong></span><span className="customer-live-status-pulse" /></div>
          <div className="customer-order-progress" aria-label="Order progress">{["placed","preparing","ready","completed"].map((status, index) => <span key={status} className={( ["placed","preparing","ready","completed"].indexOf(placedOrder.status) >= index ? "reached " : "") + (placedOrder.status === status ? "current" : "")} />)}</div>
          <button type="button" className="customer-order-again" onClick={() => { if (!hasPendingOrder) { startFreshOrder(); } else { setTrackerMinimized(true); setCart({}); setCartOpen(false); setCustomerPhone(""); setSelectedCategory(null); setMenuPage(0); setStage(1); } }}>{hasPendingOrder ? "Explore more" : "Start a fresh order"} <span aria-hidden="true">↗</span></button>
        </div>}
        {placedOrder && trackerMinimized && <button type="button" className="customer-order-tracker-mini" onClick={() => setTrackerMinimized(false)} aria-label={"Open tracking for " + placedOrder.orderNumber}>
          <span className="customer-tracker-mini-pulse" /><span><small>{placedOrder.orderNumber} · LIVE TRACKING</small><strong>{({placed:"Order placed",preparing:"Preparing your order",ready:"Your order is ready",completed:"Order completed",cancelled:"Order cancelled"} as Record<string,string>)[placedOrder.status] ?? "Order placed"}</strong></span><span className="customer-tracker-mini-open">↗</span>
        </button>}
        {!placedOrder && <div className={"customer-story-bubble " + (stage === 0 && !categoryIntroPlaying ? "story-bubble-visible" : "")}>
          <img className="customer-story-cloud-image" src="/assets/welcome-cloud.png" alt="" aria-hidden="true" />
          <div className="customer-story-bubble-content">
            <strong>{stage === 0 ? "Vanakkam, food lover!" : "Choose your favourites!"}</strong>
            <p>{stage === 0 ? "Welcome to Kumari Bites! 🍽️ Ready to discover your next favourite?" : "Tap a category to explore our freshly made favourites."}</p>
            {stage === 0 && <button type="button" className="customer-story-link" onClick={openCategories}>Explore the menu <span aria-hidden="true">↗</span></button>}
          </div>
        </div>}
        <div className={"customer-story-categories " + (stage === 1 ? "story-categories-visible" : "") + (selectedCategory !== null ? " menu-items-on-plate" : "")}>
          <div className="story-panel-heading">
            <small>{selectedCategory === null ? "STEP 01 · PICK YOUR MOOD" : "FRESH FROM OUR KITCHEN"}</small>
            <h2>{selectedCategory === null ? <>What are you <em>craving?</em></> : <>{activeCategories.find(c => c.id === selectedCategory)?.name ?? "Your favourites"} <em>menu</em></>}</h2>
            <p>{selectedCategory === null ? "Choose a category to see what’s cooking." : "Pick your bites and watch them join your order."}</p>
          </div>
          {loading ? <div className="customer-story-loading">Getting the menu ready…</div> : error ? <div className="customer-story-loading">{error}</div> : selectedCategory === null ? <div className="customer-category-bubbles">
            {activeCategories.map((c, i) => <button key={c.id} style={{ animationDelay: `${i * 90}ms` }} className={"customer-category-bubble category-tone-" + (i % 5)} onClick={() => openItems(c.id)}>
              {c.imageUrl ? <img src={c.imageUrl} alt="" /> : <span className="category-bubble-art">{["🥟", "🌯", "🍔", "🍟", "🍗"][i % 5]}</span>}<strong>{c.name}</strong>
            </button>)}
          </div> : <div className="customer-menu-bubbles">
            {visibleItems.map((item, i) => <article key={item.id} style={{ animationDelay: `${i * 90}ms` }} className="customer-menu-bubble">
              <div className="customer-menu-bubble-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : <span>{["🥟", "🌯", "🍔", "🍗", "🍜"][i % 5]}</span>}{cart[item.id] ? <span className="customer-menu-image-count">{cart[item.id]}</span> : null}<button type="button" aria-label={`Add ${item.name} to your bites`} className="customer-menu-image-add" onClick={(event) => add(item.id, event)}>+</button></div>
              <strong className="customer-menu-bubble-name">{item.name}</strong>
              <span className="customer-menu-bubble-price">{money(item.price)}</span>
            </article>)}
            {!categoryItems.length && <div className="customer-story-loading">No items in this category yet.</div>}
          </div>}
          {selectedCategory !== null && categoryItems.length > menuPageSize && <div className="customer-menu-pagination" aria-label="Menu navigation">
            {menuPage > 0 && <button type="button" className="menu-page-prev" aria-label="Previous menu items" onClick={() => setMenuPage(p => Math.max(0, p - 1))}></button>}
            {menuPage < menuPageCount - 1 && <button type="button" className="menu-page-next" aria-label="More menu items" onClick={() => setMenuPage(p => Math.min(menuPageCount - 1, p + 1))}></button>}
          </div>}
          <div className="customer-plate-links">
            {selectedCategory !== null && <button type="button" className="customer-story-link" onClick={() => { setSelectedCategory(null); setMenuPage(0); }}>← All categories</button>}
            <button type="button" className="story-scroll-hint customer-story-link" onClick={handleWelcome}>← Welcome</button>
          </div>
        </div>
        <div className={"customer-story-items " + (stage === 2 ? "story-items-visible" : "")}>
          <div className="story-items-topline"><button className="story-back-button" onClick={() => goToStage(1)}>← Categories</button><small>STEP 02 · MADE FOR YOU</small></div>
          <div className="story-items-title"><div><h2>{categories.find(c => c.id === selectedCategory)?.name ?? "All the good stuff"}</h2><p>Fresh picks, just a tap away.</p></div><span>{visibleItems.length} items</span></div>
          {visibleItems.length ? <div className="customer-food-grid">{visibleItems.map((item, i) => <article className={"customer-food-card food-card-" + (i % 4)} key={item.id}>
            <div className="customer-food-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : <span>{["🥟", "🌯", "🍔", "🍗"][i % 4]}</span>}<span className={"customer-veg-mark " + (item.isVeg ? "veg" : "nonveg")} /></div>
            <div className="customer-food-info"><div><h4>{item.name}</h4><strong>{money(item.price)}</strong></div>{item.description && <p>{item.description}</p>}<button onClick={() => add(item.id)}>{cart[item.id] ? "Added · " + cart[item.id] : "+ Add to order"}</button>{cart[item.id] ? <div className="customer-quantity-controls"><button onClick={() => change(item.id, -1)}>−</button><span>{cart[item.id]} in your order</span><button onClick={() => add(item.id)}>+</button></div> : null}</div>
          </article>)}</div> : <div className="customer-empty">{loading ? "Loading menu…" : error || "No items in this category yet. Go back and choose another category."}</div>}
          <button className="story-change-category" onClick={() => { setSelectedCategory(null); goToStage(1); }}>Explore another category</button>
        </div>
        <div className="customer-story-progress"><span className={stage >= 0 ? "active" : ""}/><span className={stage >= 1 ? "active" : ""}/><span className={stage >= 2 ? "active" : ""}/><span className={stage >= 3 ? "active" : ""}/></div>
        <div className="customer-story-bottom"><span className="story-bottom-line" /> SCROLL TO CONTINUE <span className="story-bottom-arrow">↓</span></div>
      </div>
    </section>
    {flyingBite && <div key={flyingBite.id + "-" + flyingBite.x} className="customer-flying-bite" style={{ left: flyingBite.x, top: flyingBite.y, ["--fly-dx" as string]: String(flyingBite.dx) + "px", ["--fly-dy" as string]: String(flyingBite.dy) + "px" } as React.CSSProperties} aria-hidden="true">{flyingBite.imageUrl ? <img src={flyingBite.imageUrl} alt="" /> : <span>🍽️</span>}</div>}
    {cartCount > 0 && <button type="button" className={"customer-packing-box has-bites" + (flyingBite ? " receiving-bite" : "")} onClick={() => setCartOpen(v => !v)} aria-label="Open your order packing area">
      <span className="packing-box-label"><span className="packing-box-icon">▱</span><span><small>YOUR ORDER</small><strong>Packing area</strong></span></span>
      <span className="packing-box-status">{cartCount ? String(cartCount) + (cartCount === 1 ? " bite" : " bites") : "Ready for your bites"}</span>
      <strong className="packing-box-total">{money(total)}</strong>
      <span className="packing-box-open">{cartOpen ? "−" : "+"}</span>
    </button>}
    {cartOpen && <aside className="customer-cart-panel" aria-label="Your cart"><div className="customer-cart-title"><div><small>YOUR ORDER</small><h3>Your bites</h3></div><button onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
      {items.filter(i => cart[i.id]).map(i => <div className="customer-cart-line" key={i.id}><div><strong>{i.name}</strong><small>{money(i.price)} each</small></div><div className="customer-quantity-controls"><button onClick={() => change(i.id, -1)}>−</button><span>{cart[i.id]}</span><button onClick={() => add(i.id)}>+</button></div><button className="customer-cart-remove" onClick={() => setCart(c => { const n = { ...c }; delete n[i.id]; return n; })}>Remove</button><strong>{money(Number(i.price ?? 0) * cart[i.id])}</strong></div>)}
      {placedOrder ? <div className="customer-order-success" role="status">
        <span className="customer-order-success-icon">✓</span>
        <small>ORDER PLACED</small>
        <h4>Hi there! 👋</h4>
        <p>Hi, this is Kumari Bites! Your order has been received. Please pay by cash when your order arrives.</p>
        <div className="customer-order-number"><span>Order number</span><strong>{placedOrder.orderNumber}</strong></div>
        <button type="button" onClick={() => { setPlacedOrder(null); setCartOpen(false); setCustomerPhone(""); }}>Continue exploring</button>
      </div> : <>
        <div className="customer-cart-total"><span>Subtotal</span><strong>{money(total)}</strong></div>
        <form className="customer-checkout-form" onSubmit={placeOrder}>
          <h4>Contact details</h4>
          <label>Phone number (optional)<input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} autoComplete="tel" minLength={7} maxLength={30} placeholder="For WhatsApp order PDF" /></label>
          <div className="customer-cod-option"><span className="customer-cod-radio">✓</span><span><strong>Cash on Delivery</strong><small>Pay when your order arrives</small></span><span className="customer-cod-tag">COD</span></div>
          {checkoutError && <p className="customer-checkout-error" role="alert">{checkoutError}</p>}
          <button className="customer-place-order" type="submit" disabled={placingOrder || cartCount === 0}>{placingOrder ? "Placing order…" : "Place Order · " + money(total)}</button>
          <p className="customer-checkout-footnote">No online payment required. You’ll pay in cash on delivery.</p>
        </form>
      </>}
    </aside>}
  </main>;
}
