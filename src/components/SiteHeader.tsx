import { Link } from "@tanstack/react-router";
import { Menu, Moon, Sun, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useChapterTheme } from "./ChapterThemeProvider";
import { articles } from "@/data/content";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "./ui/sheet";

const links = [
  { to: "/chapter", label: "About" },
  { to: "/events", label: "Events" },
  { to: "/history", label: "History" },
  { to: "/articles", label: "Journal" },
] as const;
const visibleLinks = links.filter((link) => link.to !== "/articles" || articles.length > 0);
export function SiteHeader() {
  const { theme, toggle } = useChapterTheme();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <header className={`chapter-header public-header${scrolled ? " is-scrolled" : ""}`}>
      <Link to="/" className="chapter-brand" aria-label="Naga City Chapter No. 120, home">
        <img src="/images/chapter-seal.webp" width="640" height="640" alt="" />
        <span>
          Naga City Chapter No. 120<strong>International Order of DeMolay</strong>
        </span>
      </Link>
      <nav aria-label="Main navigation" className="chapter-desktop-nav">
        {visibleLinks.map((link) => (
          <Link key={link.to} to={link.to} activeProps={{ "aria-current": "page" }}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="chapter-header-controls">
        <noscript>
          <style>
            {
              ".public-header .chapter-menu-trigger,.public-header .chapter-theme-toggle{display:none}"
            }
          </style>
          <details className="chapter-nojs-menu">
            <summary>Menu</summary>
            <nav aria-label="Mobile navigation">
              {visibleLinks.map(({ to, label }) => (
                <a key={to} href={to}>
                  {label}
                </a>
              ))}
              <a href="/contact">Explore membership</a>
            </nav>
          </details>
        </noscript>
        <Button
          className="chapter-theme-toggle"
          variant="ghost"
          size="icon"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          disabled={theme === null}
          onClick={toggle}
        >
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
        <Link to="/contact" className="chapter-header-join">
          Explore membership <ArrowUpRight aria-hidden="true" />
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="chapter-menu-trigger"
              aria-label="Open navigation menu"
            >
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent className="chapter-mobile-menu">
            <SheetHeader>
              <SheetTitle>Explore the chapter</SheetTitle>
              <SheetDescription className="chapter-menu-description">
                Naga City Chapter No. 120 · Order of DeMolay
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile navigation">
              <SheetClose asChild>
                <Link to="/contact">Explore membership</Link>
              </SheetClose>
              {visibleLinks.map((link) => (
                <SheetClose key={link.to} asChild>
                  <Link to={link.to}>{link.label}</Link>
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
