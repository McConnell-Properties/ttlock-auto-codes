// Data layer — all SQL lives here.
import { all, one, run } from './db';

export type Property = {
  id: string;
  name: string;
  bdcHotelId: string | null;
  expediaHotelId: string | null;
  sortOrder: number;
};

export type RoomType = {
  id: number;
  propertyId: string;
  name: string;
  bdcRoomId: string | null;
  expediaName: string | null;
  physicalRooms: string;
  totalUnits: number;
  basePrice: number;
};

export type Booking = {
  id: number;
  propertyId: string;
  roomTypeId: number | null;
  physicalRoom: string | null;
  guestName: string;
  email: string | null;
  phone: string | null;
  checkIn: string;
  checkOut: string;
  units: number;
  adults: number;
  children: number;
  channel: string;
  channelRef: string | null;
  totalPrice: number | null;
  status: string;
  notes: string | null;
  stripeSessionId: string | null;
  stripePaymentUrl: string | null;
  stripeStatus: string | null; // link_sent | paid | expired
  paidAt: string | null;
  createdAt: string;
  originPropertyId: string | null;
  originRoomTypeId: number | null;
  originPhysicalRoom: string | null;
};

export type SyncJob = {
  id: number;
  channel: string;
  roomTypeId: number;
  date: string;
  field: string;
  value: string;
  status: string;
  note: string | null;
  createdAt: string;
  doneAt: string | null;
};

// ---------- properties / room types ----------

export function listProperties() {
  return all<Property>(`SELECT * FROM Property ORDER BY sortOrder`);
}

export function listRoomTypes(propertyId?: string) {
  return propertyId
    ? all<RoomType>(`SELECT * FROM RoomType WHERE propertyId = ? ORDER BY id`, [propertyId])
    : all<RoomType>(`SELECT * FROM RoomType ORDER BY id`);
}

export function getRoomType(id: number) {
  return one<RoomType>(`SELECT * FROM RoomType WHERE id = ?`, [id]);
}

export function getProperty(id: string) {
  return one<Property>(`SELECT * FROM Property WHERE id = ?`, [id]);
}

export async function updateRoomType(id: number, bdcRoomId: string | null, expediaName: string | null) {
  await run(`UPDATE RoomType SET bdcRoomId = ?, expediaName = ? WHERE id = ?`, [bdcRoomId, expediaName, id]);
}

export async function updateRoomTypeBasePrice(id: number, price: number) {
  await run(`UPDATE RoomType SET basePrice = ? WHERE id = ?`, [price, id]);
}

export async function updateProperty(id: string, bdcHotelId: string | null, expediaHotelId: string | null) {
  await run(`UPDATE Property SET bdcHotelId = ?, expediaHotelId = ? WHERE id = ?`, [bdcHotelId, expediaHotelId, id]);
}

// ---------- rates / blocks ----------

export async function upsertRate(roomTypeId: number, date: string, price: number) {
  await run(
    `INSERT INTO RateOverride (roomTypeId, date, price) VALUES (?, ?, ?)
     ON CONFLICT(roomTypeId, date) DO UPDATE SET price = excluded.price`,
    [roomTypeId, date, price]
  );
}

export async function deleteRate(roomTypeId: number, date: string) {
  await run(`DELETE FROM RateOverride WHERE roomTypeId = ? AND date = ?`, [roomTypeId, date]);
}

export async function upsertBlock(roomTypeId: number, date: string, units: number, reason?: string) {
  await run(
    `INSERT INTO Block (roomTypeId, date, units, reason) VALUES (?, ?, ?, ?)
     ON CONFLICT(roomTypeId, date) DO UPDATE SET units = excluded.units, reason = excluded.reason`,
    [roomTypeId, date, units, reason ?? null]
  );
}

export async function deleteBlock(roomTypeId: number, date: string) {
  await run(`DELETE FROM Block WHERE roomTypeId = ? AND date = ?`, [roomTypeId, date]);
}

// ---------- bookings ----------

export type BookingWithRoom = Booking & { roomTypeName: string | null; propertyName: string };

export function listBookings(status?: string, includePast = false) {
  const base = `
    SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName
    FROM Booking b
    LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
    JOIN Property p ON p.id = b.propertyId`;
  const pastFilter = includePast ? '' : `b.checkOut >= date('now')`;
  const statusFilter = status && status !== 'all' ? `b.status = ?` : '';
  const where = [pastFilter, statusFilter].filter(Boolean).join(' AND ');
  const sql = `${base}${where ? ` WHERE ${where}` : ''} ORDER BY b.checkIn LIMIT 300`;
  return statusFilter
    ? all<BookingWithRoom>(sql, [status as string])
    : all<BookingWithRoom>(sql);
}

export function getBooking(id: number) {
  return one<Booking>(`SELECT * FROM Booking WHERE id = ?`, [id]);
}

