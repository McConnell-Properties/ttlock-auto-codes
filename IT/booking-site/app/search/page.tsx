import SearchForm from '../SearchForm';
import Gallery from '@/components/Gallery';
import { getAvailability } from '@/lib/cm';
import { contentByPhysicalRoom } from '@/lib/content';
import { currentProperty } from '@/lib/properties';
import { roomPhotos } from '@/lib/photos';
import { discounted, stayDiscount } from '@/lib/discounts';
import { getSwitchPlans, SwitchPlan } from '@/lib/switchQuote';

export const dynamic = 'force-dynamic';

type Search = { checkIn?: string; checkOut?: string; guests?: string; prefer?: string; minBeds?: string };

const fmt = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function encodePlan(p: SwitchPlan) {
  return p.segments.map((s) => `${s.room}:${s.start}:${s.end}:${s.price}`).join('|');
}

export default async function SearchPage({ searchParams }: { searchParams: Search }) {
  const prop = currentProperty();
  const checkIn = searchParams.checkIn || '';
  const checkOut = searchParams.checkOut || '';
  const guests = Math.max(1, Number(searchParams.guests) || 1);
  const prefer = (['bathroom', 'kitchen', 'none'].includes(searchParams.prefer || '') ? searchParams.prefer : 'bathroom') as 'bathroom' | 'kitchen' | 'none';
  const minBeds = Math.max(1, Number(searchParams.minBeds) || 1);

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(checkIn) || !dateRe.test(checkOut) || checkOut <= checkIn) {
    return (
      <>
        <SearchForm />
        <div className="notice error" style={{ marginTop: 18 }}>
          <h2>Please pick valid dates</h2>
          <p>Check-out must be after check-in.</p>
        </div>
      </>
    );
  }

  let rows;
  try {
    rows = await getAvailability(checkIn, checkOut, prop.id);
  } catch (e: any) {
    const cm = process.env.CHANNEL_MANAGER_URL || 'http://localhost:3000';
    return (
      <>
        <SearchForm {...{ checkIn, checkOut, guests, prefer, minBeds }} />
        <div className="notice error" style={{ marginTop: 18 }}>
          <h2>Booking system unavailable</h2>
          <p>
            We couldn&apos;t reach the reservation system at <strong>{cm}</strong>. Check the channel
            manager&apos;s terminal for its &quot;ready on http://localhost:XXXX&quot; line and make sure
            CHANNEL_MANAGER_URL in the booking site&apos;s .env matches, then restart this site.
          </p>
          <p className="fine" style={{ marginTop: 6 }}>Details: {String(e?.message || e).slice(0, 200)}</p>
        </div>
      </>
    );
  }

  const nights = rows[0]?.nights ?? Math.round((+new Date(checkOut) - +new Date(checkIn)) / 86400000);
  const rate = stayDiscount(nights);

  // Join live availability with the content layer; apply guest filters.
  const cards = rows
    .map((r) => ({ r, c: prop.rooms.find((rc) => rc.name === r.roomTypeName) }))
    .filter((x) => x.c && x.r.available > 0 && x.c!.maxOccupants >= guests && x.c!.beds >= minBeds)
    .map((x) => {
      const matches = prefer === 'none' || (prefer === 'bathroom' ? x.c!.privateBathroom : x.c!.privateKitchen);
      const d = discounted(x.r.totalPrice, nights);
      return { ...x, matches, finalPrice: d.total };
    })
    .sort((a, b) => Number(b.matches) - Number(a.matches) || a.finalPrice - b.finalPrice);

  // No single room covers the stay → room-switching plans from quote.py (Streatham only).
  let plans: SwitchPlan[] = [];
  let planError: string | undefined;
  if (cards.length === 0) {
    const res = await getSwitchPlans({ checkIn, checkOut, guests, prefer, minBeds: minBeds > 1 ? minBeds : undefined, propertyId: prop.id });
    plans = res.plans;
    planError = res.error;
  }

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ checkIn, checkOut, guests: String(guests), prefer, minBeds: String(minBeds), ...extra }).toString();

  return (
    <>
      <SearchForm {...{ checkIn, checkOut, guests, prefer, minBeds }} />
      <h1 style={{ fontSize: '1.3rem', margin: '22px 0 4px' }}>
        {fmt(checkIn)} → {fmt(checkOut)} · {nights} {nights === 1 ? 'night' : 'nights'} · {guests} {guests === 1 ? 'guest' : 'guests'}
      </h1>
      {searchParams && (searchParams as any).bookError && (
        <div className="notice error">
          <h2>That booking didn&apos;t go through</h2>
          <p>{(searchParams as any).bookError}</p>
        </div>
      )}
      {rate > 0 && cards.length > 0 && (
        <p className="save" style={{ margin: '0 0 16px' }}>
          {Math.round(rate * 100)}% long-stay discount applied to all prices below.
        </p>
      )}

      {cards.map(({ r, c, matches, finalPrice }) => {
        const photos = roomPhotos(c!.slug);
        return (
          <article className="room-card" key={r.roomTypeId}>
            <div>
              <Gallery photos={photos} alt={c!.headline} />
            </div>
            <div className="room-body">
              <h2>{c!.headline}</h2>
              <p className="sub">
                Sleeps {c!.maxOccupants} · {c!.beds} beds{c!.privateBathroom ? ' · private bathroom' : ' · shared bathroom'}{c!.privateKitchen ? ' · private kitchen' : ''}
              </p>
              {matches && prefer !== 'none' && (
                <span className="badge match">✓ matches your {prefer === 'bathroom' ? 'private bathroom' : 'private kitchen'} preference</span>
              )}{' '}
              {r.available === 1 && <span className="badge scarce">Only 1 left for your dates</span>}
              <ul className="amenities">{c!.amenities.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
            <div className="room-price">
              {rate > 0 && <span className="strike">£{r.totalPrice.toFixed(2)}</span>}
              <span className="price">£{finalPrice.toFixed(2)}<small> total · {nights} nights</small></span>
              {rate > 0 && <span className="save">You save £{(r.totalPrice - finalPrice).toFixed(2)}</span>}
              <span className="fine">Free cancellation up to 48h before</span>
              <a className="btn" href={`/book?${qs({ roomTypeId: String(r.roomTypeId), price: finalPrice.toFixed(2), base: r.totalPrice.toFixed(2) })}`}>
                Book now
              </a>
            </div>
          </article>
        );
      })}

      {cards.length === 0 && (
        <div className="notice">
          <h2>No single room is free for your whole stay — but you can still stay with us</h2>
          <p>
            By switching rooms partway through, you can cover all {nights} nights. Our housekeeping team
            moves your luggage on switch day — your stay continues uninterrupted. Pick a plan below:
          </p>
        </div>
      )}

      {cards.length === 0 && plans.length > 0 && plans.map((p, i) => {
        const segTypes = p.segments.map((s) => contentByPhysicalRoom(s.room));
        return (
          <article className="plan-card" key={i}>
            <div className="labels">
              {p.label.split(',').map((l) => l.trim()).filter(Boolean).map((l) => (
                <span className="badge match" key={l}>{l}</span>
              ))}
              {p.warning && <span className="badge scarce">{p.warning}</span>}
            </div>
            <div className="plan-route">{p.plan}</div>
            <ul className="segments">
              {p.segments.map((s, j) => (
                <li key={j}>
                  {fmt(s.start)} → {fmt(s.end)}: <strong>{segTypes[j]?.headline || `Room ${s.room}`}</strong>
                  {segTypes[j]?.privateBathroom ? ' (private bathroom)' : ' (shared bathroom)'}
                  {segTypes[j]?.privateKitchen ? ' + private kitchen' : ''}
                </li>
              ))}
            </ul>
            <div className="plan-row">
              <span className="plan-meta">
                {p.switches} room {p.switches === 1 ? 'switch' : 'switches'}
                {prefer !== 'none' && <> · {p.preferredNights}/{nights} nights with {prefer === 'bathroom' ? 'private bathroom' : 'private kitchen'}</>}
              </span>
              <div style={{ textAlign: 'right' }}>
                {p.fullPrice > p.totalPrice && <span className="strike" style={{ marginRight: 8 }}>£{p.fullPrice.toFixed(2)}</span>}
                <span className="price">£{p.totalPrice.toFixed(2)}</span>{' '}
                <a className="btn" href={`/book?${qs({ plan: encodePlan(p), price: p.totalPrice.toFixed(2), base: p.fullPrice.toFixed(2), planLabel: p.plan })}`}>
                  Book this plan
                </a>
              </div>
            </div>
          </article>
        );
      })}

      {cards.length === 0 && plans.length === 0 && (
        <div className="notice error">
          <h2>Sorry — we&apos;re fully booked for those dates</h2>
          <p>{planError ? `Details: ${planError}` : "Even with room switching we can't cover every night. Try shifting your dates by a day or two."}</p>
        </div>
      )}
    </>
  );
}
