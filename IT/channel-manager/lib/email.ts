// Gmail sender (same app-password approach as the existing pipeline).
// Requires GMAIL_USER + GMAIL_APP_PASSWORD in .env.
import nodemailer from 'nodemailer';

export async function sendEmail(to: string, subject: string, text: string) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set in .env');
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transporter.sendMail({ from: user, to, subject, text });
}

export function paymentEmailBody(opts: {
  guestName: string;
  propertyName: string;
  roomTypeName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  total: number;
  url: string;
  expiresHours: number;
}) {
  return [
    `Dear ${opts.guestName},`,
    ``,
    `Thank you for your reservation with ${opts.propertyName}.`,
    ``,
    `Stay details:`,
    `  Check-in:  ${opts.checkIn} (from 15:00)`,
    `  Check-out: ${opts.checkOut} (by 11:00)`,
    `  ${opts.nights} night${opts.nights > 1 ? 's' : ''}${opts.roomTypeName ? ` — ${opts.roomTypeName}` : ''}`,
    `  Total: £${opts.total.toFixed(2)}`,
    ``,
    `Please complete your payment securely via Stripe using the link below:`,
    ``,
    `  ${opts.url}`,
    ``,
    `The link is valid for ${opts.expiresHours} hours. Your reservation is confirmed once payment is received.`,
    ``,
    `If you have any questions, just reply to this email.`,
    ``,
    `Kind regards,`,
    `${opts.propertyName}`,
  ].join('\n');
}
