// Room content layer — keyed by channel-manager room type NAME (stable),
// resolved to roomTypeId at runtime via the channel-manager API.
// Source: IT/room-type-mapping.md + special quote/data/rooms.csv.

export type RoomContent = {
  name: string; // exact channel-manager room type name
  slug: string; // photo folder under public/rooms/<slug>
  headline: string;
  description: string;
  physicalRooms: string[]; // Streatham physical rooms covered by this type
  maxOccupants: number; // conservative: min across physical rooms
  beds: number;
  privateBathroom: boolean;
  privateKitchen: boolean;
  amenities: string[];
};

// Streatham room data — also re-used via lib/properties.ts for the streatham
// property entry. switchQuote.ts (Streatham-only) uses contentByPhysicalRoom.
export const ROOMS: RoomContent[] = [
  {
    name: 'Triple Room with Private Bathroom',
    slug: 'triple-private',
    headline: 'Spacious triple with ensuite',
    description:
      'A large, bright room sleeping up to 4 guests across 3 beds, with your own private bathroom. Ideal for families or small groups.',
    physicalRooms: ['1', '4'],
    maxOccupants: 4,
    beds: 3,
    privateBathroom: true,
    privateKitchen: false,
    amenities: ['Private bathroom', '3 beds', 'Sleeps 4', 'Free Wi-Fi', 'Smart TV', 'Shared kitchen access'],
  },
  {
    name: 'Quad room, with Shared Bathroom',
    slug: 'quad-shared',
    headline: 'Big room for groups',
    description:
      'Our largest rooms, sleeping up to 5 guests across 3 beds. Bathroom facilities are shared with other guests on the floor.',
    physicalRooms: ['10', '11'],
    maxOccupants: 5,
    beds: 3,
    privateBathroom: false,
    privateKitchen: false,
    amenities: ['3 beds', 'Sleeps 5', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom', 'Shared kitchen access'],
  },
  {
    name: 'Superior King or Twin Room',
    slug: 'superior-king-twin',
    headline: 'Superior king or twin',
    description:
      'A comfortable superior room made up as a king or twin, for up to 2 guests. Bathroom facilities are shared.',
    physicalRooms: ['5', '6'],
    maxOccupants: 2,
    beds: 3,
    privateBathroom: false,
    privateKitchen: false,
    amenities: ['King or twin setup', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV', 'Shared bathroom', 'Shared kitchen access'],
  },
  {
    name: 'Double or Twin Room with Private Bathroom',
    slug: 'comfort-twin-ensuite',
    headline: 'Comfort double/twin with ensuite',
    description:
      'A cosy double or twin room with its own private bathroom — the best of both worlds for couples or colleagues.',
    physicalRooms: ['8'],
    maxOccupants: 2,
    beds: 2,
    privateBathroom: true,
    privateKitchen: false,
    amenities: ['Private bathroom', 'Double or twin setup', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV'],
  },
  {
    name: 'Double room-Ensuite',
    slug: 'double-ensuite',
    headline: 'Double room with ensuite',
    description:
      'A classic double room with private ensuite bathroom. Quiet, comfortable and great value for couples.',
    physicalRooms: ['2', '3'],
    maxOccupants: 2,
    beds: 2,
    privateBathroom: true,
    privateKitchen: false,
    amenities: ['Private bathroom', 'Double bed', 'Sleeps 2', 'Free Wi-Fi', 'Smart TV'],
  },
  {
    name: 'Twin Room, with full private kitchen and ensuite',
    slug: 'luxury-apartment',
    headline: 'Apartment-style: private kitchen + ensuite',
    description:
      'Our most independent stay — a twin room with a full private kitchen and your own ensuite bathroom. Perfect for longer stays.',
    physicalRooms: ['9'],
    maxOccupants: 3,
    beds: 3,
    privateBathroom: true,
    privateKitchen: true,
    amenities: ['Private kitchen', 'Private bathroom', 'Sleeps 3', 'Free Wi-Fi', 'Smart TV', 'Ideal for long stays'],
  },
  {
    name: 'Basic Single Room with Shared Bathroom',
    slug: 'single-shared',
    headline: 'Budget single',
    description:
      'A simple, great-value single room for the solo traveller. Bathroom facilities are shared.',
    physicalRooms: ['7'],
    maxOccupants: 1,
    beds: 1,
    privateBathroom: false,
    privateKitchen: false,
    amenities: ['Single bed', 'Free Wi-Fi', 'Shared bathroom', 'Shared kitchen access'],
  },
];

export function contentByName(name: string): RoomContent | undefined {
  return ROOMS.find((r) => r.name === name);
}

export function contentByPhysicalRoom(room: string): RoomContent | undefined {
  return ROOMS.find((r) => r.physicalRooms.includes(String(room)));
}
