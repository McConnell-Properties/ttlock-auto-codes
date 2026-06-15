// Extras & offers catalog shown in the guest portal.
// Pricing is always recomputed server-side in priceForExtra().

export type ExtraField = 'date' | 'time' | 'earlyTime' | 'lateTime' | 'nights';

export type Extra = {
  id: string;
  name: string;
  tag: string; // small label, e.g. "£10 flat" / "FREE"
  blurb: string;
  details: string[];
  fields: ExtraField[];
  cta: string;
  refundable?: boolean; // show "100% refundable"
  calendar?: boolean; // availability-calendar booking (aircon, parking)
};

export const EXTRAS: Extra[] = [
  {
    id: 'towel-exchange',
    name: 'Free towel exchange',
    tag: 'FREE',
    blurb: "Staying a few nights? We'll swap your towels for a clean set whenever you need it. Just drop us a message.",
    details: [],
    fields: ['date'],
    cta: 'Request fresh towels',
  },
  {
    id: 'early-checkin',
    name: 'Early check-in — from 1pm',
    tag: '£10',
    blurb: 'Start your stay the moment you get here instead of waiting. Drop your bags, freshen up and settle in straight away.',
    details: [
      'Choose your approximate arrival time and we will do our best to have your room ready.',
      'Subject to availability — we confirm your request as soon as possible.',
      'Perfect for early flights, travelling with children, or making the most of your day.',
    ],
    fields: ['earlyTime'],
    cta: 'Request early check-in',
    refundable: true,
  },
  {
    id: 'late-checkout',
    name: 'Late check-out — until 1pm',
    tag: '£10/hour',
    blurb: 'Keep your room longer, squeeze in extra sightseeing — or a little more sleep — before you head out. Standard check-out is free before 11am.',
    details: [
      '£10 per hour after 11am, up to 1pm at the latest.',
      'Subject to availability — we confirm your request as soon as possible.',
    ],
    fields: ['lateTime'],
    cta: 'Request late check-out',
    refundable: true,
  },
  {
    id: 'luggage',
    name: 'Luggage drop-off',
    tag: '£5/night',
    blurb: "Secure storage for up to 2 large bags. Perfect if you're exploring the city before check-in or after check-out.",
    details: [],
    fields: ['date', 'nights', 'time'],
    cta: 'Book luggage storage',
    refundable: true,
  },
  {
    id: 'laundry',
    name: 'Laundry service',
    tag: '£10',
    blurb: 'Collected from your door, expertly washed (9kg drum, premium detergent & softener), tumble dried, neatly folded and delivered back. Completely hassle-free.',
    details: [],
    fields: ['date', 'time'],
    cta: 'Book laundry pick-up',
  },
  {
    id: 'room-clean',
    name: 'Room clean & linen change',
    tag: '£10',
    blurb: "Keeping things fresh during longer stays. Full clean plus fresh bed linen — so it feels like you've just arrived all over again.",
    details: [],
    fields: ['date', 'time'],
    cta: 'Book a room refresh',
    refundable: true,
  },
  {
    id: 'cooking-pack',
    name: 'Self-Catering Cooking Pack',
    tag: 'from £15/week',
    blurb: 'Everything you need to cook a proper meal — pots, pans, dishes and utensils, ready to go. Breakfast crockery (bowls, mugs, spoons) is always included free; this pack adds the full cooking kit for guests who want to self-cater.',
    details: [
      'Full kit: pots, pans, cooking utensils, dishes and chopping board in one pack.',
      'Starter consumables included: oil, salt, pepper, washing-up liquid and a sponge.',
      'Deposit returned in full when the kit is left clean and washed up after your stay.',
      "Limited packs — request at booking and we'll have it set up on arrival.",
    ],
    fields: ['nights'],
    cta: 'Request cooking pack',
  },
  {
    id: 'parking',
    name: 'Parking (offsite, reserved)',
    tag: 'from £6/night + £5 per use',
    blurb: 'Arriving by car? Reserve a secure space nearby for the length of your stay. One space per night — book well in advance.',
    details: [
      'Nightly rate varies with demand (shown on the calendar), plus a £5 per-use access fee.',
      'The parking address is offsite — full directions in your confirmation.',
    ],
    fields: ['nights'],
    cta: 'Check availability & reserve',
    calendar: true,
  },
  {
    id: 'aircon',
    name: 'Air conditioning unit (vented)',
    tag: 'from £10/night + £20 installation',
    blurb: 'Powerful cooling down to 16°C with moving vents that spread air evenly — ideal for warm nights. Nightly price follows the weather forecast.',
    details: [
      '3-in-1 climate control: cooler, 3-speed fan and dehumidifier in one.',
      'Quiet Sleep Mode for an undisturbed night.',
      'Easy timers and remote control — set it to run only when you need it.',
      'Limited units — live availability shown on the calendar.',
    ],
    fields: ['nights'],
    cta: 'Check availability & book',
    calendar: true,
  },
];

export function extraById(id: string) {
  return EXTRAS.find((e) => e.id === id);
}

// Server-side price computation — single source of truth.
export function priceForExtra(id: string, opts: { nights?: number; lateTime?: string }): number {
  const n = Math.min(Math.max(Math.round(opts.nights || 1), 1), 30);
  switch (id) {
    case 'towel-exchange': return 0;
    case 'early-checkin': return 10;
    case 'late-checkout': return opts.lateTime === '13:00' ? 20 : 10; // 12:00 = +1h, 13:00 = +2h
    case 'luggage': return 5 * n;
    case 'laundry': return 10;
    case 'room-clean': return 10;
    case 'cooking-pack': return 15 * Math.max(1, Math.ceil(n / 7));
    // aircon & parking are calendar extras — priced per-date in lib/dynamicPricing.ts
    default: return -1;
  }
}

// 15-minute slots, 09:00 → 08:45 next day (matches the offers sheet).
export function timeSlots(): string[] {
  const out: string[] = [];
  for (let q = 0; q < 96; q++) {
    const mins = (9 * 60 + q * 15) % (24 * 60);
    out.push(`${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
  }
  return out;
}

export const EARLY_TIMES = ['13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30', '14:45'];
export const LATE_TIMES = [
  { value: '12:00', label: '12:00 noon (+£10)' },
  { value: '13:00', label: '1:00 pm (+£20)' },
];
