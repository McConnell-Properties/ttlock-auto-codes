/**
 * Google Apps Script to export bookings from Google Sheets to bookings.csv in GitHub repository.
 * Reads columns F (check-in), G (check-out), H (reservation code), and L (guest name).
 * Stores GitHub personal access token in Script Properties as GITHUB_TOKEN.
 */
function exportBookingsToGitHub() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const owner = 'McConnell-Properties';
  const repo = 'ttlock-auto-codes';
  const filePath = 'bookings.csv';
  const branch = 'main';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; // adjust sheet name if necessary
  const values = sheet.getDataRange().getValues();
  const csvRows = [];
  csvRows.push('reservation_code,check_in,check_out,guest_name');
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const checkIn = row[5];  // Column F (0-based index 5)
    const checkOut = row[6]; // Column G (0-based index 6)
    const reservationCode = row[7]; // Column H (0-based index 7)
    const guestName = row[11]; // Column L (0-based index 11)
    if (reservationCode || checkIn || checkOut || guestName) {
      csvRows.push([reservationCode, checkIn, checkOut, guestName].join(','));
    }
  }
  const csvContent = csvRows.join('\n');
  const contentEncoded = Utilities.base64Encode(csvContent);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  };
  let sha = null;
  try {
    const resp = UrlFetchApp.fetch(`${url}?ref=${branch}`, { 'headers': headers, 'method': 'get' });
    const data = JSON.parse(resp.getContentText());
    sha = data.sha;
  } catch (err) {
    // file does not exist, will be created
  }
  const body = {
    message: 'Automated update bookings.csv from Google Sheets',
    content: contentEncoded,
    branch: branch
  };
  if (sha) {
    body.sha = sha;
  }
  const options = {
    method: 'put',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(body)
  };
  UrlFetchApp.fetch(url, options);
}
