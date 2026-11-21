import { useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Expand, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import type { Photo } from "@/data/content";

export function PhotoGallery({
  photos,
  children,
  id = "gallery",
}: {
  photos: Photo[];
  id?: string;
  children?: ((open: (index: number, trigger: HTMLElement) => void) => ReactNode) | undefined;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const open = (index: number, element: HTMLElement) => {
    trigger.current = element;
    setZoom(false);
    setActive(index);
  };
  const move = (offset: number) => {
    setZoom(false);
    setActive((current) =>
      current === null ? null : (current + offset + photos.length) % photos.length,
    );
    viewport.current?.scrollTo(0, 0);
  };
  const photo = active === null ? undefined : photos[active];
  return (
    <>
      {children?.(open)}
      {photos.length > 0 && (
        <section id={id} className="event-gallery" aria-labelledby={`${id}-title`}>
          <div className="section-heading">
            <p className="chapter-eyebrow">A closer look</p>
            <h2 id={`${id}-title`}>Moments in the frame.</h2>
            <p>Select a photograph to take a closer look.</p>
          </div>
          <div className="photo-collage">
            {photos.map((item, index) => (
              <button
                key={`${item.src}-${index}`}
                type="button"
                onClick={(event) => open(index, event.currentTarget)}
                aria-label={`Inspect photo ${index + 1}: ${item.alt}`}
              >
                <img
                  src={item.src}
                  width={item.width}
                  height={item.height}
                  alt={item.alt}
                  loading="lazy"
                />
                <Expand aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}
      <Dialog
        open={active !== null}
        onOpenChange={(value) => {
          if (!value) {
            setActive(null);
            setZoom(false);
          }
        }}
      >
        <DialogContent
          className="chapter-dialog gallery-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          onKeyDown={(event) => {
            if (zoom && event.target === viewport.current) return;
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          <DialogTitle>
            Photo {active === null ? "" : active + 1} of {photos.length}
          </DialogTitle>
          <DialogDescription className="gallery-description">
            {photo?.caption || photo?.alt}
          </DialogDescription>
          <div
            className={`gallery-viewport ${zoom ? "is-zoomed" : ""}`}
            ref={viewport}
            role="region"
            tabIndex={0}
            aria-label={zoom ? "Zoomed photo. Use the arrow keys to pan." : "Photo viewing area"}
          >
            {photo && (
              <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} />
            )}
          </div>
          <div className="gallery-controls">
            <button type="button" onClick={() => move(-1)} aria-label="Previous photo">
              <ChevronLeft />
              Previous
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(!zoom);
                if (!zoom) viewport.current?.focus({ preventScroll: true });
                viewport.current?.scrollTo(0, 0);
              }}
              aria-label={zoom ? "Fit photo" : "Zoom photo"}
            >
              {zoom ? <ZoomOut /> : <ZoomIn />}
              {zoom ? "Fit" : "Zoom"}
            </button>
            <button type="button" onClick={() => move(1)} aria-label="Next photo">
              Next
              <ChevronRight />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
