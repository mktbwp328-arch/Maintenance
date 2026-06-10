// LINE helpers for inbound repair requests (LIFF).
// Verifies the LINE ID token so only real LINE users can submit.
const LIFF_CHANNEL_ID = process.env.LIFF_CHANNEL_ID || '';

// Returns the verified profile { sub, name, picture, email? } or null if
// verification is not configured. Throws if the token is invalid.
export async function verifyLineIdToken(idToken) {
  if (!LIFF_CHANNEL_ID) return null; // not configured -> skip verification
  if (!idToken) throw new Error('ไม่พบ LINE ID token');
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: LIFF_CHANNEL_ID }),
  });
  if (!res.ok) throw new Error('ยืนยันตัวตน LINE ไม่สำเร็จ');
  return res.json();
}

export const liffConfigured = () => Boolean(process.env.LIFF_ID);
export const liffId = () => process.env.LIFF_ID || '';
