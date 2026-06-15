// Guest-journey email templates (pre-arrival, day-after, post-stay, review chase)
// + door-code lookup from the TTLock pipeline's checkin_data.json.
// Sending one marks the matching CRM stage 'message_sent' (see sendGuestEmailAction).
//
// To tweak the wording, edit the template functions below — plain text on purpose.
import fs from 'node:fs';

const CHECKIN_DATA =
  process.env.CHECKIN_DATA_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/checkin_data.json';

export type GuestEmailStage = 'pre' | 'mid' | 'post' | 'chase';

export type GuestEmailInput = {
  guestName: string;
  propertyName: string;
  physicalRoom: string | null;
  checkIn: string;
  checkOut: string;
  channel: string; // booking.com | expedia | direct | ...
  channelRef: string | null;
  lockCode: string | null;
};

// Door code from the pipeline export, keyed by booking reference (case-insensitive).
export function lockCodeFor(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CHECKIN_DATA, 'utf8'));
    const key = Object.keys(data).find((k) => k.trim().toLowerCase() === ref.trim().toLowerCase());
    return key ? data[key]?.lockCode || null : null;
  } catch {
    return null;
  }
}

const firstName = (n: string) => (n || 'Guest').trim().split(/\s+/)[0];

function reviewSite(channel: string): string | null {
  if (channel === 'booking.com') return 'Booking.com';
  if (channel === 'expedia') return 'Expedia';
  if (channel === 'airbnb') return 'Airbnb';
  return null;
}

export function guestEmail(stage: GuestEmailStage, g: GuestEmailInput): { subject: string; text: string } {
  const sign = `Kind regards,\n${g.propertyName}`;

  if (stage === 'pre') {
    const code = g.lockCode
      ? `Your door code: ${g.lockCode}\nIt's active from 15:00 on your check-in day.`
      : `We'll send your door code separately before you arrive.`;
    return {
      subject: `Your stay at ${g.propertyName} — check-in details for ${g.checkIn}`,
      text: [
        `Dear ${firstName(g.guestName)},`,
        ``,
        `We're looking forward to welcoming you on ${g.checkIn}.`,
        ``,
        `Check-in:  from 15:00 on ${g.checkIn}`,
        `Check-out: by 11:00 on ${g.checkOut}`,
        g.physicalRoom ? `Room:      ${g.physicalRoom}` : null,
        ``,
        code,
        ``,
        `If you'd like to tell us your arrival time, or have any questions before you travel, just reply to this email.`,
        ``,
        sign,
      ].filter((l) => l !== null).join('\n'),
    };
  }

  if (stage === 'mid') {
    return {
      subject: `How is your stay at ${g.propertyName}?`,
      text: [
        `Dear ${firstName(g.guestName)},`,
        ``,
        `Just checking in now that you've settled in — is everything as it should be?`,
        ``,
        `If anything isn't right (room, cleanliness, anything at all), reply to this email or give us a call and we'll sort it while you're still here.`,
        ``,
        sign,
      ].join('\n'),
    };
  }

  if (stage === 'post') {
    return {
      subject: `Thanks for staying with ${g.propertyName}`,
      text: [
        `Dear ${firstName(g.guestName)},`,
        ``,
        `Thank you for staying with us — we hope you had a comfortable stay.`,
        ``,
        `Two quick things:`,
        ``,
        `1. Any feedback? A one-line reply helps us improve.`,
        `2. If you're ever back in the area, book with us directly (just reply to this email) for our best rate — no booking-site fees.`,
        ``,
        sign,
      ].join('\n'),
    };
  }

  // chase — review request
  const site = reviewSite(g.channel);
  return {
    subject: `A small favour — ${g.propertyName}`,
    text: [
      `Dear ${firstName(g.guestName)},`,
      ``,
      `Thanks again for staying with us.`,
      ``,
      site
        ? `If you have two minutes, a review on ${site} would mean a lot — it's the main way small independent places like ours get found.`
        : `If you have two minutes, a short review wherever you found us would mean a lot — it's the main way small independent places like ours get found.`,
      ``,
      `Either way, we'd be glad to have you back.`,
      ``,
      sign,
    ].join('\n'),
  };
}

// Which CRM field each stage stamps when an email goes out.
export const STAGE_CRM_FIELD: Record<GuestEmailStage, { status: string; date: string }> = {
  pre: { status: 'preStayCall', date: 'preStayDate' },
  mid: { status: 'midStayCall', date: 'msDate' },
  post: { status: 'firstContact', date: 'fcDate' },
  chase: { status: 'secondContact', date: 'scDate' },
};
