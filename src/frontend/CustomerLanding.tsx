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
  const [categoryIntroPlaying, setCategoryIntroPlaying] = useState(false);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [addingItemId, setAddingItemId] = useState<number | null>(null);

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
    setStage(1);
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
  const add = (id: number) => {
    setCart(c => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    setAddingItemId(id);
    window.setTimeout(() => setAddingItemId(current => current === id ? null : current), 650);
  };
  const change = (id: number, delta: number) => setCart(c => { const n = { ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }; if (!n[id]) delete n[id]; return n; });

  return <main className="customer-landing customer-story-page">
    <section className={"customer-story " + (categoryIntroPlaying ? "category-intro-playing" : "")} aria-label="Kumari Bites interactive menu story">
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
        <div className={"customer-story-bubble " + (stage === 0 && !categoryIntroPlaying ? "story-bubble-visible" : "")}>
          <img className="customer-story-cloud-image" src="/assets/welcome-cloud.png" alt="" aria-hidden="true" />
          <div className="customer-story-bubble-content">
            <strong>{stage === 0 ? "Vanakkam, food lover!" : "Choose your favourites!"}</strong>
            <p>{stage === 0 ? "Welcome to Kumari Bites! 🍽️ Ready to discover your next favourite?" : "Tap a category to explore our freshly made favourites."}</p>
            {stage === 0 && <button type="button" className="customer-story-link" onClick={openCategories}>Explore the menu <span aria-hidden="true">↗</span></button>}
          </div>
        </div>
        <div className={"customer-story-categories " + (stage === 1 ? "story-categories-visible" : "") + (selectedCategory !== null ? " menu-items-on-plate" : "")}>
          <div className="story-panel-heading">
            <small>{selectedCategory === null ? "STEP 01 · PICK YOUR MOOD" : "FRESH FROM OUR KITCHEN"}</small>
            <h2>{selectedCategory === null ? <>What are you <em>craving?</em></> : <>{categories.find(c => c.id === selectedCategory)?.name ?? "Your favourites"} <em>menu</em></>}</h2>
            <p>{selectedCategory === null ? "Choose a category to see what’s cooking." : "Pick your bites and watch them join your order."}</p>
          </div>
          {loading ? <div className="customer-story-loading">Getting the menu ready…</div> : error ? <div className="customer-story-loading">{error}</div> : selectedCategory === null ? <div className="customer-category-bubbles">
            {categories.map((c, i) => <button key={c.id} style={{ animationDelay: `${i * 90}ms` }} className={"customer-category-bubble category-tone-" + (i % 5)} onClick={() => openItems(c.id)}>
              {c.imageUrl ? <img src={c.imageUrl} alt="" /> : <span className="category-bubble-art">{["🥟", "🌯", "🍔", "🍟", "🍗"][i % 5]}</span>}<strong>{c.name}</strong>
            </button>)}
          </div> : <div className="customer-menu-bubbles">
            {visibleItems.map((item, i) => <article key={item.id} style={{ animationDelay: `${i * 90}ms` }} className={"customer-menu-bubble " + (addingItemId === item.id ? "adding-to-cart" : "")}>
              <div className="customer-menu-bubble-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : <span>{["🥟", "🌯", "🍔", "🍗", "🍜"][i % 5]}</span>}<span className={"customer-veg-mark " + (item.isVeg ? "veg" : "nonveg")} /></div>
              <strong className="customer-menu-bubble-name">{item.name}</strong>
              <span className="customer-menu-bubble-price">{money(item.price)}</span>
              <button type="button" className="customer-menu-bubble-add" onClick={() => add(item.id)}>{cart[item.id] ? `Added · ${cart[item.id]}` : "Pick me to add"} <span>+</span></button>
            </article>)}
            {!visibleItems.length && <div className="customer-story-loading">No items in this category yet.</div>}
          </div>}
          <div className="customer-plate-links">
            {selectedCategory !== null && <button type="button" className="customer-story-link" onClick={() => setSelectedCategory(null)}>← All categories</button>}
            <button type="button" className="story-scroll-hint customer-story-link" onClick={() => { setSelectedCategory(null); goToStage(0); }}>← Welcome</button>
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
    {cartCount > 0 && <button className="customer-cart-fab" onClick={() => setCartOpen(v => !v)}><span>🛍</span><span>Your bites · {cartCount}</span><strong>{money(total)}</strong></button>}
    {cartOpen && <aside className="customer-cart-panel" aria-label="Your cart"><div className="customer-cart-title"><div><small>YOUR ORDER</small><h3>Your bites</h3></div><button onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
      {items.filter(i => cart[i.id]).map(i => <div className="customer-cart-line" key={i.id}><div><strong>{i.name}</strong><small>{money(i.price)} each</small></div><div className="customer-quantity-controls"><button onClick={() => change(i.id, -1)}>−</button><span>{cart[i.id]}</span><button onClick={() => add(i.id)}>+</button></div><button className="customer-cart-remove" onClick={() => setCart(c => { const n = { ...c }; delete n[i.id]; return n; })}>Remove</button><strong>{money(Number(i.price ?? 0) * cart[i.id])}</strong></div>)}
      <div className="customer-cart-total"><span>Subtotal</span><strong>{money(total)}</strong></div><p className="customer-cart-note">Cart preview only — checkout integration comes next.</p>
    </aside>}
  </main>;
}
