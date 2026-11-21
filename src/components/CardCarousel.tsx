import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

export type CarouselCard = {
  slug: string;
  title: string;
  meta: string;
  sub?: string;
  image: string;
};

export function CardCarousel({
  cards,
  to,
  tone = "light",
  interval = 8000,
}: {
  cards: CarouselCard[];
  to: "/articles/$slug" | "/events/$slug";
  tone?: "light" | "dark";
  interval?: number;
}) {
  const onDark = tone === "dark";
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = cards.length;

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + count) % count),
    [count],
  );

  useEffect(() => {
    if (paused || count < 2) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % count), interval);
    return () => window.clearInterval(t);
  }, [paused, count, interval]);

  if (count === 0) return null;

  const border = onDark ? "border-bone/15" : "border-ink/10";
  const dim = onDark ? "text-bone/60" : "text-ink/60";
  const dotOff = onDark ? "bg-bone/25" : "bg-ink/20";

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* viewport: one featured card, neighbours held off-screen */}
      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {cards.map((c, i) => (
            <div key={c.slug} className="w-full shrink-0 px-1 md:px-2">
              <Link
                to={to}
                params={{ slug: c.slug }}
                tabIndex={i === index ? 0 : -1}
                aria-hidden={i !== index}
                className={`group relative block overflow-hidden rounded-[1.75rem] border ${border} transition-all duration-700 hover:border-gold/60 hover:shadow-[0_36px_80px_-40px_rgba(0,0,0,0.55)] ${
                  i === index ? "opacity-100" : "opacity-40"
                }`}
              >
                <div className="grid md:grid-cols-2">
                  <div className="aspect-[16/10] overflow-hidden md:aspect-auto md:h-full md:min-h-[24rem]">
                    <img
                      src={c.image}
                      alt=""
                      loading="lazy"
                      width={1280}
                      height={800}
                      className="size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.06]"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-5 p-8 md:p-14">
                    <p className="label-xs text-gold">{c.meta}</p>
                    <h3 className="font-serif text-3xl leading-tight transition-colors duration-500 group-hover:text-gold md:text-5xl">
                      {c.title}
                    </h3>
                    {c.sub && <p className={`max-w-md leading-relaxed ${dim}`}>{c.sub}</p>}
                    <span
                      className={`mt-2 inline-flex items-center gap-2 text-xs tracking-[0.14em] uppercase ${dim} transition-all duration-500 group-hover:gap-4 group-hover:text-gold`}
                    >
                      Read <ArrowRight className="size-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {cards.map((c, i) => (
            <button
              key={c.slug}
              type="button"
              aria-label={`Go to ${c.title}`}
              onClick={() => setIndex(i)}
              className={`h-1 rounded-full transition-all duration-500 ${
                i === index ? "w-10 bg-gold" : `w-4 ${dotOff} hover:bg-gold/60`
              }`}
            />
          ))}
        </div>
        <div className="flex gap-3">
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              aria-label={dir === -1 ? "Previous" : "Next"}
              onClick={() => go(dir)}
              className={`flex size-11 items-center justify-center rounded-full border ${border} transition-all duration-300 hover:-translate-y-0.5 hover:border-gold hover:text-gold active:scale-95`}
            >
              {dir === -1 ? <ArrowLeft className="size-4" /> : <ArrowRight className="size-4" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