export async function insertBooking(b: {
  propertyId: string;
  roomTypeId: number | null;
  physicalRoom: string | null;
  guestName: string;
  email: string | null;
  phone: string | null;
  checkIn: string;
  checkOut: string;
  units: number;
  adults?: number;
  children?: number;
  channel: string;
  channelRef: string | null;
  totalPrice: number | null;
  notes: string | null;
}) {
  const rs = await run(
    `INSERT INTO Booking (propertyId, roomTypeId, physicalRoom, guestName, email, phone, checkIn, checkOut, units, adults, children, channel, channelRef, totalPrice, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.propertyId, b.roomTypeId, b.physicalRoom, b.guestName, b.email, b.phone, b.checkIn, b.checkOut, b.units, b.adults ?? 1, b.children ?? 0, b.channel, b.channelRef, b.totalPrice, b.notes]
  );
  return Number(rs.lastInsertRowid);
}

// Bookings overlapping a window (for the multi calendar; all properties)
export function bookingsInWindowAll(start: string, end: string) {
  return all<BookingWithRoom>(
    `SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName
     FROM Booking b
     LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
     JOIN Property p ON p.id = b.propertyId
     WHERE b.status = 'confirmed' AND b.checkIn < ? AND b.checkOut > ?
     ORDER BY b.checkIn`,
    [end, start]
  );
}

// Other confirmed bookings occupying a physical room during a stay window
export function roomConflicts(propertyId: string, physicalRoom: string, checkIn: string, checkOut: string, excludeBookingId?: number) {
  return all<Booking>(
    `SELECT * FROM Booking
     WHERE propertyId = ? AND physicalRoom = ? AND status = 'confirmed'
       AND checkIn < ? AND checkOut > ? ${excludeBookingId ? 'AND id != ?' : ''}`,
    excludeBookingId
      ? [propertyId, physicalRoom, checkOut, checkIn, excludeBookingId]
      : [propertyId, physicalRoom, checkOut, checkIn]
  );
}

export type MoveTarget = {
  propertyId?: string; // omit = stay in current property
  physicalRoom: string | null; // null = unassigned
  roomTypeId?: number | null; // only used when physicalRoom is null (assign type without room)
  checkIn?: string; // omit = keep dates
  checkOut?: string;
};

export type MoveResult = {
  ok: boolean;
  conflicts?: Booking[];
  oldRoomTypeId?: number | null;
  newRoomTypeId?: number | null;
  oldCheckIn?: string;
  oldCheckOut?: string;
  checkIn?: string; // new dates
  checkOut?: string;
};

// Move a booking to another room — possibly in another property.
// Conventions: a booking always belongs to a room type when possible; the physical
// room is the internal allocation within it. Moving to a room derives the type
// from the room; unassigning keeps the type (unless moving property, where the
// optional roomTypeId target applies). Returns conflicts instead of moving
// unless force=true.
export async function moveBooking(bookingId: number, target: MoveTarget, force = false): Promise<MoveResult> {
  const b = await getBooking(bookingId);
  if (!b) throw new Error('booking not found');

  const newPropertyId = target.propertyId ?? b.propertyId;
  const crossProperty = newPropertyId !== b.propertyId;
  const newCheckIn = target.checkIn ?? b.checkIn;
  const newCheckOut = target.checkOut ?? b.checkOut;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(newCheckIn) || !dateRe.test(newCheckOut) || newCheckOut <= newCheckIn) {
    throw new Error('invalid dates: checkOut must be after checkIn (YYYY-MM-DD)');
  }
  let newRoomTypeId: number | null;

  if (target.physicalRoom) {
    const types = await listRoomTypes(newPropertyId);
    const rt = types.find((t) =>
      String(t.physicalRooms).split(',').map((x) => x.trim()).includes(target.physicalRoom!)
    );
    if (!rt) throw new Error(`property '${newPropertyId}' has no room ${target.physicalRoom}`);
    newRoomTypeId = rt.id;
    if (!force) {
      const conflicts = await roomConflicts(newPropertyId, target.physicalRoom, newCheckIn, newCheckOut, bookingId);
      if (conflicts.length > 0) return { ok: false, conflicts };
    }
  } else if (target.roomTypeId !== undefined) {
    if (target.roomTypeId !== null) {
      const rt = await getRoomType(target.roomTypeId);
      if (!rt || rt.propertyId !== newPropertyId) throw new Error('roomTypeId does not belong to target property');
    }
    newRoomTypeId = target.roomTypeId;
  } else {
    // unassign: keep type within same property; drop type across properties
    newRoomTypeId = crossProperty ? null : b.roomTypeId;
  }

  // Capture origin on first move only — never overwrite once set.
  await run(
    `UPDATE Booking SET
       propertyId         = ?,
       physicalRoom       = ?,
       roomTypeId         = ?,
       checkIn            = ?,
       checkOut           = ?,
       originPropertyId   = CASE WHEN originPropertyId IS NULL THEN ? ELSE originPropertyId END,
       originRoomTypeId   = CASE WHEN originPropertyId IS NULL THEN ? ELSE originRoomTypeId END,
       originPhysicalRoom = CASE WHEN originPropertyId IS NULL THEN ? ELSE originPhysicalRoom END
     WHERE id = ?`,
    [newPropertyId, target.physicalRoom ?? null, newRoomTypeId, newCheckIn, newCheckOut,
     b.propertyId, b.roomTypeId, b.physicalRoom,
     bookingId]
  );
  return {
    ok: true,
    oldRoomTypeId: b.roomTypeId,
    newRoomTypeId,
    oldCheckIn: b.checkIn,
    oldCheckOut: b.checkOut,
    checkIn: newCheckIn,
    checkOut: newCheckOut,
  };
}

// Back-compat wrapper (same-property reallocation)
export async function reallocateBooking(bookingId: number, physicalRoom: string | null) {
  const r = await moveBooking(bookingId, { physicalRoom }, true);
  return { oldRoomTypeId: r.oldRoomTypeId ?? null, newRoomTypeId: r.newRoomTypeId ?? null, checkIn: r.checkIn!, checkOut: r.checkOut! };
}

export async function setBookingStatus(id: number, status: string) {
  await run(`UPDATE Booking SET status = ? WHERE id = ?`, [status, id]);
}

export async function updateBookingDetails(id: number, f: {
  guestName?: string;
  email?: string | null;
  phone?: string | null;
  adults?: number;
  children?: number;
  totalPrice?: number | null;
  notes?: string | null;
}) {
  await run(
    `UPDATE Booking SET
       guestName = COALESCE(?, guestName),
       email = ?, phone = ?,
       adults = COALESCE(?, adults),
       children = COALESCE(?, children),
       totalPrice = ?, notes = ?
     WHERE id = ?`,
    [f.guestName ?? null, f.email ?? null, f.phone ?? null, f.adults ?? null, f.children ?? null,
     f.totalPrice ?? null, f.notes ?? null, id]
  );
}

export async function setBookingStripe(id: number, f: {
  stripeSessionId?: string | null;
  stripePaymentUrl?: string | null;
  stripeStatus?: string | null;
  paidAt?: string | null;
}) {
  await run(
    `UPDATE Booking SET
       stripeSessionId = COALESCE(?, stripeSessionId),
       stripePaymentUrl = COALESCE(?, stripePaymentUrl),
       stripeStatus = COALESCE(?, stripeStatus),
       paidAt = COALESCE(?, paidAt)
     WHERE id = ?`,
    [f.stripeSessionId ?? null, f.stripePaymentUrl ?? null, f.stripeStatus ?? null, f.paidAt ?? null, id]
  );
}

// Bookings with an outstanding Stripe link (for payment sync)
export function bookingsAwaitingPayment() {
  return all<Booking>(
    `SELECT * FROM Booking WHERE stripeSessionId IS NOT NULL AND stripeStatus = 'link_sent'`
  );
}

// Rate overrides for all room types in a window (for the multical rates row)
export function ratesForWindow(start: string, end: string) {
  return all<{ roomTypeId: number; date: string; price: number }>(
    `SELECT roomTypeId, date, price FROM RateOverride WHERE date >= ? AND date < ?`,
    [start, end]
  );
}

export function arrivals(date: string) {
  return all<BookingWithRoom>(
    `SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName
     FROM Booking b LEFT JOIN RoomType rt ON rt.id = b.roomTypeId JOIN Property p ON p.id = b.propertyId
     WHERE b.status = 'confirmed' AND b.checkIn = ? ORDER BY p.name`,
    [date]
  );
}

export function departures(date: string) {
  return all<BookingWithRoom>(
    `SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName
     FROM Booking b LEFT JOIN RoomType rt ON rt.id = b.roomTypeId JOIN Property p ON p.id = b.propertyId
     WHERE b.status = 'confirmed' AND b.checkOut = ? ORDER BY p.name`,
    [date]
  );
}

export async function occupiedUnits(date: string): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT COALESCE(SUM(units), 0) AS n FROM Booking
     WHERE status = 'confirmed' AND checkIn <= ? AND checkOut > ?`,
    [date, date]
  );
  return Number(r?.n ?? 0);
}

