import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { historyTimeline } from "@/data/content";

export function HistoryTimeline({ tone = "light" }: { tone?: "light" | "dark" }) {
  const onDark = tone === "dark";
  const [active, setActive] = useState<number | null>(0);

  const track = onDark ? "bg-bone/15" : "bg-ink/12";
  const dim = onDark ? "text-bone/60" : "text-ink/60";
  const panel = onDark ? "border-bone/15 bg-bone/[0.04]" : "border-ink/10 bg-ink/[0.02]";

  return (
    <div>
      {/* horizontal track */}
      <div className="relative">
        <div className={`absolute top-[0.42rem] left-0 h-px w-full ${track}`} />
        <ol className="no-scrollbar relative flex gap-10 overflow-x-auto pb-2 md:justify-between md:gap-4">
          {historyTimeline.map((e, i) => {
            const on = active === i;
            return (
              <li key={`${e.year}-${e.label}`} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActive(on ? null : i)}
                  className="group block text-left"
                  aria-expanded={on}
                >
                  <span
                    className={`block size-3.5 rounded-full border-2 transition-all duration-500 ${
                      on
                        ? "scale-125 border-gold bg-gold"
                        : `${onDark ? "border-bone/40" : "border-ink/25"} bg-transparent group-hover:border-gold`
                    }`}
                  />
                  <span
                    className={`mt-5 block font-serif text-2xl transition-colors duration-300 ${
                      on ? "text-gold" : "group-hover:text-gold"
                    }`}
                  >
                    {e.year}
                  </span>
                  <span className={`label-xs mt-2 block ${dim}`}>{e.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* expanding detail */}
      <div
        className={`grid transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          active === null ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-12 grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          {active !== null &&
            (() => {
              const e = historyTimeline[active];
              if (!e) return null;
              return (
                <div className={`rounded-[1.5rem] border p-8 md:p-12 ${panel}`}>
                  <p className="label-xs text-gold">
                    {e.year} — {e.label}
                  </p>
                  <h3 className="mt-5 max-w-2xl font-serif text-3xl leading-tight md:text-4xl">
                    {e.title}
                  </h3>
                  <p className={`mt-6 max-w-2xl leading-relaxed ${dim}`}>{e.snippet}</p>
                  <Link
                    to="/history"
                    hash={`t-${active}`}
                    className="pill mt-10 inline-flex items-center gap-2"
                  >
                    Read more <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              );
            })()}
        </div>

      </div>
    </div>
  );
}
