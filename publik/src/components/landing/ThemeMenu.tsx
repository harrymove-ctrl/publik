import { useState, useRef, useEffect, useCallback, useId } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import type { ThemeChoice } from "@/domain/types";

interface ThemeMenuProps {
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  className?: string;
}

const THEME_OPTIONS: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function ThemeMenu({ theme, onTheme, className = "" }: ThemeMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const currentOption = THEME_OPTIONS.find((opt) => opt.id === theme) ?? THEME_OPTIONS[2];
  const CurrentIcon = currentOption.icon;

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open, closeMenu]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
      return;
    }

    if (e.key === "Tab") {
      closeMenu();
      return;
    }

    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items || items.length === 0) return;

    const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      items[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const handleSelect = (choice: ThemeChoice) => {
    onTheme(choice);
    closeMenu();
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        id={`${menuId}-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Select theme, current theme is ${currentOption.label}`}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-card)] px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-[var(--glass-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <CurrentIcon size={14} className="opacity-80" />
        <span className="hidden sm:inline capitalize">{currentOption.label}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={`${menuId}-trigger`}
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[130px] rounded-xl border border-[var(--glass-border)] bg-[var(--popover)] p-1 shadow-lg backdrop-blur-md transition-all focus:outline-none"
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => handleSelect(option.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-brand/10 text-brand"
                    : "text-foreground hover:bg-[var(--glass-card-hover)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={14} className={isSelected ? "text-brand" : "opacity-70"} />
                  <span className="capitalize">{option.label}</span>
                </div>
                {isSelected && <Check size={13} className="text-brand shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
