import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Shared dropdown used across the admin (orders, menu management, settings).
export function CustomSelect({ value, onChange, options, placeholder = "Select...", portalMenu = false, statusTone = false }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string; portalMenu?: boolean; statusTone?: boolean }) {
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
      const width = rect.width;
      const menuHeight = Math.min(options.length * 34 + 14, 260);
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
    className={`custom-select-menu${portalMenu ? " custom-select-menu-portal" : ""}${statusTone ? " order-status-menu" : ""}`}
    style={portalMenu ? { position: "fixed", top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: 220, overflowY: "auto", overscrollBehavior: "contain", zIndex: 10000 } : undefined}
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
