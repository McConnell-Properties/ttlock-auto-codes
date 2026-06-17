// GET /api/reservations/export — full booking ledger for push_to_sheets.py.
// Returns all bookings (all statuses, no date filter) with CRM fields.
// Auth: Bearer CM_API_KEY enforced at the ROUTE level (fail-closed) — returns
// 503 if CM_API_KEY is unset, 401 if the bearer token is missing/incorrect.
// This holds even when middleware auth is disabled (ADMIN_PASSWORD unset),
// so the full guest ledger can never be served unauthenticated.
// See deploy/AGENT-CHANNEL.md for action items.
import { NextRequest, NextResponse } from 'next/server';
import { all } from '@/lib/db';

export const dynamic = 'force-dynamic';

type ExportRow = {
  // Booking
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
  stripeStatus: string | null; // direct-booking payment: link_sent | paid | expired
  paidAt: string | null;
  createdAt: string;
  // Joined
  roomTypeName: string | null;
  propertyName: string;
  // CrmRecord (nullable — LEFT JOIN, no CRM record until check-in form submitted)
  arrivedDetected: string | null;
  arrivedAt: string | null;
  arrivedSource: string | null;
  arrivalTime: string | null;
  contactMethod: string | null;
  contactValue: string | null;
  cardSaved: string | null;
  preArrivalCompletedAt: string | null;
  confirmedAt: string | null;
  preArrivalNotes: string | null;
  depositStatus: string | null;       // security deposit: hold_active | captured | released | none | ...
  depositPaymentIntent: string | null;
  depositAmount: number | null;
  depositHoldFlag: string | null;
  depositMode: string | null;         // hold | charge | prepaid
};

export async function GET(req: NextRequest) {
  // Fail-closed auth — independent of middleware/ADMIN_PASSWORD state.
  const apiKey = process.env.CM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'export disabled: CM_API_KEY not configured' },
      { status: 503 }
    );
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== apiKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const reservations = await all<ExportRow>(
    `SELECT b.id, b.propertyId, b.roomTypeId, b.physicalRoom, b.guestName, b.email, b.phone,
            b.checkIn, b.checkOut, b.units, b.adults, b.children,
            b.channel, b.channelRef, b.totalPrice, b.status, b.notes,
            b.stripeSessionId, b.stripePaymentUrl, b.stripeStatus, b.paidAt, b.createdAt,
            rt.name AS roomTypeName, p.name AS propertyName,
            c.arrivedDetected, c.arrivedAt, c.arrivedSource,
            c.arrivalTime, c.contactMethod, c.contactValue, c.cardSaved,
            c.preArrivalCompletedAt, c.confirmedAt, c.preArrivalNotes,
            c.depositStatus, c.depositPaymentIntent, c.depositAmount, c.depositHoldFlag, c.depositMode
     FROM Booking b
     LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
     JOIN Property p ON p.id = b.propertyId
     LEFT JOIN CrmRecord c ON c.bookingId = b.id
     ORDER BY b.checkIn DESC`
  );

  return NextResponse.json({ reservations });
}
