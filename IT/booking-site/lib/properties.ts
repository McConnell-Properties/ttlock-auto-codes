import { headers } from 'next/headers';
import { ROOMS as STREATHAM_ROOMS, type RoomContent } from './content';
import { CHECKIN, type CheckinInfo } from './checkinContent';

export type { RoomContent, CheckinInfo };

export type PropertyConfig = {
  id: string;
  displayName: string;
  tagline: string;
  description: string;
  domains: string[];
  checkin: CheckinInfo;
  rooms: RoomContent[];
};

export const PROPERTIES: Record<string, PropertyConfig> = {
  streatham: {
    id: 'streatham',
    displayName: 'Streatham Rooms',
    tagline: 'Book direct — long-stay discounts up to 35%',
    description:
      'Book directly with Streatham Rooms, South London. Best-price guarantee, long-stay discounts up to 35%, private and shared rooms.',
    domains: ['www.streathamrooms.co.uk', 'streathamrooms.co.uk'],
    checkin: CHECKIN.streatham,
    rooms: STREATHAM_ROOMS,
  },

  gassiot: {
    id: 'gassiot',
    displayName: 'Gassiot House',
    tagline: 'Book direct — best rates guaranteed',
    description:
      'Book directly with Gassiot House, Tooting, South London. Great-value private and shared rooms with no booking-site fees.',
    domains: ['www.gassiothouse.co.uk', 'gassiothouse.co.uk'],
    checkin: CHECKIN.gassiot,
    rooms: [
      {
        name: 'Superior King or Twin Room',
        slug: 'gassiot/g1',
        headline: 'Superior king or twin room',
        description:
          'The finest room at Gassiot House — set up as a king or twin, with generous space and thoughtful touches. Shared bathroom facilities on the same floor.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 2,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['King or twin setup', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        name: 'Two Twin Beds or Super King, Vented, Shared bathroom',
        slug: 'gassiot/g2',
        headline: 'Ventilated twin or super-king room',
        description:
          'A well-ventilated room with two twin beds that can be arranged as a super king. Great for couples or colleagues — shared bathroom nearby.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 2,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Twin or super-king setup', 'Sleeps 2', 'Ventilation', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        name: 'Twin or Super King Bed in Cozy Room (Shared Bath)',
        slug: 'gassiot/g3',
        headline: 'Cosy twin or super-king room',
        description:
          'A cosy, comfortable room set up as twin beds or a super king. Ideal for a relaxing short or long stay. Shared bathroom facilities.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 2,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Twin or super-king setup', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        name: 'Single Room, Shared bathroom',
        slug: 'gassiot/g4',
        headline: 'Single room',
        description:
          'A compact, great-value single room for solo travellers. Bathroom facilities are shared with other guests on the same floor.',
        physicalRooms: [],
        maxOccupants: 1,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Single bed', 'Sleeps 1', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        // TODO @CHARLIE review — G5 photo folder not found; confirm room details
        name: 'Basic Double Room with Shared Bathroom',
        slug: 'gassiot/g5',
        headline: 'Basic double room',
        description:
          'A straightforward double room at great-value rates. Clean, comfortable and close to shared bathroom facilities.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        name: 'Budget Double Room with Shared Bathroom',
        slug: 'gassiot/g6',
        headline: 'Budget double room',
        description:
          'Our most affordable double room — comfortable, clean and great value. Shared bathroom on the same floor.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Shared bathroom'],
      },
      {
        name: 'Double Room, Shared Bathroom',
        slug: 'gassiot/g7',
        headline: 'Double room with shared bathroom',
        description:
          'A comfortable double room with shared bathroom facilities. Well-presented and good value.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
    ],
  },

  tooting: {
    id: 'tooting',
    displayName: 'Tooting Stays',
    tagline: 'Book direct — best rates guaranteed',
    description:
      'Book directly with Tooting Stays, moments from Tooting Broadway tube. No booking-site fees, long-stay discounts available.',
    domains: ['www.tooting-stays.com', 'tooting-stays.com'],
    checkin: CHECKIN.tooting,
    rooms: [
      // TODO @CHARLIE review — confirm beds, occupancy and bathrooms for all Tooting rooms
      {
        name: 'Room 1',
        slug: 'tooting/room',
        headline: 'Room 1',
        description: 'A private room at Tooting Stays, moments from Tooting Broadway tube station.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
      },
      {
        name: 'Room 2',
        slug: 'tooting/room',
        headline: 'Room 2',
        description: 'A private room at Tooting Stays, moments from Tooting Broadway tube station.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
      },
      {
        name: 'Room 3',
        slug: 'tooting/room',
        headline: 'Room 3',
        description: 'A private room at Tooting Stays, moments from Tooting Broadway tube station.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
      },
      {
        name: 'Room 4',
        slug: 'tooting/room',
        headline: 'Room 4',
        description: 'A private room at Tooting Stays, moments from Tooting Broadway tube station.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
      },
      {
        name: 'Room 5',
        slug: 'tooting/room',
        headline: 'Room 5',
        description: 'A private room at Tooting Stays, moments from Tooting Broadway tube station.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
      },
      {
        name: 'Room 6',
        slug: 'tooting/room',
        headline: 'Room 6',
        description: 'A private room at Tooting Stays, moments from Tooting Broadway tube station.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
      },
    ],
  },

  valnay: {
    id: 'valnay',
    displayName: 'Valnay Stays',
    tagline: 'Book direct — best rates guaranteed',
    description:
      'Book directly with Valnay Stays. No booking-site fees, long-stay discounts available.',
    domains: ['www.guestonlyhotels.co.uk', 'guestonlyhotels.co.uk'],
    checkin: CHECKIN.valnay,
    rooms: [
      // TODO @CHARLIE review — confirm all Valnay room details
      {
        name: 'Twin Room/ Super King Bed, with Shared Bathroom',
        slug: 'valnay/room',
        headline: 'Twin or super-king room, shared bathroom',
        description: 'A comfortable twin or super-king room with shared bathroom facilities.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 2,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Twin or super-king setup', 'Sleeps 2', 'Free Wi-Fi', 'Shared bathroom'],
      },
      {
        name: 'Twin Room/ Super King Bed, with En-suite',
        slug: 'valnay/room',
        headline: 'Twin or super-king room with en-suite',
        description: 'A comfortable twin or super-king room with your own private en-suite bathroom.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 2,
        privateBathroom: true,
        privateKitchen: false,
        amenities: ['Twin or super-king setup', 'Sleeps 2', 'Free Wi-Fi', 'Private bathroom'],
      },
      {
        name: 'Business, Double Room, Shared Bathroom',
        slug: 'valnay/room',
        headline: 'Business double room',
        description: 'A well-appointed double room suited to business travellers. Shared bathroom facilities.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        name: 'Double Room, Shared Bathroom',
        slug: 'valnay/room',
        headline: 'Double room with shared bathroom',
        description: 'A comfortable double room with shared bathroom facilities.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Shared bathroom'],
      },
    ],
  },

  seamless: {
    id: 'seamless',
    displayName: 'Seamless Stays',
    tagline: 'Book direct — best rates guaranteed',
    description:
      'Book directly with Seamless Stays. No booking-site fees, long-stay discounts available.',
    domains: ['www.seamless-stays.com', 'seamless-stays.com'],
    checkin: CHECKIN.seamless,
    rooms: [
      // TODO @CHARLIE review — confirm all Seamless room details
      {
        name: 'Room 1',
        slug: 'seamless/room',
        headline: 'Room 1',
        description: 'A private room at Seamless Stays.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Free Wi-Fi', 'Shared bathroom'],
      },
      {
        name: 'Double Room with Shared Bathroom',
        slug: 'seamless/room',
        headline: 'Double room with shared bathroom',
        description: 'A comfortable double room with shared bathroom facilities at Seamless Stays.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Shared bathroom'],
      },
      {
        name: 'Large Double Room',
        slug: 'seamless/room',
        headline: 'Large double room',
        description: 'A spacious double room with extra space to relax and unwind.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Large double bed', 'Sleeps 2', 'Free Wi-Fi', 'Shared bathroom'],
      },
      {
        name: 'Deluxe Double Room',
        slug: 'seamless/room',
        headline: 'Deluxe double room',
        description: 'Our finest double room at Seamless Stays — extra comfort and thoughtful finishes.',
        physicalRooms: [],
        maxOccupants: 2,
        beds: 1,
        privateBathroom: false, // TODO @CHARLIE review — confirm if ensuite
        privateKitchen: false,
        amenities: ['Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom'],
      },
      {
        name: 'Single Room with Shared Bathroom',
        slug: 'seamless/room',
        headline: 'Single room',
        description: 'A compact, great-value single room for solo travellers. Shared bathroom facilities.',
        physicalRooms: [],
        maxOccupants: 1,
        beds: 1,
        privateBathroom: false,
        privateKitchen: false,
        amenities: ['Single bed', 'Sleeps 1', 'Free Wi-Fi', 'Shared bathroom'],
      },
    ],
  },
};

// Normalise host → bare domain: strip www. prefix and port number.
function bareHost(host: string): string {
  return host.replace(/^www\./, '').replace(/:\d+$/, '').toLowerCase();
}

const domainMap = new Map<string, PropertyConfig>();
for (const prop of Object.values(PROPERTIES)) {
  for (const d of prop.domains) domainMap.set(bareHost(d), prop);
}

export function propertyForHost(host: string): PropertyConfig {
  return domainMap.get(bareHost(host)) ?? PROPERTIES.streatham;
}

// Server-component helper — reads the Host header from the current request.
// Defaults to streatham for localhost and during build-time static generation.
export function currentProperty(): PropertyConfig {
  try {
    const host = headers().get('host') ?? '';
    return propertyForHost(host);
  } catch {
    return PROPERTIES.streatham;
  }
}

// API-route helper — reads the Host header from a NextRequest/Request object.
export function propertyForRequest(req: { headers: { get(name: string): string | null } }): PropertyConfig {
  const host = req.headers.get('host') ?? '';
  return propertyForHost(host);
}
