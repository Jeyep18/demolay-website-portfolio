import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Mail } from "lucide-react";
import { articles, chapterContact } from "@/data/content";

export function SiteFooter() {
  return (
    <footer className="chapter-footer">
      <div className="chapter-footer-main">
        <div className="chapter-footer-identity">
          <Link to="/" className="chapter-brand">
            <img src="/images/chapter-seal.webp" alt="" width="640" height="640" loading="lazy" />
            <span>
              Naga City Chapter<strong>No. 120 · Order of DeMolay</strong>
            </span>
          </Link>
          <p>Brotherhood. Leadership. Service. · Naga City, Philippines.</p>
        </div>
        <div className="chapter-footer-details">
          <nav className="public-footer-nav" aria-label="Footer navigation">
            <Link to="/chapter">About</Link>
            <Link to="/events">Events</Link>
            <Link to="/history">History</Link>
            {articles.length > 0 && <Link to="/articles">Journal</Link>}
            <Link to="/contact">Explore membership</Link>
          </nav>
          <nav className="chapter-contact-links" aria-label="Contact the chapter">
            <a href={chapterContact.facebook} target="_blank" rel="noopener noreferrer">
              <ArrowUpRight aria-hidden="true" />
              Facebook<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a href={`mailto:${chapterContact.email}`}>
              <Mail aria-hidden="true" />
              <span>{chapterContact.email}</span>
            </a>
          </nav>
        </div>
      </div>
      <div className="chapter-footer-bottom">
        <p>Sponsored by Naga City Masonic Lodge No. 257, F&amp;AM</p>
        <nav className="public-footer-nav" aria-label="Website policies">
          <Link to="/privacy">Privacy Notice</Link>
          <Link to="/cookies">Cookies &amp; Browser Storage</Link>
          <Link to="/terms">Terms of Use</Link>
        </nav>
      </div>
    </footer>
  );
}