// ---------- availability grid ----------

export type DayCell = {
  date: string;
  available: number;
  booked: number;
  blocked: number;
  price: number;
  hasOverride: boolean;
};

export type RoomTypeRow = {
  id: number;
  name: string;
  totalUnits: number;
  basePrice: number;
  bdcRoomId: string | null;
  expediaName: string | null;
  days: DayCell[];
};

export function dateRange(start: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const d = new Date(checkIn + 'T00:00:00Z');
  while (d.toISOString().slice(0, 10) < checkOut) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function getGrid(propertyId: string, start: string, days: number): Promise<RoomTypeRow[]> {
  const dates = dateRange(start, days);
  const end = dateRange(start, days + 1)[days];
  const roomTypes = await listRoomTypes(propertyId);
  if (roomTypes.length === 0) return [];
  const ids = roomTypes.map((rt) => rt.id);
  const ph = ids.map(() => '?').join(',');

  const [rates, blocks, bookings] = await Promise.all([
    all<{ roomTypeId: number; date: string; price: number }>(
      `SELECT roomTypeId, date, price FROM RateOverride WHERE roomTypeId IN (${ph}) AND date >= ? AND date < ?`,
      [...ids, start, end]
    ),
    all<{ roomTypeId: number; date: string; units: number }>(
      `SELECT roomTypeId, date, units FROM Block WHERE roomTypeId IN (${ph}) AND date >= ? AND date < ?`,
      [...ids, start, end]
    ),
    all<{ roomTypeId: number; checkIn: string; checkOut: string; units: number }>(
      `SELECT roomTypeId, checkIn, checkOut, units FROM Booking
       WHERE status = 'confirmed' AND roomTypeId IN (${ph}) AND checkIn < ? AND checkOut > ?`,
      [...ids, end, start]
    ),
  ]);

  return roomTypes.map((rt) => ({
    id: rt.id,
    name: rt.name,
    totalUnits: rt.totalUnits,
    basePrice: rt.basePrice,
    bdcRoomId: rt.bdcRoomId,
    expediaName: rt.expediaName,
    days: dates.map((date) => {
      const booked = bookings
        .filter((b) => b.roomTypeId === rt.id && b.checkIn <= date && date < b.checkOut)
        .reduce((s, b) => s + b.units, 0);
      const blocked = blocks
        .filter((bl) => bl.roomTypeId === rt.id && bl.date === date)
        .reduce((s, bl) => s + bl.units, 0);
      const override = rates.find((r) => r.roomTypeId === rt.id && r.date === date);
      return {
        date,
        booked,
        blocked,
        available: Math.max(0, rt.totalUnits - booked - blocked),
        price: override ? override.price : rt.basePrice,
        hasOverride: !!override,
      };
    }),
  }));
}

export async function roomsToSell(roomTypeId: number, date: string): Promise<number> {
  const rt = await getRoomType(roomTypeId);
  if (!rt) return 0;
  const booked = await one<{ n: number }>(
    `SELECT COALESCE(SUM(units), 0) AS n FROM Booking
     WHERE status = 'confirmed' AND roomTypeId = ? AND checkIn <= ? AND checkOut > ?`,
    [roomTypeId, date, date]
  );
  const blocked = await one<{ n: number }>(
    `SELECT COALESCE(SUM(units), 0) AS n FROM Block WHERE roomTypeId = ? AND date = ?`,
    [roomTypeId, date]
  );
  return Math.max(0, rt.totalUnits - Number(booked?.n ?? 0) - Number(blocked?.n ?? 0));
}

// ---------- settings / pricing rules ----------

export type PromoCode = { kind: 'amount_off' | 'set_total'; value: number; note?: string };

export type PricingConfig = {
  baseOccupancy: number;
  extraAdultPerNight: number;
  extraChildPerNight: number;
  directDiscountPct?: number;
  losTiers: { minNights: number; pct: number }[];
  promoCodes?: Record<string, PromoCode>;
};

const DEFAULT_PRICING: PricingConfig = {
  baseOccupancy: 1,
  extraAdultPerNight: 5,
  extraChildPerNight: 2.5,
  directDiscountPct: 5,
  losTiers: [
    { minNights: 7, pct: 35 },
    { minNights: 5, pct: 32 },
    { minNights: 3, pct: 26 },
    { minNights: 2, pct: 20 },
  ],
  promoCodes: {},
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const r = await one<{ value: string }>(`SELECT value FROM Setting WHERE key = ?`, [key]);
    return r ? (JSON.parse(r.value) as T) : fallback;
  } catch {
    return fallback; // Setting table may not exist yet (pre-migration)
  }
}

