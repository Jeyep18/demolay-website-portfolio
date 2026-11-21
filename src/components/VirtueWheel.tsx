import { useState } from "react";
import { virtues } from "@/data/content";

export function VirtueWheel({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [active, setActive] = useState(0);
  const onDark = tone === "dark";
  const current = virtues[active]!;

  const ring = onDark ? "border-bone/20" : "border-ink/15";
  const dim = onDark ? "text-bone/55" : "text-ink/55";

  return (
    <div className="virtue-wheel flex flex-col items-center gap-12 lg:flex-row lg:gap-20">
      <div className="virtue-wheel-dial relative aspect-square w-full max-w-[26rem] shrink-0">
        {/* points sit inside the ring so nothing clips */}
        <div className={`absolute inset-[6%] rounded-full border ${ring}`} />
        <div className={`absolute inset-[20%] rounded-full border ${ring} opacity-60`} />
        <div
          className="absolute inset-[28%] rounded-full transition-all duration-700"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--gold) 22%, transparent), transparent 70%)",
          }}
        />

        {/* center readout */}
        <div className="absolute inset-[26%] flex flex-col items-center justify-center rounded-full text-center">
          <span className="label-xs text-gold">{current.n}</span>
          <span className="mt-2 font-serif text-2xl leading-tight md:text-[1.75rem]">
            {current.name}
          </span>
        </div>

        {virtues.map((v, i) => {
          const angle = (i / virtues.length) * 2 * Math.PI - Math.PI / 2;
          const x = 50 + 44 * Math.cos(angle);
          const y = 50 + 44 * Math.sin(angle);
          const isActive = i === active;
          return (
            <button
              key={v.n}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={v.name}
              aria-pressed={isActive}
              className="group absolute -translate-x-1/2 -translate-y-1/2 outline-none"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span
                className={`flex size-11 items-center justify-center rounded-full border text-[0.7rem] tracking-[0.14em] transition-all duration-500 ${
                  isActive
                    ? "scale-115 border-gold bg-gold text-ink shadow-[0_0_0_8px_color-mix(in_oklab,var(--gold)_16%,transparent)]"
                    : `${ring} ${dim} group-hover:scale-110 group-hover:border-gold group-hover:text-gold`
                } ${onDark ? "bg-ink/60" : "bg-bone/70"} ${isActive ? "!bg-gold" : ""}`}
              >
                {v.n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="virtue-wheel-detail min-h-[9rem] max-w-md">
        <p className="label-xs text-gold">Virtue {current.n} of VII</p>
        <h3 key={current.name} className="mt-5 animate-fade-in font-serif text-4xl md:text-5xl">
          {current.name}
        </h3>
        <p key={current.text} className={`mt-5 animate-fade-in leading-relaxed ${dim}`}>
          {current.text}
        </p>
        <p className={`mt-8 text-xs ${dim}`}>Hover or tap a point on the wheel.</p>
      </div>
    </div>
  );
}
