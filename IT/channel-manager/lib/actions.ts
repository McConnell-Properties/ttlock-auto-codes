'use server';

import * as data from './data';
import { triggerBeds24Push } from './beds24-push';
import { createCheckoutSession, getSessionStatus } from './stripe';
import { sendEmail, paymentEmailBody } from './email';
import { revalidatePath } from 'next/cache';

export async function setPrice(roomTypeId: number, date: string, price: number) {
  if (price > 0) {
    await data.upsertRate(roomTypeId, date, price);
    await data.queuePriceSync(roomTypeId, [date], price);
  } else {
    // price 0 clears the override back to base price
    await data.deleteRate(roomTypeId, date);
    const rt = await data.getRoomType(roomTypeId);
    if (rt) await data.queuePriceSync(roomTypeId, [date], rt.basePrice);
  }
  revalidatePath('/calendar');
  revalidatePath('/sync');
  triggerBeds24Push();
}

export async function setBlock(roomTypeId: number, date: string, units: number, reason?: string) {
  if (units > 0) {
    await data.upsertBlock(roomTypeId, date, units, reason);
  } else {
    await data.deleteBlock(roomTypeId, date);
  }
  await data.queueInventorySync(roomTypeId, [date]);
  revalidatePath('/calendar');
  revalidatePath('/sync');
  triggerBeds24Push();
}

export async function setBasePrice(roomTypeId: number, price: number) {
  await data.updateRoomTypeBasePrice(roomTypeId, price);
  revalidatePath('/calendar');
  revalidatePath('/properties');
}

export async function createBooking(input: {
  roomTypeId: number;
  guestName: string;
  email?: string;
  phone?: string;
  checkIn: string;
  checkOut: string;
  units: number;
  adults?: number;
  children?: number;
  channel: string;
  channelRef?: string;
  totalPrice?: number;
  notes?: string;
}) {
  const id = await data.createBookingWithSync(input);
  revalidatePath('/bookings');
  revalidatePath('/calendar');
  revalidatePath('/sync');
  revalidatePath('/');
  triggerBeds24Push();
  return id;
}

export async function cancelBooking(id: number) {
  const b = await data.getBooking(id);
  if (!b) return;
  await data.setBookingStatus(id, 'cancelled');
  // Restore availability on the other channels (origin handles itself)
  const exclude = b.channel === 'direct' ? undefined : b.channel;
  if (b.roomTypeId != null) {
    await data.queueInventorySync(b.roomTypeId, data.nightsBetween(b.checkIn, b.checkOut), exclude);
  }
  revalidatePath('/bookings');
  revalidatePath('/calendar');
  revalidatePath('/sync');
  revalidatePath('/');
  triggerBeds24Push();
}

export async function reallocate(bookingId: number, physicalRoom: string | null) {
  return moveBookingAction(bookingId, { physicalRoom }, true);
}

// Move a booking to any room in any property. Returns conflicts (without moving)
// unless force=true; the UI confirms and retries with force.
export async function moveBookingAction(
  bookingId: number,
  target: data.MoveTarget,
  force = false
): Promise<{ ok: boolean; conflicts?: { id: number; guestName: string; checkIn: string; checkOut: string }[] }> {
  const r = await data.moveBooking(bookingId, target, force);
  if (!r.ok) {
    return {
      ok: false,
      conflicts: (r.conflicts ?? []).map((c) => ({
        id: c.id, guestName: c.guestName, checkIn: c.checkIn, checkOut: c.checkOut,
      })),
    };
  }
  // Allocation/date changes affect type-level inventory — push to OTAs for
  // every night freed (old dates) or newly occupied (new dates), on both the
  // old and new room types.
  const nights = [...new Set([
    ...data.nightsBetween(r.oldCheckIn!, r.oldCheckOut!),
    ...data.nightsBetween(r.checkIn!, r.checkOut!),
  ])];
  const datesChanged = r.oldCheckIn !== r.checkIn || r.oldCheckOut !== r.checkOut;
  if (r.oldRoomTypeId != null && (r.oldRoomTypeId !== r.newRoomTypeId || datesChanged)) {
    await data.queueInventorySync(r.oldRoomTypeId, nights);
  }
  if (r.newRoomTypeId != null && r.newRoomTypeId !== r.oldRoomTypeId) {
    await data.queueInventorySync(r.newRoomTypeId, nights);
  }
  revalidatePath('/multical');
  revalidatePath('/calendar');
  revalidatePath('/bookings');
  revalidatePath('/sync');
  triggerBeds24Push();
  return { ok: true };
}

