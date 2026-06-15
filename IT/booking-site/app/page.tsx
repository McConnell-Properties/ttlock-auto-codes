import SearchForm from './SearchForm';
import Gallery from '@/components/Gallery';
import { currentProperty } from '@/lib/properties';
import { roomPhotos } from '@/lib/photos';

export const dynamic = 'force-dynamic';

export default function Home() {
  const prop = currentProperty();
  const heroShots = prop.rooms.map((r) => roomPhotos(r.slug)[0]).filter(Boolean).slice(0, 4);

  return (
    <>
      <section className="hero">
        <h1>Your room in {prop.displayName}</h1>
        <p>
          Book direct for our best rates — no booking-site fees, automatic long-stay discounts
          up to 35%, and real humans on the other end. Private ensuites, apartment-style rooms
          with kitchens, and great-value shared-bathroom rooms.
        </p>
        <div className="hero-badges">
          <span>✓ Best price direct</span>
          <span>✓ Free cancellation 48h</span>
          <span>✓ Self check-in with door codes</span>
          <span>✓ Up to 35% off long stays</span>
        </div>
        {heroShots.length > 0 && (
          <div className="hero-strip">
            {heroShots.map((src) => <img key={src} src={src} alt={prop.displayName} />)}
          </div>
        )}
      </section>

      <SearchForm />

      <section className="perks">
        <div className="perk"><h3>Best price, direct</h3><p>The same rooms as on Booking.com and Expedia — without their fees on top.</p></div>
        <div className="perk"><h3>Long-stay discounts</h3><p>2+ nights 20% off, 3+ nights 26%, 5+ nights 32%, a week or more 35% off.</p></div>
        <div className="perk"><h3>Never turned away</h3><p>Fully booked in one room? We&apos;ll find you a smart room-switch plan so you can stay the whole time.</p></div>
      </section>

      <section className="perks" style={{ marginTop: 14 }}>
        <div className="perk"><h3>Early check-in from 1pm</h3><p>£10 — start your stay the moment you arrive. Request it in the <a href="/portal">guest portal</a> after booking.</p></div>
        <div className="perk"><h3>Reserved parking</h3><p>Secure offsite space from £4.25/night (+£10 access fee). Limited spaces — reserve early via the <a href="/portal">guest portal</a>.</p></div>
        <div className="perk"><h3>Stay services</h3><p>Free towel exchange, laundry, luggage storage, room refresh, late check-out and AC units — all in the <a href="/portal">guest portal</a>.</p></div>
      </section>

      <h2 className="section-title">Our rooms</h2>
      {prop.rooms.map((r) => {
        const photos = roomPhotos(r.slug);
        return (
          <article className="room-card" key={r.name}>
            <div>
              <Gallery photos={photos} alt={r.headline} />
            </div>
            <div className="room-body">
              <h2>{r.headline}</h2>
              <p className="sub">Sleeps {r.maxOccupants} · {r.beds} {r.beds === 1 ? 'bed' : 'beds'}{r.privateBathroom ? ' · private bathroom' : ' · shared bathroom'}{r.privateKitchen ? ' · private kitchen' : ''}</p>
              <p style={{ fontSize: '0.93rem' }}>{r.description}</p>
              <ul className="amenities">{r.amenities.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
            <div className="room-price">
              <span className="fine">Pick dates above to see live prices &amp; availability</span>
            </div>
          </article>
        );
      })}
    </>
  );
}
