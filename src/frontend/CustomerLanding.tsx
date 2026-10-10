import { useEffect, useMemo, useState } from "react";

type Category = { id: number; name: string; slug: string; description: string | null; imageUrl: string | null };
type MenuItem = { id: number; categoryId: number; name: string; description: string | null; imageUrl: string | null; isVeg: boolean; price: string | number | null };
const money = (value: string | number | null) => "₹" + Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function CustomerLanding() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chefVisible, setChefVisible] = useState(false);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setChefVisible(true), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/menu").then(async response => {
      if (!response.ok) throw new Error("We couldn't load the menu just now.");
      return response.json();
    }).then((data: { categories?: Category[]; items?: MenuItem[] }) => {
      if (cancelled) return;
      setCategories(data.categories ?? []);
      setItems(data.items ?? []);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the menu.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleItems = useMemo(() => items.filter(item => selectedCategory === null || item.categoryId === selectedCategory), [items, selectedCategory]);
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = items.reduce((sum, item) => sum + Number(item.price ?? 0) * (cart[item.id] ?? 0), 0);
  const addToCart = (id: number) => setCart(current => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  const changeQuantity = (id: number, delta: number) => setCart(current => {
    const next = { ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) };
    if (!next[id]) delete next[id];
    return next;
  });

  return <main className="customer-landing">
    <section className="customer-hero" id="top" aria-label="Welcome to Kumari Bites">
      <div className="customer-hero-shade" />
      <header className="customer-nav">
        <a className="customer-brand" href="#top"><span className="customer-brand-mark">KB</span><span>Kumari <em>Bites</em></span></a>
        <a className="customer-nav-cta" href="#menu">Explore menu <span>↘</span></a>
      </header>
      <div className="customer-hero-copy">
        <p className="customer-kicker"><span /> FRESHLY MADE · FULL OF FLAVOUR</p>
        <h1>Good food.<br /><em>Good mood.</em></h1>
        <p className="customer-hero-subtitle">Your next favourite bite is just a scroll away.</p>
        <a className="customer-primary-cta" href="#categories">Discover the menu <span>↓</span></a>
      </div>
      <div className={"customer-chef-intro " + (chefVisible ? "is-visible" : "")} aria-live="polite">
        <div className="customer-chef-avatar" aria-hidden="true">♨</div>
        <div className="customer-chef-bubble"><strong>Hey, food lover!</strong><span>Welcome to Kumari Bites. Scroll down and let’s find your next favourite.</span></div>
      </div>
      <a className="customer-scroll-cue" href="#categories"><span className="scroll-cue-line" /> SCROLL TO EXPLORE</a>
      <div className="customer-hero-orbit orbit-one" /><div className="customer-hero-orbit orbit-two" />
    </section>

    <section className="customer-menu-section" id="menu">
      <div className="customer-section-heading">
        <p className="customer-kicker"><span /> MADE TO MAKE YOU SMILE</p>
        <h2>What are you <em>craving?</em></h2>
        <p>Pick a category, find your favourite, and let the good bites begin.</p>
      </div>
      <div className="customer-category-area" id="categories">
        <div className="customer-category-heading"><h3>Explore by category</h3><span>Choose your mood</span></div>
        {loading ? <div className="customer-loading">Preparing something delicious…</div> : error ? <div className="customer-error">{error}<button onClick={() => window.location.reload()}>Try again</button></div> : categories.length ? <>
          <div className="customer-category-bubbles">
            <button className={"customer-category-bubble all-bubble " + (selectedCategory === null ? "selected" : "")} onClick={() => setSelectedCategory(null)}><span className="category-bubble-art">✦</span><strong>All bites</strong><small>{items.length} items</small></button>
            {categories.map((category, index) => <button key={category.id} className={"customer-category-bubble category-tone-" + (index % 5) + (selectedCategory === category.id ? " selected" : "")} onClick={() => setSelectedCategory(category.id)}>
              {category.imageUrl ? <img src={category.imageUrl} alt="" /> : <span className="category-bubble-art">{["🥟", "🌯", "🍔", "🍟", "🍗"][index % 5]}</span>}
              <strong>{category.name}</strong><small>{items.filter(item => item.categoryId === category.id).length} items</small>
            </button>)}
          </div>
          <div className="customer-items-heading"><div><p className="customer-kicker">THE GOOD STUFF</p><h3>{selectedCategory === null ? "Crowd favourites" : categories.find(category => category.id === selectedCategory)?.name}</h3></div><span>{visibleItems.length} delicious choices</span></div>
          {visibleItems.length ? <div className="customer-food-grid">{visibleItems.map((item, index) => <article className={"customer-food-card food-card-" + (index % 4)} key={item.id}>
            <div className="customer-food-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : <span>{["🥟", "🌯", "🍔", "🍗"][index % 4]}</span>}<span className={"customer-veg-mark " + (item.isVeg ? "veg" : "nonveg")} title={item.isVeg ? "Vegetarian" : "Non-vegetarian"} /></div>
            <div className="customer-food-info"><div><h4>{item.name}</h4><strong>{money(item.price)}</strong></div>{item.description && <p>{item.description}</p>}<button onClick={() => addToCart(item.id)}>{cart[item.id] ? <><span>−</span> {cart[item.id]} <span>+</span></> : <><span>+</span> Add to cart</>}</button>{cart[item.id] ? <div className="customer-quantity-controls"><button aria-label={"Remove one " + item.name} onClick={() => changeQuantity(item.id, -1)}>−</button><span>{cart[item.id]} in your cart</span><button aria-label={"Add one " + item.name} onClick={() => addToCart(item.id)}>+</button></div> : null}</div>
          </article>)}</div> : <div className="customer-empty">No available items in this category just yet. Try another delicious corner.</div>}
        </> : <div className="customer-empty">Our menu is getting ready. Please check back soon.</div>}
      </div>
    </section>
    <footer className="customer-footer"><a className="customer-brand" href="#top"><span className="customer-brand-mark">KB</span><span>Kumari <em>Bites</em></span></a><span>Made with flavour and a little extra love.</span><a href="#top">Back to top ↑</a></footer>
    {cartCount > 0 && <button className="customer-cart-fab" onClick={() => setCartOpen(value => !value)}><span>🛍</span><span>View your bites · {cartCount}</span><strong>{money(cartTotal)}</strong></button>}
    {cartOpen && <aside className="customer-cart-panel" aria-label="Your cart"><div className="customer-cart-title"><div><small>YOUR ORDER</small><h3>Your bites</h3></div><button onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
      {items.filter(item => cart[item.id]).map(item => <div className="customer-cart-line" key={item.id}><div><strong>{item.name}</strong><small>{money(item.price)} each</small></div><div className="customer-quantity-controls"><button onClick={() => changeQuantity(item.id, -1)}>−</button><span>{cart[item.id]}</span><button onClick={() => addToCart(item.id)}>+</button></div><strong>{money(Number(item.price ?? 0) * cart[item.id])}</strong></div>)}
      <div className="customer-cart-total"><span>Subtotal</span><strong>{money(cartTotal)}</strong></div>
      <p className="customer-cart-note">This is the landing-page foundation. Checkout will be connected to the customer order API in the next step.</p>
    </aside>}
  </main>;
}