export function getPricingConfig() {
  return getSetting<PricingConfig>('pricing', DEFAULT_PRICING);
}

function losPctFor(nights: number, cfg: PricingConfig): number {
  let pct = 0;
  for (const t of cfg.losTiers) {
    if (nights >= t.minNights && t.pct > pct) pct = t.pct;
  }
  return pct;
}

// Availability + priced quote for a stay. Direct-booking pricing pipeline:
//   sheet rates → −directDiscountPct → −LOS% → +extra-guest fees → promo code
// Promo codes stack on top of all other discounts. OTAs are unaffected —
// pushes always use the raw sheet price; their own rate plans handle the rest.
export async function stayQuote(
  roomTypeId: number,
  checkIn: string,
  checkOut: string,
  adults = 1,
  children = 0,
  promoCode?: string | null
) {
  const rt = await getRoomType(roomTypeId);
  if (!rt) return null;
  const nights = nightsBetween(checkIn, checkOut);
  if (nights.length === 0) return null;
  const cfg = await getPricingConfig();

  let available = Infinity;
  let baseTotal = 0;
  const rates = await all<{ date: string; price: number }>(
    `SELECT date, price FROM RateOverride WHERE roomTypeId = ? AND date >= ? AND date < ?`,
    [roomTypeId, checkIn, checkOut]
  );
  for (const date of nights) {
    available = Math.min(available, await roomsToSell(roomTypeId, date));
    const o = rates.find((r) => r.date === date);
    baseTotal += o ? o.price : rt.basePrice;
  }

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const directPct = cfg.directDiscountPct ?? 0;
  const directDiscount = (baseTotal * directPct) / 100;
  const afterDirect = baseTotal - directDiscount;
  const losPct = losPctFor(nights.length, cfg);
  const losDiscount = (afterDirect * losPct) / 100;
  const extraAdults = Math.max(0, adults - cfg.baseOccupancy);
  const guestFeesPerNight = extraAdults * cfg.extraAdultPerNight + children * cfg.extraChildPerNight;
  const guestFees = guestFeesPerNight * nights.length;

  let total = afterDirect - losDiscount + guestFees;

  // promo code (stacked last)
  const code = (promoCode || '').trim().toLowerCase();
  let promoApplied: string | null = null;
  let promoValid: boolean | null = null;
  let promoDiscount = 0;
  if (code) {
    const promo = (cfg.promoCodes ?? {})[code];
    if (promo) {
      promoValid = true;
      promoApplied = code;
      if (promo.kind === 'set_total') {
        promoDiscount = total - promo.value;
        total = promo.value;
      } else {
        promoDiscount = Math.min(promo.value, total);
        total = total - promoDiscount;
      }
    } else {
      promoValid = false;
    }
  }

  return {
    roomTypeId,
    available,
    nights: nights.length,
    adults,
    children,
    baseTotal: r2(baseTotal),
    directPct,
    directDiscount: r2(directDiscount),
    losPct,
    losDiscount: r2(losDiscount),
    guestFees: r2(guestFees),
    promoCode: promoApplied,
    promoValid,
    promoDiscount: r2(promoDiscount),
    totalPrice: r2(Math.max(0, total)),
  };
}

