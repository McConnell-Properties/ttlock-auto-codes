#!/usr/bin/env python3
"""
push_to_sheets.py — Turso (via CMS export API) → Google Sheets "Reservation Data" tab.

Reads the tab's existing header row and writes CMS values to matching columns only.
Never reorders or removes existing columns — safe for the CRM-Dashboard GAS which
reads by fixed column index. New CMS fields are appended at the right edge if their
header is not already present.

Env vars (set in scripts/.env or environment):
  CHANNEL_MANAGER_URL        e.g. https://mcconnell-cm.vercel.app
  CM_API_KEY                 Bearer token for /api/reservations/export
  SPREADSHEET_ID             Google Sheets ID
  GOOGLE_SERVICE_ACCOUNT_JSON  Service account JSON as a single-line string
"""

import json
import os
import sys
import requests
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CHANNEL_MANAGER_URL = os.environ['CHANNEL_MANAGER_URL'].rstrip('/')
CM_API_KEY          = os.environ['CM_API_KEY']
SPREADSHEET_ID      = os.environ['SPREADSHEET_ID']
SA_JSON             = os.environ['GOOGLE_SERVICE_ACCOUNT_JSON']
TAB_NAME            = 'Reservation Data'

# Sheet header → CMS field name.
# Keys must exactly match the header cells in the Sheet (case-sensitive).
# Add a line here when a new header is introduced to the Sheet.
HEADER_MAP = {
    # Core booking fields
    'id':                       'id',
    'Booking reference':        'channelRef',
    'Booked':                   'createdAt',
    'Property name':            'propertyName',
    'Channel name':             'channel',
    'Guest Name':               'guestName',
    'Guest first name':         '_guestFirstName',
    'Guest last name':          '_guestLastName',
    'Guest email':              'email',
    'Guest phone number':       'phone',
    'Check in date':            'checkIn',
    'Check out date':           'checkOut',
    'Status':                   'status',
    'Room types':               'roomTypeName',
    'Rooms':                    'physicalRoom',
    'Notes':                    'notes',
    'Number of Rooms':          'units',
    'Number of adults':         'adults',
    'Number of children':       'children',
    'Payment total':            'totalPrice',
    # Stripe
    'stripe_session_id':        'stripeSessionId',
    'stripe_payment_url':       'stripePaymentUrl',
    'stripe_status':            'stripeStatus',
    'stripe_timestamp':         'paidAt',
    # CRM / pre-arrival
    'Arrival time':             'arrivalTime',
    'Contact method':           'contactMethod',
    'Contact value':            'contactValue',
    'Card saved':               'cardSaved',
    'Pre-arrival completed':    'preArrivalCompletedAt',
    'Confirmed at':             'confirmedAt',
    'Pre-arrival notes':        'preArrivalNotes',
    # Deposit
    'Deposit status':           'depositStatus',
    'Deposit amount':           'depositAmount',
    'Deposit mode':             'depositMode',
}


def fetch_reservations():
    resp = requests.get(
        f'{CHANNEL_MANAGER_URL}/api/reservations/export',
        headers={'Authorization': f'Bearer {CM_API_KEY}'},
        timeout=30,
    )
    if resp.status_code == 503:
        print('FAIL: 503 — CM_API_KEY not set in Vercel env. Flag to Charlie.')
        sys.exit(1)
    if resp.status_code == 401:
        print('FAIL: 401 — CM_API_KEY mismatch. Check .env CM_API_KEY value.')
        sys.exit(1)
    resp.raise_for_status()
    data = resp.json()
    return data['reservations']


def get_sheet():
    sa_info = json.loads(SA_JSON)
    scopes = ['https://www.googleapis.com/auth/spreadsheets']
    creds = Credentials.from_service_account_info(sa_info, scopes=scopes)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID).worksheet(TAB_NAME)


def resolve_value(row: dict, field: str) -> str:
    if field == '_guestFirstName':
        name = row.get('guestName') or ''
        return name.split()[0] if name.split() else ''
    if field == '_guestLastName':
        name = row.get('guestName') or ''
        parts = name.split()
        return ' '.join(parts[1:]) if len(parts) > 1 else ''
    val = row.get(field)
    if val is None:
        return ''
    return str(val)


def push(reservations, sheet):
    # Read existing headers — only write to columns already in the sheet
    header_row = sheet.row_values(1)

    # Build col-index map (1-based → 0-based for list indexing)
    col_idx = {h: i for i, h in enumerate(header_row)}
    n_cols = len(header_row)

    # Build data rows
    data_rows = []
    for res in reservations:
        row = [''] * n_cols
        for header, field in HEADER_MAP.items():
            if header in col_idx:
                row[col_idx[header]] = resolve_value(res, field)
        data_rows.append(row)

    # Clear existing data (keep header) and write fresh
    if len(header_row) > 0:
        last_col_letter = gspread.utils.rowcol_to_a1(1, n_cols)[:-1]
        sheet.batch_clear([f'A2:{last_col_letter}'])

    if data_rows:
        sheet.update(f'A2', data_rows, value_input_option='USER_ENTERED')

    print(f'  Wrote {len(data_rows)} rows × {n_cols} columns to "{TAB_NAME}"')


def main():
    print('Fetching reservations from CMS...')
    reservations = fetch_reservations()
    print(f'  {len(reservations)} reservations received')

    print('Connecting to Google Sheets...')
    sheet = get_sheet()

    print(f'Writing to "{TAB_NAME}"...')
    push(reservations, sheet)
    print('Done.')


if __name__ == '__main__':
    main()
