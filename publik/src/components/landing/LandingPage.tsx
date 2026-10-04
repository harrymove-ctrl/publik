import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Info,
  Menu,
  Pause,
  Play,
  X,
} from "lucide-react";
import { AgentAvatar } from "@/components/avatar/AgentAvatar";
import { FeltMark } from "@/components/avatar/FeltMark";
import { SombraGradient } from "@/components/gradient/SombraGradient";
import { ThemeMenu } from "./ThemeMenu";
import { useStore } from "@/state/store";

const GITHUB_URL = "https://github.com/harrymove-ctrl/publik";

export function LandingPage() {
  const { state, setTheme, setWorkspaceMode } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [controlPaused, setControlPaused] = useState(false);
  const [controlRevoked, setControlRevoked] = useState(false);

  // Follow system theme changes live when in system mode
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const isDark =
    state.theme === "dark" || (state.theme === "system" && systemDark);


  return (
    <div
      className={`publik-canvas relative min-h-dvh text-foreground overflow-x-clip ${
        isDark ? "dark-canvas" : ""
      }`}
    >
      {/* Background Atmosphere */}
      <div
        aria-hidden="true"
        className="publik-atmosphere pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <SombraGradient palette={isDark ? "ember" : "ocean"} />
      </div>

      {/* Skip to Content for Keyboard Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand"
      >
        Skip to content
      </a>

      {/* Sticky Header */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--glass-divider)] bg-background/80 backdrop-blur-md transition-colors">
        <div className="mx-auto flex h-16 sm:h-[68px] max-w-[1280px] items-center justify-between px-5 sm:px-8">
          {/* Brand Left */}
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2.5 font-semibold tracking-tight text-foreground text-base sm:text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-lg"
            >
              <FeltMark size={28} />
              <span>Publik</span>
            </Link>

            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-brand">
              <span className="size-1.5 rounded-full bg-brand" />
              Solana Devnet
            </span>
          </div>

          {/* Desktop Nav Links */}
          <nav
            aria-label="Main"
            className="hidden md:flex items-center gap-6 text-sm text-muted-foreground"
          >
            <a
              href="#product"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1"
            >
              Product
            </a>
            <a
              href="#how-it-works"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1"
            >
              How it works
            </a>
            <a
              href="#controls"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1"
            >
              Spending rules
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md px-1"
            >
              GitHub
            </a>
          </nav>

          {/* Controls Right */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <ThemeMenu theme={state.theme} onTheme={setTheme} />

            <Link
              to="/app"
              onClick={() => setWorkspaceMode("devnet")}
              className="inline-flex h-9 sm:h-10 items-center justify-center rounded-lg px-3.5 sm:px-4 text-xs sm:text-sm font-medium transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:bg-[#f2f1ee] dark:text-[#18181b] dark:hover:bg-white bg-[#082b5c] text-[#fffdf8] hover:bg-[#0c3f86]"
            >
              Open workspace
            </Link>

            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              className="md:hidden inline-flex size-9 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-card)] text-foreground hover:bg-[var(--glass-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[var(--glass-divider)] bg-background/95 backdrop-blur-xl px-5 py-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
            <nav aria-label="Mobile Navigation" className="flex flex-col space-y-2 text-sm">
              <a
                href="#product"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 text-muted-foreground hover:text-foreground"
              >
                Product preview
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 text-muted-foreground hover:text-foreground"
              >
                How it works
              </a>
              <a
                href="#controls"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 text-muted-foreground hover:text-foreground"
              >
                Spending rules & safety
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="py-1 text-muted-foreground hover:text-foreground"
              >
                GitHub
              </a>
            </nav>
            <div className="pt-2 border-t border-[var(--glass-divider)] flex items-center justify-between text-xs text-muted-foreground">
              <span>Environment</span>
              <span className="font-mono text-brand font-medium">Solana Devnet</span>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main id="main-content" tabIndex={-1} className="outline-none">
        {/* Hero Section */}
        <section
          aria-labelledby="hero-heading"
          className="relative px-5 sm:px-8 pt-12 sm:pt-16 lg:pt-20 pb-16 sm:pb-20 lg:pb-24"
        >
          <div className="mx-auto max-w-[1280px]">
            <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
              {/* Left Column: Text & CTAs */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                  AGENT SPENDING, UNDER YOUR CONTROL
                </p>
                <h1
                  id="hero-heading"
                  className="mt-4 text-3xl sm:text-4xl lg:text-[54px] font-medium tracking-tight text-foreground leading-[1.08]"
                >
                  Give your agents room to work. Keep spending under control.
                </h1>
                <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-[52ch]">
                  Connect your agents, set spending rules, and track payment requests in one workspace.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
                  <Link
                    to="/app"
                    onClick={() => setWorkspaceMode("devnet")}
                    className="inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:bg-[#f2f1ee] dark:text-[#18181b] dark:hover:bg-white bg-[#082b5c] text-[#fffdf8] hover:bg-[#0c3f86]"
                  >
                    Open workspace
                    <ArrowRight size={16} className="ml-2" />
                  </Link>
                  <a
                    href="#how-it-works"
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] px-5 text-sm font-medium text-foreground transition-colors hover:bg-[var(--glass-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    See how it works
                  </a>
                </div>

                <p className="mt-5 text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-brand/70" />
                  Solana devnet · Test tokens have no monetary value.
                </p>
              </div>

              {/* Right Column: Artwork Frame */}
              <div className="relative mx-auto w-full max-w-[560px]">
                <div className="relative overflow-hidden rounded-[24px] sm:rounded-[28px] border border-[var(--glass-border)] bg-[var(--glass-card)] shadow-[0_24px_48px_-20px_rgba(0,0,0,0.25)]">
                  <img
                    src="/art/publik-laurel.webp"
                    alt="White plush laurel on blue felt background"
                    width={1440}
                    height={810}
                    className="block h-auto w-full aspect-[16/9] object-cover"
                  />
                  {/* Subtle bot avatar status badge */}
                  <div className="absolute bottom-3 left-3 flex items-center gap-2.5 rounded-xl border border-[var(--glass-border)] bg-background/85 px-3 py-1.5 backdrop-blur-md shadow-sm">
                    <AgentAvatar id="alice" name="Alice" size={24} />
                    <div className="text-left leading-tight">
                      <p className="text-xs font-medium text-foreground">Alice</p>
                      <p className="text-[10px] text-muted-foreground">Example agent</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Product Preview Section */}
        <section
          id="product"
          aria-labelledby="product-heading"
          className="scroll-mt-24 px-5 sm:px-8 py-16 sm:py-20 lg:py-24 border-t border-[var(--glass-divider)]"
        >
          <div className="mx-auto max-w-[1280px]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                WORKSPACE PREVIEW
              </p>
              <h2
                id="product-heading"
                className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-medium tracking-tight text-foreground"
              >
                Every agent. Every request. One place.
              </h2>
              <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
                Inspect what your agents want to spend before it happens. Every request includes full context, recipient details, and policy status.
              </p>
            </div>

            {/* Illustrative example badge */}
            <div className="mt-8 mb-4 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              <Info size={13} />
              <span>Illustrative example · Test USDC on Solana devnet</span>
            </div>

            {/* Composed Preview Container */}
            <div className="rounded-2xl sm:rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-shell)] p-4 sm:p-6 lg:p-8 backdrop-blur-md shadow-lg">
              <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
                {/* Agent List Column */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-divider)]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Connected Agents
                    </span>
                    <span className="text-xs text-muted-foreground">3 paired</span>
                  </div>

                  {/* Alice (Selected) */}
                  <div className="rounded-xl border border-brand/40 bg-brand/5 p-3 text-left transition-colors">
                    <div className="flex items-center gap-3">
                      <AgentAvatar id="alice" name="Alice" size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium text-foreground truncate">Alice</p>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="size-1 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">Research agent</p>
                      </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-[var(--glass-divider)]">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Daily allowance</span>
                        <span className="font-mono font-medium text-foreground">
                          21.00 / 25.00 Test USDC
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-brand" style={{ width: "84%" }} />
                      </div>
                    </div>
                  </div>

                  {/* Operator */}
                  <div className="hidden sm:block rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3 text-left transition-colors">
                    <div className="flex items-center gap-3">
                      <AgentAvatar id="operator" name="Operator" size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium text-foreground truncate">Operator</p>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="size-1 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">Data Indexer</p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex justify-between text-xs text-muted-foreground">
                      <span>Daily allowance</span>
                      <span className="font-mono text-foreground">50.00 / 50.00 Test USDC</span>
                    </div>
                  </div>

                  {/* Sentinel */}
                  <div className="hidden sm:block rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3 text-left opacity-75">
                    <div className="flex items-center gap-3">
                      <AgentAvatar id="new-agent" name="Sentinel" size={36} status="paused" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium text-foreground truncate">Sentinel</p>
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            <span className="size-1 rounded-full bg-amber-500" />
                            Paused
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">Security Monitor</p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex justify-between text-xs text-muted-foreground">
                      <span>Daily allowance</span>
                      <span className="font-mono text-foreground">0.00 / 10.00 Test USDC</span>
                    </div>
                  </div>
                </div>

                {/* Selected Request Card */}
                <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-5 sm:p-6 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[var(--glass-divider)]">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                          Payment Request #req-891
                        </span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Submitted by Alice · 4 minutes ago
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        Ready for wallet signature
                      </span>
                    </div>

                    <div className="mt-5 grid sm:grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground">Requested Amount</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-3xl sm:text-4xl font-semibold tracking-tight font-mono text-foreground">
                            4.00
                          </span>
                          <span className="text-sm font-medium text-muted-foreground">
                            Test USDC
                          </span>
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Recipient</span>
                        <p className="mt-1 font-mono text-sm text-foreground font-medium truncate">
                          DataV...89q2
                        </p>
                        <p className="text-xs text-muted-foreground truncate">Research Indexer Service</p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-[var(--glass-border)] bg-background/50 p-3">
                      <span className="text-xs text-muted-foreground">Agent Memo</span>
                      <p className="mt-0.5 text-sm text-foreground">
                        Index query batch for dataset processing (Dataset #441)
                      </p>
                    </div>

                    <div className="mt-5 space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Policy Verification
                      </span>
                      <div className="space-y-1.5 text-xs text-foreground">
                        <div className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 shrink-0" />
                          <span>Agent active & authenticated via pairing key</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 shrink-0" />
                          <span>
                            Recipient matches allowlist rule (
                            <code className="font-mono text-[11px]">DataV...89q2</code>)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 shrink-0" />
                          <span>
                            Within daily allowance: 25.00 before → 21.00 Test USDC remaining
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Interactive review details toggle */}
                    {reviewOpen && (
                      <div className="mt-4 rounded-xl border border-brand/20 bg-brand/5 p-4 text-xs space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between font-semibold text-foreground border-b border-brand/10 pb-2">
                          <span>Devnet Transaction Simulation</span>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            Cluster: devnet
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground pt-1">
                          <div>
                            Instruction Type:{" "}
                            <span className="text-foreground font-mono">SPL Token Transfer</span>
                          </div>
                          <div>
                            Estimated Fee:{" "}
                            <span className="text-foreground font-mono">&lt; 0.00001 SOL</span>
                          </div>
                          <div>
                            Signer Required: <span className="text-foreground">Owner Wallet</span>
                          </div>
                          <div>
                            On-chain Execution:{" "}
                            <span className="text-foreground">Not signed yet</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground pt-1 border-t border-brand/10">
                          Illustrative values only. This preview was not signed or broadcast on Solana.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-[var(--glass-divider)]">
                    <button
                      type="button"
                      onClick={() => setReviewOpen((prev) => !prev)}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-card)] px-3 text-xs font-medium text-foreground transition-colors hover:bg-[var(--glass-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {reviewOpen ? "Hide simulation details" : "Review example details"}
                    </button>
                    <Link
                      to="/app"
                      onClick={() => setWorkspaceMode("devnet")}
                      className="inline-flex h-9 items-center text-xs font-medium text-brand hover:underline"
                    >
                      Open workspace to test live requests →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="scroll-mt-24 px-5 sm:px-8 py-16 sm:py-20 lg:py-24 border-t border-[var(--glass-divider)]"
        >
          <div className="mx-auto max-w-[1280px]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                HOW IT WORKS
              </p>
              <h2
                id="how-it-works-heading"
                className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-medium tracking-tight text-foreground"
              >
                Three steps from agent connection to verified payment.
              </h2>
              <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
                Publik keeps humans in control. Agents propose payments within strict guardrails, and owner-signed payments require your wallet approval.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:gap-8 md:grid-cols-3">
              {/* Step 1 */}
              <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-6 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand/10 text-sm font-semibold font-mono text-brand">
                    01
                  </span>
                  <h3 className="mt-4 text-lg font-medium text-foreground">
                    Connect your agent
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    Give your agent the connection instructions and approve its pairing code.
                  </p>
                </div>
                <p className="mt-6 text-xs text-muted-foreground border-t border-[var(--glass-divider)] pt-3">
                  Disconnecting an agent revokes its API access immediately.
                </p>
              </div>

              {/* Step 2 */}
              <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-6 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand/10 text-sm font-semibold font-mono text-brand">
                    02
                  </span>
                  <h3 className="mt-4 text-lg font-medium text-foreground">
                    Set spending rules
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    Choose limits and permitted recipients for the supported payment mode.
                  </p>
                </div>
                <p className="mt-6 text-xs text-muted-foreground border-t border-[var(--glass-divider)] pt-3">
                  App-enforced rules validate amounts and addresses before submission.
                </p>
              </div>

              {/* Step 3 */}
              <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-6 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand/10 text-sm font-semibold font-mono text-brand">
                    03
                  </span>
                  <h3 className="mt-4 text-lg font-medium text-foreground">
                    Track every payment
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    Review requests and follow transaction status from submission to receipt.
                  </p>
                </div>
                <p className="mt-6 text-xs text-brand font-medium border-t border-[var(--glass-divider)] pt-3">
                  Owner-signed payments require your wallet approval.
                </p>
              </div>
            </div>

            {/* Architecture Clarification Callout */}
            <div className="mt-8 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-shell)] p-5 sm:p-6 backdrop-blur-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Default execution: Owner-signed devnet mode
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground max-w-2xl leading-relaxed">
                    Publik never holds your private keys or signs autonomously by default. When an agent requests funds, you inspect the exact transfer details and sign the transaction directly with your Solana wallet.
                  </p>
                </div>
                <Link
                  to="/app"
                  onClick={() => setWorkspaceMode("devnet")}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-card)] px-3 text-xs font-medium text-foreground transition-colors hover:bg-[var(--glass-card-hover)]"
                >
                  Try in workspace →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Spending Controls Section */}
        <section
          id="controls"
          aria-labelledby="controls-heading"
          className="scroll-mt-24 px-5 sm:px-8 py-16 sm:py-20 lg:py-24 border-t border-[var(--glass-divider)]"
        >
          <div className="mx-auto max-w-[1280px]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                SPENDING CONTROLS & SAFETY
              </p>
              <h2
                id="controls-heading"
                className="mt-3 text-2xl sm:text-3xl lg:text-4xl font-medium tracking-tight text-foreground"
              >
                Clear boundaries for every request.
              </h2>
              <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
                Publik enforces spending rules so agents can draft payments without having unrestricted access to your funds.
              </p>
            </div>

            <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-14 items-start">
              {/* Left Column: Explanations */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-foreground">Implemented controls</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Publik enforces these rules before any payment can be submitted for signature:
                  </p>
                </div>

                <div className="space-y-4 text-sm">
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-4">
                    <p className="font-medium text-foreground">1. Daily & per-payment limits</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Define maximum spend per transaction and per UTC day. Exceeding limits blocks payment creation.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-4">
                    <p className="font-medium text-foreground">2. Recipient allowlist</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Restrict transfers exclusively to known, permitted addresses. Payments to unauthorized recipients are rejected immediately.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-4">
                    <p className="font-medium text-foreground">3. Instant pause & revocation</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Freeze an agent’s spending privileges with one click. Disconnecting an agent revokes its API pairing token. Pausing in the app halts Publik request processing; it does not stop a key Publik does not hold.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-4">
                    <p className="font-medium text-foreground">4. Transaction history & audit log</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Every request records the originating agent, purpose, amount, and timestamp, plus the devnet transaction signature once you sign.
                    </p>
                  </div>
                </div>

                {/* Architecture Distinction Box */}
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-shell)] p-4 text-xs space-y-3">
                  <div className="font-medium text-foreground">Payment Execution Modes</div>
                  <div>
                    <span className="font-semibold text-foreground">
                      Owner-signed mode (Default):
                    </span>{" "}
                    <span className="text-muted-foreground">
                      Your wallet signs each payment. Publik enforces rules in-app prior to signature. Disconnecting an agent revokes API access only, not on-chain authority.
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">
                      Delegated payments (Opt-in devnet mode):
                    </span>{" "}
                    <span className="text-muted-foreground">
                      An experimental vault program is deployed on Solana devnet (
                      <code className="font-mono text-[11px] break-all">
                        4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx
                      </code>
                      ) and verified with live devnet transactions. It enforces per-payment, UTC-day, and lifetime limits, a recipient allowlist, pause, and revoke directly on-chain. This mode is devnet-only, unaudited, and opt-in.
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Interactive Example Control Panel */}
              <div className="rounded-2xl sm:rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-shell)] p-5 sm:p-6 backdrop-blur-md shadow-lg space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--glass-divider)]">
                  <div className="flex items-center gap-2.5">
                    <AgentAvatar id="alice" name="Alice" size={32} />
                    <div>
                      <p className="text-sm font-medium text-foreground">Alice · Rule Configuration</p>
                      <p className="text-[11px] text-muted-foreground">App-enforced policy</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand">
                    Illustrative example
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3">
                    <div>
                      <p className="font-medium text-foreground">Daily spending limit</p>
                      <p className="text-muted-foreground text-[11px]">Resets daily at 00:00 UTC</p>
                    </div>
                    <span className="font-mono font-semibold text-sm text-foreground">
                      25.00 Test USDC
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3">
                    <div>
                      <p className="font-medium text-foreground">Per-payment cap</p>
                      <p className="text-muted-foreground text-[11px]">Max amount per request</p>
                    </div>
                    <span className="font-mono font-semibold text-sm text-foreground">
                      5.00 Test USDC
                    </span>
                  </div>

                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground">Recipient allowlist</p>
                      <span className="text-[11px] text-muted-foreground">2 addresses approved</span>
                    </div>
                    <div className="space-y-1 font-mono text-[11px]">
                      <div className="flex items-center justify-between text-muted-foreground bg-background/50 px-2 py-1 rounded">
                        <span className="truncate">DataV...89q2</span>
                        <span className="text-[10px] text-emerald-500 font-sans">Allowed</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground bg-background/50 px-2 py-1 rounded">
                        <span className="truncate">Index...44ab</span>
                        <span className="text-[10px] text-emerald-500 font-sans">Allowed</span>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Agent Pause Toggle */}
                  <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3">
                    <div>
                      <p className="font-medium text-foreground">Agent spending status</p>
                      <p className="text-[11px] text-muted-foreground">
                        {controlPaused
                          ? "Spending paused in app"
                          : "Active and ready to draft payments"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setControlPaused((prev) => !prev)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                        controlPaused
                          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                      }`}
                    >
                      {controlPaused ? <Play size={12} /> : <Pause size={12} />}
                      {controlPaused ? "Resume agent" : "Pause agent"}
                    </button>
                  </div>

                  {/* Revoke API Access */}
                  <div className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] p-3">
                    <div>
                      <p className="font-medium text-foreground">API Connection</p>
                      <p className="text-[11px] text-muted-foreground">
                        Pairing code: <code className="font-mono">PBK-8821</code>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setControlRevoked((prev) => !prev)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                        controlRevoked
                          ? "bg-muted text-muted-foreground"
                          : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                      }`}
                    >
                      {controlRevoked ? "Access revoked" : "Revoke API access"}
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground pt-2 border-t border-[var(--glass-divider)]">
                  Interactive example panel. Changes above demonstrate app-enforced state.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section
          aria-labelledby="cta-heading"
          className="px-5 sm:px-8 py-20 lg:py-28 border-t border-[var(--glass-divider)] text-center"
        >
          <div className="mx-auto max-w-[1280px]">
            <h2
              id="cta-heading"
              className="text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-foreground"
            >
              Your agents, with boundaries you choose.
            </h2>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto">
              Start with Solana devnet.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <Link
                to="/app"
                onClick={() => setWorkspaceMode("devnet")}
                className="inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-medium transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:bg-[#f2f1ee] dark:text-[#18181b] dark:hover:bg-white bg-[#082b5c] text-[#fffdf8] hover:bg-[#0c3f86]"
              >
                Open workspace
                <ArrowRight size={16} className="ml-2" />
              </Link>
              <Link
                to="/demo"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card)] px-5 text-sm font-medium text-foreground transition-colors hover:bg-[var(--glass-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Explore demo mode
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Start with Solana devnet · Test tokens have no monetary value.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--glass-divider)] px-5 sm:px-8 py-12 text-sm text-muted-foreground">
        <div className="mx-auto max-w-[1280px] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-foreground font-medium">
              <FeltMark size={24} />
              <span>Publik</span>
            </div>
            <p className="mt-2 text-xs max-w-md leading-relaxed">
              Publik reviews payment requests and sends owner-approved transfers on Solana devnet. Test tokens have no monetary value. A SOL airdrop does not include the test token.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <Link to="/app" onClick={() => setWorkspaceMode("devnet")} className="hover:text-foreground transition-colors">
              Open workspace
            </Link>
            <Link to="/demo" className="hover:text-foreground transition-colors">
              Explore demo
            </Link>
            <a
              href="https://faucet.solana.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Devnet SOL faucet
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <span className="inline-flex items-center gap-1 text-[11px] rounded-full border border-border px-2 py-0.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Solana Devnet
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