// Create a booking + queue OTA inventory pushes (origin channel excluded).
// Used by the admin UI and the direct-booking-site API.
export async function createBookingWithSync(input: {
  roomTypeId: number;
  guestName: string;
  email?: string | null;
  phone?: string | null;
  checkIn: string;
  checkOut: string;
  units?: number;
  adults?: number;
  children?: number;
  channel: string;
  channelRef?: string | null;
  totalPrice?: number | null;
  notes?: string | null;
}) {
  const rt = await getRoomType(input.roomTypeId);
  if (!rt) throw new Error('room type not found');
  const id = await insertBooking({
    propertyId: rt.propertyId,
    roomTypeId: input.roomTypeId,
    physicalRoom: null,
    guestName: input.guestName,
    email: input.email || null,
    phone: input.phone || null,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    units: input.units ?? 1,
    adults: input.adults ?? 1,
    children: input.children ?? 0,
    channel: input.channel,
    channelRef: input.channelRef || null,
    totalPrice: input.totalPrice ?? null,
    notes: input.notes || null,
  });
  const exclude = input.channel === 'direct' ? undefined : input.channel;
  await queueInventorySync(input.roomTypeId, nightsBetween(input.checkIn, input.checkOut), exclude);
  return id;
}

// ---------- CRM ----------

export type CrmRecord = {
  bookingId: number;
  preStayCall: string; preStayDate: string | null;
  formSent: string; formCompleted: string;
  midStayCall: string; msDate: string | null;
  checkinRating: number | null; cleanlinessRating: number | null;
  issueFlagged: string | null; taskGiven: string | null;
  firstContact: string; fcDate: string | null; feedback: string | null;
  rebookingInterest: string; directBookingOffered: string; promoCodeGiven: string | null;
  secondContact: string; scDate: string | null;
  review: string; reviewDate: string | null; reviewScore: number | null;
  issueReport: string | null;
  guestSentiment: string;
  arrivedDetected: string; arrivedAt: string | null; arrivedSource: string;
  updatedAt: string | null;
  // check-in ingest fields
  arrivalTime: string | null;
  contactMethod: string | null;
  contactValue: string | null;
  cardSaved: string;
  preArrivalCompletedAt: string | null;
  confirmedAt: string | null;
  preArrivalNotes: string | null;
};

