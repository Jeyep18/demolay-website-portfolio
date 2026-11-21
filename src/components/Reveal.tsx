import type { ReactNode } from "react";

// PublicPage observes these markers; server-rendered content starts visible.
export function Reveal({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span" | "header";
}) {
  return (
    <Tag data-reveal="" className={className}>
      {children}
    </Tag>
  );
}
