/**
 * POST /api/purchase
 *
 * Called by the PayPal JS SDK after a successful payment capture.
 * Body: { order_id, email, name }
 *
 * Steps:
 *   1. Verify the order with PayPal's API (prevents fake requests)
 *   2. Check we haven't already issued a key for this order (idempotent)
 *   3. Generate an MMAGS- license key (HMAC, self-validating)
 *   4. Store in D1 (purchases table)
 *   5. Email the key to the buyer via Resend
 *   6. Return { ok: true, license_key }
 *
 * Env vars required:
 *   PAYPAL_CLIENT_ID    — live client ID
 *   PAYPAL_SECRET       — live secret
 *   LICENSE_HMAC_SECRET — shared with the app for offline key validation
 *   RESEND_API_KEY      — for email delivery
 */

import { json, signLicense } from '../_shared.js';

const PAYPAL_API = 'https://api-m.paypal.com';
const AMOUNT = '100.00';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid-json' }, 400);
  }

  const { order_id, email, name } = body;
  if (!order_id || !email) {
    return json({ ok: false, error: 'missing-fields' }, 400);
  }

  // ── idempotency: already issued? ─────────────────────────────────────
  try {
    const existing = await env.DB.prepare(
      'SELECT license_key FROM purchases WHERE order_id = ?'
    ).bind(order_id).first();
    if (existing) {
      return json({ ok: true, license_key: existing.license_key, resent: true });
    }
  } catch (e) {
    console.error('[purchase] idempotency check failed', e.message);
  }

  // ── verify with PayPal ────────────────────────────────────────────────
  let ppToken;
  try {
    const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'authorization': 'Basic ' + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();
    ppToken = tokenData.access_token;
  } catch (e) {
    console.error('[purchase] paypal token error', e.message);
    return json({ ok: false, error: 'paypal-auth-failed' }, 502);
  }

  let orderData;
  try {
    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${order_id}`, {
      headers: { 'authorization': `Bearer ${ppToken}` },
    });
    orderData = await orderRes.json();
  } catch (e) {
    console.error('[purchase] paypal order fetch error', e.message);
    return json({ ok: false, error: 'paypal-verify-failed' }, 502);
  }

  if (orderData.status !== 'COMPLETED') {
    return json({ ok: false, error: 'order-not-completed', status: orderData.status }, 402);
  }

  const unit = orderData.purchase_units && orderData.purchase_units[0];
  const captured = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  if (!captured || captured.amount.value !== AMOUNT) {
    return json({ ok: false, error: 'amount-mismatch' }, 402);
  }

  // ── generate license key ──────────────────────────────────────────────
  const payload = {
    type: 'perpetual',
    email: email.toLowerCase().trim(),
    name: (name || '').trim(),
    order_id,
    issued_at: new Date().toISOString(),
    product: 'mrmags',
  };

  let licenseKey;
  try {
    const token = await signLicense(payload, env.LICENSE_HMAC_SECRET);
    // Format: MMAGS-PERP-<first 32 chars of token>
    const short = token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32).toUpperCase();
    licenseKey = `MMAGS-PERP-${short}`;
  } catch (e) {
    console.error('[purchase] key gen failed', e.message);
    return json({ ok: false, error: 'key-gen-failed' }, 500);
  }

  // ── store in D1 ───────────────────────────────────────────────────────
  try {
    await env.DB.prepare(
      `INSERT INTO purchases (order_id, email, name, license_key, purchased_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(order_id, email.toLowerCase().trim(), (name || '').trim(), licenseKey, new Date().toISOString()).run();
  } catch (e) {
    console.error('[purchase] db insert failed', e.message);
    // Don't fail — still return the key; manual reconcile later
  }

  // ── email the key ─────────────────────────────────────────────────────
  if (env.RESEND_API_KEY) {
    sendPurchaseEmail({ to: email, name, licenseKey, apiKey: env.RESEND_API_KEY })
      .catch(e => console.error('[purchase] email failed', e.message));
  }

  return json({ ok: true, license_key: licenseKey });
}

async function sendPurchaseEmail({ to, name, licenseKey, apiKey }) {
  const firstName = (name || 'there').split(' ')[0];
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1a1a1a;background:#fafaf7;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:6px;padding:32px">
  <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;margin:0 0 16px">You're in. Here's your key.</h1>
  <p style="font-size:15px;line-height:1.6;color:#444">
    Hey ${firstName} — thanks for buying Mr. Mags. Your perpetual license key is below.
    Copy it and paste it into the app when it asks for a license.
  </p>
  <div style="margin:28px 0;padding:20px;background:#f5f5f2;border-radius:4px;text-align:center">
    <code style="font-family:monospace;font-size:16px;font-weight:600;color:#8c3a2c;letter-spacing:0.08em;word-break:break-all">${licenseKey}</code>
  </div>
  <p style="font-size:14px;color:#666;line-height:1.6">
    This key is yours forever — every update, every new feature, no subscription.
    Keep this email somewhere safe in case you reinstall.
  </p>
  <p style="font-size:14px;color:#666;line-height:1.6">
    Questions? Reply here or email <a href="mailto:hello@mrmags.org" style="color:#8c3a2c">hello@mrmags.org</a>.
    I read everything.
  </p>
  <p style="font-size:13px;color:#999;margin-top:24px">— Steve, MEDiAGATO</p>
</div>
<p style="text-align:center;font-size:12px;color:#aaa;margin-top:24px">
  Mr. Mags · <a href="https://mrmags.org" style="color:#8c3a2c">mrmags.org</a>
</p>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Mr. Mags <hello@mediagato.com>',
      to: [to],
      subject: 'Your Mr. Mags license key',
      html,
    }),
  });
}
