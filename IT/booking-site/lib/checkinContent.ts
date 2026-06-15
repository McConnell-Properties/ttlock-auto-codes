// Per-property check-in instructions. All 5 properties are live.
// Addresses sourced from deploy/property-contact-info.md (2026-06-13).

export type CheckinInfo = {
  propertyId: string;
  name: string;
  phone: string;
  addressLines: string[];
  googleMaps: string;
  appleMaps: string;
  streetView?: string;
  arrivalNote: string;
  lockNote: string;
  parkingNote: string | null; // null = omit parking option for this property
};

const ARRIVAL_NOTE =
  'You must arrive after your check-in time — the smart lock will not allow access until this time.';
const LOCK_NOTE =
  'Enter your door code on the smart lock keypad, then press ✓ (or #). The same code opens the front door and your room.';

// Parking description shared by Gassiot / Tooting / Valnay (off-site at Streatham Road).
const OFFSITE_PARKING =
  'Off-site parking at our Streatham Road location, behind 2 private gates. Best suited to smaller cars.';

export const CHECKIN: Record<string, CheckinInfo> = {
  streatham: {
    propertyId: 'streatham',
    name: 'Streatham Rooms',
    phone: '+44 7418 640119',
    addressLines: ['116 Streatham Road', 'Mitcham', 'CR4 2AE'],
    googleMaps: 'https://maps.app.goo.gl/TFEnSS7QTwc6KAZM9',
    appleMaps: 'https://maps.apple/p/PuhcX~Nb~wFyUX',
    arrivalNote: ARRIVAL_NOTE,
    lockNote: LOCK_NOTE,
    parkingNote: 'On-site parking, behind 2 private gates. Best suited to smaller cars.',
  },
  gassiot: {
    propertyId: 'gassiot',
    name: 'Gassiot House',
    phone: '+44 7537 149286',
    addressLines: ['113 Gassiot Road', 'London', 'SW17 8LD'],
    googleMaps: 'https://maps.app.goo.gl/Fw5EDDxwFA59np3y8',
    appleMaps: 'https://maps.apple.com/?q=113+Gassiot+Road+London+SW17+8LD',
    arrivalNote: ARRIVAL_NOTE,
    lockNote: LOCK_NOTE,
    parkingNote: OFFSITE_PARKING,
  },
  tooting: {
    propertyId: 'tooting',
    name: 'Tooting Stays',
    phone: '+44 7418 640137',
    addressLines: ['127 Fountain Road', 'London', 'SW17 0HH'],
    googleMaps: 'https://maps.google.com/?q=127+Fountain+Road+London+SW17+0HH',
    appleMaps: 'https://maps.apple.com/?q=127+Fountain+Road+London+SW17+0HH',
    arrivalNote: ARRIVAL_NOTE,
    lockNote: LOCK_NOTE,
    parkingNote: OFFSITE_PARKING,
  },
  valnay: {
    propertyId: 'valnay',
    name: 'Valnay Stays',
    phone: '+44 7418 640204',
    addressLines: ['33 Valnay Street', 'London', 'SW17 8PS'],
    googleMaps: 'https://maps.app.goo.gl/g1izYasccAoeh82X6',
    appleMaps: 'https://maps.apple/p/04vRBv~x8t-6U.z',
    arrivalNote: ARRIVAL_NOTE,
    lockNote: LOCK_NOTE,
    parkingNote: OFFSITE_PARKING,
  },
  seamless: {
    propertyId: 'seamless',
    name: 'Seamless Stays',
    phone: '+44 7418 640122',
    addressLines: ['71 Heigham Road', 'Norwich', 'NR2 3AE'],
    googleMaps: 'https://maps.google.com/?q=71+Heigham+Road+Norwich+NR2+3AE',
    appleMaps: 'https://maps.apple.com/?q=71+Heigham+Road+Norwich+NR2+3AE',
    arrivalNote: ARRIVAL_NOTE,
    lockNote: LOCK_NOTE,
    parkingNote: null, // @CHARLIE confirm parking availability for Norwich
  },
};

export function checkinFor(propertyId = 'streatham'): CheckinInfo {
  return CHECKIN[propertyId] ?? CHECKIN.streatham;
}