export type CrmRow = BookingWithRoom & Partial<CrmRecord>;

const CRM_FIELDS = [
  'preStayCall', 'preStayDate', 'formSent', 'formCompleted',
  'midStayCall', 'msDate', 'checkinRating', 'cleanlinessRating', 'issueFlagged', 'taskGiven',
  'firstContact', 'fcDate', 'feedback', 'rebookingInterest', 'directBookingOffered', 'promoCodeGiven',
  'secondContact', 'scDate', 'review', 'reviewDate', 'reviewScore', 'issueReport', 'guestSentiment',
  'arrivedDetected', 'arrivedAt', 'arrivedSource',
  'arrivalTime', 'contactMethod', 'contactValue', 'cardSaved',
  'preArrivalCompletedAt', 'confirmedAt', 'preArrivalNotes',
] as const;

export async function upsertCrm(bookingId: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields).filter((k) => (CRM_FIELDS as readonly string[]).includes(k));
  if (keys.length === 0) return;
  await run(
    `INSERT INTO CrmRecord (bookingId, updatedAt) VALUES (?, CURRENT_TIMESTAMP)
     ON CONFLICT(bookingId) DO NOTHING`,
    [bookingId]
  );
  const sets = keys.map((k) => `"${k}" = ?`).join(', ');
  await run(
    `UPDATE CrmRecord SET ${sets}, updatedAt = CURRENT_TIMESTAMP WHERE bookingId = ?`,
    [...keys.map((k) => fields[k] as never), bookingId]
  );
}

// ---------- check-in ingest ----------

export function findBookingByRef(ref: string) {
  return one<{ id: number; propertyId: string; guestName: string; channelRef: string }>(
    `SELECT id, propertyId, guestName, channelRef FROM Booking WHERE channelRef = ? LIMIT 1`,
    [ref]
  );
}

type CheckinExtra = {
  extraId: string;
  extraName: string;
  date?: string | null;
  time?: string | null;
  nights?: number | null;
  price?: number;
  status: string;
  stripeSession?: string | null;
};

type CheckinContact = {
  contactMethods?: { method: string; value: string }[];
  earlyCheckin?: string | null;
  parking?: boolean;
  luggage?: { date: string; nights: number; time: string } | null;
  cardSaved?: boolean;
  savedAt?: string | null;
};

export async function upsertCheckin(ref: string, payload: {
  confirmedAt?: string | null;
  contact?: CheckinContact | null;
  extras?: CheckinExtra[];
  updatedAt?: string;
}): Promise<{ matched: boolean; bookingId: number | null }> {
  const booking = await findBookingByRef(ref);

  if (booking) {
    const crmFields: Record<string, unknown> = {};

    if (payload.confirmedAt) crmFields.confirmedAt = payload.confirmedAt;

    if (payload.contact) {
      const c = payload.contact;
      if (c.contactMethods?.length) {
        crmFields.contactMethod = c.contactMethods[0].method;
        crmFields.contactValue = c.contactMethods[0].value;
      }
      if (c.cardSaved !== undefined) crmFields.cardSaved = c.cardSaved ? 'yes' : 'no';
      if (c.earlyCheckin) crmFields.arrivalTime = c.earlyCheckin;
      crmFields.preArrivalCompletedAt = payload.updatedAt || new Date().toISOString();
      const notes: string[] = [];
      if (c.earlyCheckin) notes.push(`Early check-in: ${c.earlyCheckin}`);
      if (c.parking) notes.push('Parking requested');
      if (c.luggage) notes.push(`Luggage: ${c.luggage.date} ${c.luggage.time} (${c.luggage.nights}n)`);
      crmFields.preArrivalNotes = notes.join('; ') || null;
    }

    if (Object.keys(crmFields).length > 0) await upsertCrm(booking.id, crmFields);
  }

  if (payload.extras?.length) {
    for (const e of payload.extras) {
      await run(
        `INSERT INTO ExtrasRequest (bookingReference, bookingId, extra, date, time, nights, price, sourceStatus, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bookingReference, extra, COALESCE(date,''), COALESCE(time,''))
         DO UPDATE SET
           price = excluded.price,
           sourceStatus = excluded.sourceStatus,
           bookingId = COALESCE(excluded.bookingId, bookingId)`,
        [ref, booking?.id ?? null, e.extraId, e.date ?? null, e.time ?? null,
         e.nights ?? null, e.price ?? null, e.status, JSON.stringify(e)]
      );
    }
  }

  return { matched: !!booking, bookingId: booking?.id ?? null };
}

// ---------- extras requests (booking-site contract: .data/extras-requests.csv) ----------

