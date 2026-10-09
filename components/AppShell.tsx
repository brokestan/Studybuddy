"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brain, Check, Copy, Layers, ListChecks, LogOut, MessageCircle, Moon, Sun, Users } from "lucide-react";
import { Logo } from "./Logo";
import { Onboarding } from "./Onboarding";
import { useProfile } from "./ProfileProvider";

// Status is intentionally NOT in this list — it's a setup/diagnostic page
// for whoever is running the app, not something regular students should see
// as a tab. It's still reachable directly at /status if you want to check it
// yourself; PUBLIC below is what lets that URL work without onboarding first.
const NAV = [
  { href: "/", label: "Tutor", icon: MessageCircle },
  { href: "/quiz", label: "Quiz", icon: ListChecks },
  { href: "/cards", label: "Flashcards", icon: Layers },
  { href: "/room", label: "Study Room", icon: Users },
  { href: "/memory", label: "Memory", icon: Brain },
];
const PUBLIC = new Set(["/status"]);

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.dataset.theme !== "light"), []);
  return (
    <button
      className="icon-btn"
      aria-label="Toggle theme"
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem("sb-theme", next); } catch { /* ignore */ }
        setDark(!dark);
      }}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { profile, ready, signOut } = useProfile();
  const [copied, setCopied] = useState(false);

  if (!ready) return <div className="boot"><Logo size={40} /></div>;
  if (!profile && !PUBLIC.has(path)) return <Onboarding />;

  return (
    <div className="app">
      <aside className="side">
        <Link href="/" className="brand-row"><Logo size={30} /><span className="brand-name">Study Buddy</span></Link>
        <nav className="nav">
          {NAV.map((n) => {
            const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`nav-item ${on ? "on" : ""}`}>
                <n.icon size={18} /> <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          {profile && (
            <div className="me">
              <div className="avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
              <div className="me-text">
                <strong>{profile.name}</strong>
                <button
                  className="keyline"
                  title="Copy memory key"
                  onClick={async () => { try { await navigator.clipboard.writeText(profile.code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* blocked */ } }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "copied" : `key ••••-${profile.code.slice(-4)}`}
                </button>
              </div>
              <button className="icon-btn" aria-label="Sign out on this device" title="Sign out on this device (your memory stays on Walrus)" onClick={signOut}><LogOut size={16} /></button>
            </div>
          )}
          <div className="row between"><span className="tiny">Memory on Walrus mainnet</span><ThemeToggle /></div>
        </div>
      </aside>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Primary">
        {NAV.map((n) => {
          const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`tab ${on ? "on" : ""}`}>
              <n.icon size={20} /><span>{n.label === "Study Room" ? "Room" : n.label === "Flashcards" ? "Cards" : n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
