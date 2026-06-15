'use client';
import { useCallback, useEffect, useState } from 'react';

// Clickable photo gallery with a full-screen lightbox (arrows, keyboard, swipe).
export default function Gallery({ photos, alt }: { photos: string[]; alt: string }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [touchX, setTouchX] = useState<number | null>(null);

  const prev = useCallback(() => setIdx((i) => (i - 1 + photos.length) % photos.length), [photos.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % photos.length), [photos.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, prev, next]);

  if (!photos.length) {
    return <div className="gallery-empty" aria-label="No photos yet" />;
  }

  return (
    <>
      <button
        type="button"
        className="gallery-main"
        onClick={() => { setIdx(0); setOpen(true); }}
        aria-label={`View ${photos.length} photos of ${alt}`}
      >
        <img src={photos[0]} alt={alt} loading="lazy" />
        <span className="gallery-hint">📷 {photos.length} photo{photos.length > 1 ? 's' : ''} — click to view</span>
      </button>

      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <button className="lb-close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
          <div
            className="lb-stage"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchX === null) return;
              const dx = e.changedTouches[0].clientX - touchX;
              if (dx > 40) prev();
              if (dx < -40) next();
              setTouchX(null);
            }}
          >
            {photos.length > 1 && <button className="lb-nav lb-prev" aria-label="Previous photo" onClick={prev}>‹</button>}
            <img src={photos[idx]} alt={`${alt} — photo ${idx + 1}`} />
            {photos.length > 1 && <button className="lb-nav lb-next" aria-label="Next photo" onClick={next}>›</button>}
            <div className="lb-counter">{idx + 1} / {photos.length}</div>
          </div>
          {photos.length > 1 && (
            <div className="lb-thumbs" onClick={(e) => e.stopPropagation()}>
              {photos.map((p, i) => (
                <button key={p} className={i === idx ? 'active' : ''} onClick={() => setIdx(i)} aria-label={`Photo ${i + 1}`}>
                  <img src={p} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