export async function updateBookingAction(id: number, f: {
  guestName?: string;
  email?: string | null;
  phone?: string | null;
  adults?: number;
  children?: number;
  totalPrice?: number | null;
  notes?: string | null;
}) {
  await data.updateBookingDetails(id, f);
  revalidatePath('/multical');
  revalidatePath('/bookings');
}

// Live quote for the multical quote tool (same engine as the booking site API)
export async function quoteAction(
  roomTypeId: number,
  checkIn: string,
  checkOut: string,
  adults: number,
  children: number,
  promoCode?: string | null
) {
  return data.stayQuote(roomTypeId, checkIn, checkOut, adults, children, promoCode);
}

// Create a Stripe Checkout link for a booking and email it to the guest.
export async function sendPaymentLinkAction(bookingId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const b = await data.getBooking(bookingId);
    if (!b) return { ok: false, error: 'booking not found' };
    if (!b.email) return { ok: false, error: 'booking has no guest email — add one first' };
    if (b.totalPrice == null || b.totalPrice <= 0) return { ok: false, error: 'booking has no total price — set one first' };

    const property = await data.getProperty(b.propertyId);
    const rt = b.roomTypeId != null ? await data.getRoomType(b.roomTypeId) : null;
    const cfg = await data.getSetting<{ successUrls: Record<string, string>; linkExpiryHours: number }>('stripe', {
      successUrls: {}, linkExpiryHours: 24,
    });
    const successUrl = cfg.successUrls[b.propertyId] || cfg.successUrls.default;
    if (!successUrl) return { ok: false, error: 'no success URL configured (Setting.stripe)' };

    const nights = data.nightsBetween(b.checkIn, b.checkOut).length;
    const { sessionId, url } = await createCheckoutSession({
      bookingId: b.id,
      amountGbp: b.totalPrice,
      description: `${property?.name ?? 'Stay'} — ${nights} night${nights > 1 ? 's' : ''} ${b.checkIn} to ${b.checkOut}`,
      customerEmail: b.email,
      successUrl,
      expiresHours: cfg.linkExpiryHours,
      reservationCode: b.channelRef,
    });

    await sendEmail(
      b.email,
      `Payment for your stay at ${property?.name ?? 'our property'} — ${b.checkIn}`,
      paymentEmailBody({
        guestName: b.guestName,
        propertyName: property?.name ?? 'our property',
        roomTypeName: rt?.name ?? null,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        nights,
        total: b.totalPrice,
        url,
        expiresHours: cfg.linkExpiryHours,
      })
    );

    await data.setBookingStripe(bookingId, {
      stripeSessionId: sessionId,
      stripePaymentUrl: url,
      stripeStatus: 'link_sent',
    });
    revalidatePath('/multical');
    revalidatePath('/bookings');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

// Poll Stripe for all outstanding links; mark paid/expired.
export async function syncStripeAction(): Promise<{ checked: number; paid: number; expired: number; errors: string[] }> {
  const out = { checked: 0, paid: 0, expired: 0, errors: [] as string[] };
  const pending = await data.bookingsAwaitingPayment();
  for (const b of pending) {
    out.checked++;
    try {
      const s = await getSessionStatus(b.stripeSessionId!);
      if (s === 'paid') {
        await data.setBookingStripe(b.id, { stripeStatus: 'paid', paidAt: new Date().toISOString() });
        out.paid++;
      } else if (s === 'expired') {
        await data.setBookingStripe(b.id, { stripeStatus: 'expired' });
        out.expired++;
      }
    } catch (e) {
      out.errors.push(`#${b.id}: ${String((e as Error).message ?? e)}`);
    }
  }
  revalidatePath('/multical');
  revalidatePath('/bookings');
  return out;
}

// Send a guest-journey email (pre-arrival / day-after / post-stay / review chase)
// and stamp the matching CRM stage as 'message_sent'.
export async function sendGuestEmailAction(
  bookingId: number,
  stage: import('./messaging').GuestEmailStage
): Promise<{ ok: boolean; error?: string; lockCode?: string | null }> {
  try {
    const { guestEmail, lockCodeFor, STAGE_CRM_FIELD } = await import('./messaging');
    const b = await data.getBooking(bookingId);
    if (!b) return { ok: false, error: 'booking not found' };
    if (!b.email) return { ok: false, error: 'booking has no guest email — add one first' };

    const property = await data.getProperty(b.propertyId);
    const lockCode = stage === 'pre' ? lockCodeFor(b.channelRef) : null;
    const { subject, text } = guestEmail(stage, {
      guestName: b.guestName,
      propertyName: property?.name ?? 'our property',
      physicalRoom: b.physicalRoom,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      channel: b.channel,
      channelRef: b.channelRef,
      lockCode,
    });
    await sendEmail(b.email, subject, text);

    const f = STAGE_CRM_FIELD[stage];
    await data.upsertCrm(bookingId, {
      [f.status]: 'message_sent',
      [f.date]: new Date().toISOString().slice(0, 10),
    });
    revalidatePath('/crm');
    return { ok: true, lockCode };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

// Update CRM tracking fields; auto-stamps stage dates when a call is marked done.
export async function updateCrmAction(bookingId: number, fields: Record<string, unknown>) {
  const today = new Date().toISOString().slice(0, 10);
  const f = { ...fields };
  if (f.preStayCall === 'done' && !f.preStayDate) f.preStayDate = today;
  if (f.midStayCall === 'done' && !f.msDate) f.msDate = today;
  if (f.firstContact === 'done' && !f.fcDate) f.fcDate = today;
  if (f.secondContact === 'done' && !f.scDate) f.scDate = today;
  if (f.review === 'received' && !f.reviewDate) f.reviewDate = today;
  await data.upsertCrm(bookingId, f);
  revalidatePath('/crm');
}

export async function updateExtrasAction(id: number, taskStatus: string) {
  await data.setExtrasTaskStatus(id, taskStatus);
  revalidatePath('/crm');
}

export async function updateExtraAction(id: number, fields: { taskStatus: string }) {
  await data.setExtrasTaskStatus(id, fields.taskStatus);
  revalidatePath('/crm');
  revalidatePath('/tasks');
}

export async function markSyncJob(id: number, status: 'done' | 'failed', note?: string) {
  await data.setSyncJobStatus(id, status, note);
  revalidatePath('/sync');
  revalidatePath('/');
}

export async function markSyncJobs(ids: number[], status: 'done' | 'failed') {
  await data.setSyncJobsStatus(ids, status);
  revalidatePath('/sync');
  revalidatePath('/');
}

export async function updateRoomTypeIds(roomTypeId: number, bdcRoomId: string, expediaName: string) {
  await data.updateRoomType(roomTypeId, bdcRoomId || null, expediaName || null);
  revalidatePath('/properties');
}

export async function updatePropertyIds(propertyId: string, bdcHotelId: string, expediaHotelId: string) {
  await data.updateProperty(propertyId, bdcHotelId || null, expediaHotelId || null);
  revalidatePath('/properties');
}

export async function createExtrasRequestAction(bookingId: number, extraId: string) {
  await data.insertExtrasRequest(bookingId, extraId);
  revalidatePath('/extras-cal');
}

export async function deleteExtrasRequestAction(id: number) {
  await data.deleteExtrasRequest(id);
  revalidatePath('/extras-cal');
}
