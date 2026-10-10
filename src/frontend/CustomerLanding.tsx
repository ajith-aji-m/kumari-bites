import { useEffect, useMemo, useState } from "react";

type Category = { id: number; name: string; slug: string; description: string | null; imageUrl: string | null };
type MenuItem = { id: number; categoryId: number; name: string; description: string | null; imageUrl: string | null; isVeg: boolean; price: string | number | null };
const money = (v: string | number | null) => "₹" + Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function CustomerLanding() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(0);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);

  // The landing experience is click-driven; native page scrolling no longer changes stages.
  const openCategories = () => setStage(1);
  const openItems = (categoryId?: number) => {
    if (typeof categoryId === "number") setSelectedCategory(categoryId);
    setStage(2);
  };
  const goToStage = (target: number) => setStage(Math.max(0, Math.min(2, target)));

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

  const visibleItems = useMemo(() => items.filter(i => selectedCategory === null || i.categoryId === selectedCategory), [items, selectedCategory]);
  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  const total = items.reduce((s, i) => s + Number(i.price ?? 0) * (cart[i.id] ?? 0), 0);
  const goToStage = (target: number) => {
    const root = document.querySelector<HTMLElement>(".customer-story");
    if (!root) return;
    const distance = Math.max(1, root.offsetHeight - window.innerHeight);
    window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().top + distance * target / 3, behavior: "smooth" });
  };
  const add = (id: number) => setCart(c => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const change = (id: number, delta: number) => setCart(c => { const n = { ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }; if (!n[id]) delete n[id]; return n; });

  return <main className="customer-landing customer-story-page">
    <section className="customer-story" aria-label="Kumari Bites interactive menu story">
      <div className="customer-story-stage">
        <div className="customer-hero-shade" />
        <header className="customer-nav">
          <a className="customer-brand" href="#customer-order"><span className="customer-brand-mark">KB</span><span>Kumari <em>Bites</em></span></a>
          <span className="customer-live-tag"><i /> FRESHLY MADE · FULL OF FLAVOUR</span>
        </header>
        <div className={"customer-hero-copy story-copy " + (stage === 0 ? "story-copy-visible" : "")}>
          <p className="customer-kicker"><span /> YOUR NEXT FAVOURITE BITE</p>
          <h1>Good food.<br /><em>Good mood.</em></h1>
          <p className="customer-hero-subtitle">A little scroll. A lot of flavour.</p>
          <span className="customer-primary-cta">Let’s find your flavour <span>↓</span></span>
        </div>
        <div className="customer-order-taker order-taker-visible"><img src="/assets/order-taker.png" alt="Your Kumari Bites order taker" /></div>
        <div className={"customer-story-bubble " + (stage === 0 ? "story-bubble-visible" : "")}>
          <img className="customer-story-cloud-image" src="/assets/welcome-cloud.png" alt="" aria-hidden="true" />
          <div className="customer-story-bubble-content">
            <strong>{stage === 0 ? "Vanakkam, food lover!" : "Choose your favourites!"}</strong>
            <p>{stage === 0 ? "Welcome to Kumari Bites! 🍽️ What’s your feast today? Explore our menu and pick your favourites." : "Tap a category to explore our freshly made favourites."}</p>
            {stage === 0 && <button type="button" className="customer-story-link" onClick={openCategories}>Click here to explore categories <span aria-hidden="true">→</span></button>}
          </div>
        </div>
        <div className={"customer-story-categories " + (stage === 1 ? "story-categories-visible" : "")}>
          <div className="story-panel-heading"><small>STEP 01 · PICK YOUR MOOD</small><h2>What are you <em>craving?</em></h2><p>Tap a category to help me find your favourites.</p></div>
          {loading ? <div className="customer-story-loading">Getting the menu ready…</div> : error ? <div className="customer-story-loading">{error}</div> : <div className="customer-category-bubbles">
            {categories.map((c, i) => <button key={c.id} className={"customer-category-bubble category-tone-" + (i % 5) + (selectedCategory === c.id ? " selected" : "")} onClick={() => openItems(c.id)}>
              {c.imageUrl ? <img src={c.imageUrl} alt="" /> : <span className="category-bubble-art">{["🥟", "🌯", "🍔", "🍟", "🍗"][i % 5]}</span>}<strong>{c.name}</strong><small>{items.filter(item => item.categoryId === c.id).length} bites</small>
            </button>)}
          </div>}
          <button type="button" className="story-scroll-hint customer-story-link" onClick={() => goToStage(0)}>← Back to welcome</button>
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
    {cartCount > 0 && <button className="customer-cart-fab" onClick={() => setCartOpen(v => !v)}><span>🛍</span><span>Your bites · {cartCount}</span><strong>{money(total)}</strong></button>}
    {cartOpen && <aside className="customer-cart-panel" aria-label="Your cart"><div className="customer-cart-title"><div><small>YOUR ORDER</small><h3>Your bites</h3></div><button onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
      {items.filter(i => cart[i.id]).map(i => <div className="customer-cart-line" key={i.id}><div><strong>{i.name}</strong><small>{money(i.price)} each</small></div><div className="customer-quantity-controls"><button onClick={() => change(i.id, -1)}>−</button><span>{cart[i.id]}</span><button onClick={() => add(i.id)}>+</button></div><strong>{money(Number(i.price ?? 0) * cart[i.id])}</strong></div>)}
      <div className="customer-cart-total"><span>Subtotal</span><strong>{money(total)}</strong></div><p className="customer-cart-note">Cart preview only — checkout integration comes next.</p>
    </aside>}
  </main>;
}