export type ExtrasTask = {
  id: number;
  bookingReference: string;
  bookingId: number | null;
  extra: string;
  date: string | null;
  time: string | null;
  nights: number | null;
  price: number | null;
  sourceStatus: string | null;
  taskStatus: string;
  guestName: string | null;
  propertyName: string | null;
  physicalRoom: string | null;
  checkIn: string | null;
  checkOut: string | null;
};

export function extrasTasks(includeDone = false) {
  return all<ExtrasTask>(
    `SELECT e.*, b.guestName, p.name AS propertyName, b.physicalRoom, b.checkIn, b.checkOut
     FROM ExtrasRequest e
     LEFT JOIN Booking b ON b.id = e.bookingId
     LEFT JOIN Property p ON p.id = b.propertyId
     ${includeDone ? '' : `WHERE e.taskStatus IN ('pending', 'in_progress')`}
     ORDER BY COALESCE(e.date, b.checkIn), e.id`
  );
}

export async function setExtrasTaskStatus(id: number, taskStatus: string) {
  await run(`UPDATE ExtrasRequest SET taskStatus = ? WHERE id = ?`, [taskStatus, id]);
}

// Bookings + CRM state for the pipeline page.
// Window: arrivals up to `aheadDays` out, plus stays checked out within `backDays`.
export function crmRows(aheadDays = 7, backDays = 30) {
  return all<CrmRow>(
    `SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName,
            c.preStayCall, c.preStayDate, c.formSent, c.formCompleted,
            c.midStayCall, c.msDate, c.checkinRating, c.cleanlinessRating, c.issueFlagged, c.taskGiven,
            c.firstContact, c.fcDate, c.feedback, c.rebookingInterest, c.directBookingOffered, c.promoCodeGiven,
            c.secondContact, c.scDate, c.review, c.reviewDate, c.reviewScore, c.issueReport, c.guestSentiment,
            c.arrivedDetected, c.arrivedAt, c.arrivedSource,
            c.arrivalTime, c.contactMethod, c.contactValue, c.cardSaved,
            c.preArrivalCompletedAt, c.confirmedAt, c.preArrivalNotes
     FROM Booking b
     LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
     JOIN Property p ON p.id = b.propertyId
     LEFT JOIN CrmRecord c ON c.bookingId = b.id
     WHERE b.status = 'confirmed'
       AND b.checkIn <= date('now', '+' || ? || ' days')
       AND b.checkOut >= date('now', '-' || ? || ' days')
     ORDER BY b.checkIn`,
    [aheadDays, backDays]
  );
}

// ---------- sync queue ----------

export type SyncJobWithRoom = SyncJob & {
  roomTypeName: string;
  propertyName: string;
  bdcRoomId: string | null;
  expediaName: string | null;
};

export function pendingSyncJobs() {
  return all<SyncJobWithRoom>(
    `SELECT j.*, rt.name AS roomTypeName, rt.bdcRoomId, rt.expediaName, p.name AS propertyName
     FROM SyncJob j JOIN RoomType rt ON rt.id = j.roomTypeId JOIN Property p ON p.id = rt.propertyId
     WHERE j.status IN ('pending', 'processing') ORDER BY j.channel, p.name, j.date`
  );
}

export function recentSyncJobs(limit = 30) {
  return all<SyncJobWithRoom>(
    `SELECT j.*, rt.name AS roomTypeName, rt.bdcRoomId, rt.expediaName, p.name AS propertyName
     FROM SyncJob j JOIN RoomType rt ON rt.id = j.roomTypeId JOIN Property p ON p.id = rt.propertyId
     WHERE j.status NOT IN ('pending', 'processing') ORDER BY j.doneAt DESC LIMIT ?`,
    [limit]
  );
}

export async function pendingSyncCount(): Promise<number> {
  const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM SyncJob WHERE status IN ('pending', 'processing')`);
  return Number(r?.n ?? 0);
}

export async function setSyncJobStatus(id: number, status: 'done' | 'failed', note?: string) {
  await run(`UPDATE SyncJob SET status = ?, doneAt = CURRENT_TIMESTAMP, note = ? WHERE id = ?`, [status, note ?? null, id]);
}

export async function setSyncJobsStatus(ids: number[], status: 'done' | 'failed') {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => '?').join(',');
    await run(`UPDATE SyncJob SET status = ?, doneAt = CURRENT_TIMESTAMP WHERE id IN (${ph})`, [status, ...chunk]);
  }
}

async function createSyncJob(channel: string, roomTypeId: number, date: string, field: string, value: string) {
  // Supersede any existing job for the same target (pending or in-flight).
  // Deleting a processing row is safe: the drainer already read the data into
  // memory, so the subsequent markJobs() becomes a no-op on the deleted row.
  await run(
    `DELETE FROM SyncJob WHERE roomTypeId = ? AND date = ? AND channel = ? AND field = ?
     AND status IN ('pending', 'processing')`,
    [roomTypeId, date, channel, field]
  );
  await run(
    `INSERT INTO SyncJob (channel, roomTypeId, date, field, value) VALUES (?, ?, ?, ?, ?)`,
    [channel, roomTypeId, date, field, value]
  );
}

async function channelsFor(roomTypeId: number, excludeChannel?: string): Promise<string[]> {
  const rt = await getRoomType(roomTypeId);
  if (!rt) return [];
  const p = await getProperty(rt.propertyId);
  const channels: string[] = [];
  if (p?.bdcHotelId && excludeChannel !== 'booking.com') channels.push('booking.com');
  if (p?.expediaHotelId && rt.expediaName && excludeChannel !== 'expedia') channels.push('expedia');
  return channels;
}

export async function queueInventorySync(roomTypeId: number, dates: string[], excludeChannel?: string) {
  const channels = await channelsFor(roomTypeId, excludeChannel);
  for (const date of dates) {
    const value = String(await roomsToSell(roomTypeId, date));
    for (const channel of channels) {
      await createSyncJob(channel, roomTypeId, date, 'inventory', value);
    }
  }
}

export async function queuePriceSync(roomTypeId: number, dates: string[], price: number) {
  const channels = await channelsFor(roomTypeId);
  for (const date of dates) {
    for (const channel of channels) {
      await createSyncJob(channel, roomTypeId, date, 'price', String(price));
    }
  }
}

// ---------- portal / tasks helpers ----------

export function extrasForBooking(bookingId: number) {
  return all<ExtrasTask>(
    `SELECT e.*, b.guestName, p.name AS propertyName, b.physicalRoom, b.checkIn, b.checkOut
     FROM ExtrasRequest e
     LEFT JOIN Booking b ON b.id = e.bookingId
     LEFT JOIN Property p ON p.id = b.propertyId
     WHERE e.bookingId = ?
     ORDER BY COALESCE(e.date, b.checkIn), e.id`,
    [bookingId]
  );
}

export function extrasForDate(date: string) {
  return all<ExtrasTask & { billing: string; addedBy: string }>(
    `SELECT e.*,
            COALESCE(e.billing, '') AS billing,
            COALESCE(e.addedBy, '') AS addedBy,
            b.guestName, p.name AS propertyName, b.physicalRoom, b.checkIn, b.checkOut
     FROM ExtrasRequest e
     LEFT JOIN Booking b ON b.id = e.bookingId
     LEFT JOIN Property p ON p.id = b.propertyId
     WHERE e.date = ? OR (e.date IS NULL AND b.checkIn = ?)
     ORDER BY e.id`,
    [date, date]
  );
}

export type BookingFull = Booking & {
  roomTypeName: string | null;
  propertyName: string | null;
  crm: Partial<CrmRecord> | null;
};

export async function findBookingFullByRef(ref: string): Promise<BookingFull | null> {
  const row = await one<Booking & { roomTypeName: string | null; propertyName: string | null }>(
    `SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName
     FROM Booking b
     LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
     LEFT JOIN Property p  ON p.id  = b.propertyId
     WHERE b.channelRef = ? LIMIT 1`,
    [ref]
  );
  if (!row) return null;
  const crm = await one<Partial<CrmRecord>>(
    `SELECT * FROM CrmRecord WHERE bookingId = ? LIMIT 1`, [row.id]
  );
  return { ...row, crm: crm ?? null };
}

export function findBookingByGuestDetails(
  firstName: string,
  lastName: string,
  checkIn: string,
  checkOut: string
) {
  const fullName = `${firstName} ${lastName}`.trim();
  return one<{ id: number; channelRef: string | null }>(
    `SELECT id, channelRef FROM Booking
     WHERE guestName LIKE ? AND checkIn = ? AND checkOut = ? AND status = 'confirmed'
     LIMIT 1`,
    [`%${fullName}%`, checkIn, checkOut]
  );
}

export function upcomingBookingsWithDeposit() {
  return all<Booking & { roomTypeName: string | null; propertyName: string | null }>(
    `SELECT b.*, rt.name AS roomTypeName, p.name AS propertyName
     FROM Booking b
     LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
     LEFT JOIN Property p  ON p.id  = b.propertyId
     WHERE b.status = 'confirmed' AND b.checkIn >= date('now')
       AND b.totalPrice IS NOT NULL AND b.totalPrice > 0
     ORDER BY b.checkIn`
  );
}

export async function markBookingBySession(
  sessionId: string,
  status: 'paid' | 'expired'
): Promise<number> {
  const rs = await run(
    `UPDATE Booking SET stripeStatus = ?,
       paidAt = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paidAt END
     WHERE stripeSessionId = ?`,
    [status, status, sessionId]
  );
  return Number(rs.rowsAffected ?? 0);
}
