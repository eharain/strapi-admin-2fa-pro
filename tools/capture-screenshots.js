'use strict';

/**
 * The screenshots in docs/screenshots, taken from the real thing.
 *
 *   npm run screenshots
 *
 * The hosted account pages are captured against a running Strapi with the pages
 * switched on. Every view is driven with **stubbed API answers** rather than a
 * real account: documentation should not contain somebody's data, and a
 * screenshot of a locked-out account should not require locking one out.
 *
 * The admin-panel pages need a session. Rather than have this script ask for a
 * password, it takes an access token you already have:
 *
 *   SCREENSHOT_ADMIN_TOKEN=... npm run screenshots
 *
 * Without one it captures the hosted pages and says what it skipped.
 *
 *   SCREENSHOT_BASE_URL   where Strapi is (default http://localhost:1337)
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { chromium } = require('playwright');

const BASE = (process.env.SCREENSHOT_BASE_URL || 'http://localhost:1337').replace(/\/$/, '');
const TOKEN = process.env.SCREENSHOT_ADMIN_TOKEN || '';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

const CARD = { width: 640, height: 860 };
// Tall on purpose: the admin panel scrolls an inner container, so a full-page
// screenshot still only captures what the viewport can see.
const PANEL = { width: 1440, height: 1900 };

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** A challenge the page will accept: signed tokens are never checked client-side. */
const CHALLENGE = 'stub-challenge-for-the-screenshots';

const twoFactorRefusal = (extra = {}) =>
  json(
    {
      data: null,
      error: {
        status: 401,
        name: 'TwoFactorRequiredError',
        message: 'Enter the code from your authenticator app',
        details: {
          twoFactor: {
            required: true,
            surface: 'users',
            challenge: CHALLENGE,
            expiresIn: 180,
            methods: ['totp'],
            recoveryAvailable: true,
            enrolmentRequired: false,
            ...extra,
          },
        },
      },
    },
    401
  );

const RECOVERY_CODES = [
  'H4KP-2M9T-XQ7B',
  'R3ND-8VCJ-K5LW',
  'T7YZ-QF42-M8NP',
  'B9XW-L6HD-3RTV',
  'K2MJ-9PQY-N4CF',
  'W8DT-R5KX-7BHL',
  'P6VN-3JQM-Z9KD',
  'X4LB-M7TW-Q2NH',
  'C5RK-8DYP-V3JX',
  'N9TQ-W2MF-L7BK',
];

const ACCOUNT_STATUS = (enrolled) =>
  json({
    data: {
      enrolled,
      pendingEnrolment: false,
      method: enrolled ? 'totp' : null,
      label: null,
      confirmedAt: enrolled ? '2026-09-14T09:12:00.000Z' : null,
      lastUsedAt: enrolled ? '2026-09-20T08:41:00.000Z' : null,
      lockedUntil: null,
      recoveryCodesRemaining: enrolled ? 8 : 0,
      required: false,
      mustEnrol: false,
      shouldEnrol: false,
      graceEndsAt: null,
    },
  });

async function enrolmentPayload() {
  const otpauthUri = 'otpauth://totp/Example%20Co:sam@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Co';
  return {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUri,
    qrDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
    digits: 6,
    period: 30,
    issuer: 'Example Co',
    accountName: 'sam@example.com',
  };
}

const shots = [];

/**
 * `selector` crops to one element. The hosted pages centre a narrow card in a
 * tall viewport, and a full-page shot of that is mostly background — which in
 * a README is a picture of nothing.
 */
async function shot(page, name, note, selector) {
  const file = path.join(OUT, `${name}.png`);
  const target = selector ? page.locator(selector) : page;
  await target.screenshot({ path: file, ...(selector ? {} : { fullPage: true }) });
  shots.push({ name, note });
  console.log(`  ${name}.png — ${note}`);
}

const CARD_SELECTOR = 'main';

/** Type into a labelled field without caring how the DOM is arranged. */
const fill = (page, id, value) => page.fill(`#${id}`, value);

const decodeAttr = (value) =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const encodeAttr = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Show page options this instance does not have switched on.
 *
 * Registration and the provider buttons are decided on the server and arrive on
 * the page's data attribute, so a stubbed API answer cannot reach them. Rather
 * than turn sign-ups and Google on for real just to photograph them, the real
 * page is fetched and that one attribute is rewritten.
 */
const withPageOptions = (page, extra) =>
  page.route('**/two-factor/account', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/data-config="([^"]*)"/, (match, encoded) => {
      const config = { ...JSON.parse(decodeAttr(encoded)), ...extra };
      return `data-config="${encodeAttr(JSON.stringify(config))}"`;
    });
    await route.fulfill({ response, body: html, contentType: 'text/html; charset=utf-8' });
  });

const PROVIDERS = [
  { name: 'google', label: 'Google' },
  { name: 'github', label: 'GitHub' },
];

/**
 * The screens a site gets when it turns registration and SSO on: the sign-in
 * with provider buttons, creating an account, and the wait for the
 * confirmation email.
 */
async function captureSignUp(browser) {
  console.log('\nSign-up and providers');
  const context = await browser.newContext({ viewport: CARD, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await withPageOptions(page, { allowRegistration: true, providers: PROVIDERS });

  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#identifier');
  await shot(page, 'account-sign-in-options', 'sign-in with SSO and sign-up offered', CARD_SELECTOR);

  await page.click('text=Create an account');
  await page.waitForSelector('#username');
  await shot(page, 'account-sign-up', 'creating an account', CARD_SELECTOR);

  // A site that asks people to confirm their address answers without a token.
  await page.route('**/two-factor/account/register', (route) =>
    route.fulfill(json({ user: { id: 12, username: 'sam', email: 'sam@example.com', confirmed: false } }))
  );
  await fill(page, 'username', 'sam');
  await fill(page, 'email', 'sam@example.com');
  await fill(page, 'password', 'not-a-real-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Confirm your email');
  await shot(page, 'account-confirm-email', 'waiting on the confirmation email', CARD_SELECTOR);

  await context.close();
}

/** Changing a password from the account page. */
async function captureChangePassword(browser) {
  const context = await browser.newContext({ viewport: CARD, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.route('**/two-factor/account/login', (route) =>
    route.fulfill(json({ jwt: 'stub-jwt', user: { id: 1, email: 'sam@example.com' } }))
  );
  await page.route('**/api/two-factor/me', (route) => route.fulfill(ACCOUNT_STATUS(true)));

  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await fill(page, 'identifier', 'sam@example.com');
  await fill(page, 'password', 'not-a-real-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.status');

  await page.click('text=Change my password');
  await page.waitForSelector('#current');
  await shot(page, 'account-change-password', 'changing a password while signed in', CARD_SELECTOR);

  await context.close();
}

async function captureHostedPages(browser, enrolment) {
  console.log('\nHosted account pages');
  const context = await browser.newContext({ viewport: CARD, deviceScaleFactor: 2 });
  const page = await context.newPage();

  // 1 — signing in.
  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#identifier');
  await shot(page, 'account-sign-in', 'the sign-in page', CARD_SELECTOR);

  // 2 — the second factor. The credentials below go nowhere: the call is stubbed.
  await page.route('**/two-factor/account/login', (route) => route.fulfill(twoFactorRefusal()));
  await fill(page, 'identifier', 'sam@example.com');
  await fill(page, 'password', 'not-a-real-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('#code');
  await shot(page, 'account-two-factor', 'the code prompt, with recovery offered', CARD_SELECTOR);

  // 3 — a wrong code, so the refusal is documented too.
  await page.route('**/two-factor/challenge/verify', (route) =>
    route.fulfill(
      json({ data: null, error: { status: 401, name: 'UnauthorizedError', message: 'That code is not valid' } }, 401)
    )
  );
  await fill(page, 'code', '000000');
  await page.click('button[type=submit]');
  await page.waitForSelector('.note.error');
  await shot(page, 'account-wrong-code', 'a refusal that says what was wrong', CARD_SELECTOR);

  // 4 — enrolment forced at sign-in.
  await page.unroute('**/two-factor/account/login');
  await page.route('**/two-factor/account/login', (route) =>
    route.fulfill(twoFactorRefusal({ enrolmentRequired: true, enrolment }))
  );
  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await fill(page, 'identifier', 'sam@example.com');
  await fill(page, 'password', 'not-a-real-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.qr');
  await shot(page, 'account-enrolment', 'the QR, at sign-in, when a factor is required', CARD_SELECTOR);

  // 5 — the recovery codes, shown once.
  await page.route('**/two-factor/challenge/confirm', (route) =>
    route.fulfill(json({ data: { proof: 'stub-proof', expiresIn: 120, enrolled: true, recoveryCodes: RECOVERY_CODES } }))
  );
  await fill(page, 'code', '123456');
  await page.click('button[type=submit]');
  await page.waitForSelector('.codes');
  await shot(page, 'account-recovery-codes', 'recovery codes, shown once', CARD_SELECTOR);

  // 6 — forgetting a password.
  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await page.click('text=Forgot your password?');
  await page.waitForSelector('#email');
  await shot(page, 'account-forgot-password', 'asking for a reset link', CARD_SELECTOR);

  // 7 — setting a new one, the way the emailed link arrives.
  await page.goto(`${BASE}/two-factor/account?code=a-reset-token-from-the-email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#password');
  await shot(page, 'account-reset-password', 'the page the emailed link lands on', CARD_SELECTOR);

  // 8 — signed in, managing your own authenticator.
  await page.unroute('**/two-factor/account/login');
  await page.route('**/two-factor/account/login', (route) =>
    route.fulfill(json({ jwt: 'stub-jwt', user: { id: 1, email: 'sam@example.com' } }))
  );
  await page.route('**/api/two-factor/me', (route) => route.fulfill(ACCOUNT_STATUS(true)));
  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await fill(page, 'identifier', 'sam@example.com');
  await fill(page, 'password', 'not-a-real-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.status');
  await shot(page, 'account-manage', 'your own account, with the factor on', CARD_SELECTOR);

  await context.close();
}

/**
 * The same page on a phone, which is where it is actually read. It is also the
 * only place the "open in your authenticator app" link appears — the page shows
 * it when the primary pointer is a finger, not merely when a touchscreen
 * exists, so a laptop with one does not get a link that opens nothing.
 */
async function captureMobile(browser, enrolment) {
  console.log('\nOn a phone');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  await page.route('**/two-factor/account/login', (route) =>
    route.fulfill(twoFactorRefusal({ enrolmentRequired: true, enrolment }))
  );

  await page.goto(`${BASE}/two-factor/account`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#identifier');
  await shot(page, 'account-sign-in-mobile', 'the sign-in page on a phone', CARD_SELECTOR);

  await fill(page, 'identifier', 'sam@example.com');
  await fill(page, 'password', 'not-a-real-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.qr');
  await shot(page, 'account-enrolment-mobile', 'on a phone, where the QR can be tapped instead', CARD_SELECTOR);

  await context.close();
}

async function captureAdminPages(browser) {
  if (!TOKEN) {
    console.log('\nAdmin panel — skipped (set SCREENSHOT_ADMIN_TOKEN to include these)');
    return;
  }

  console.log('\nAdmin panel');
  const context = await browser.newContext({ viewport: PANEL, deviceScaleFactor: 2 });
  // The panel reads its access token from here on load.
  await context.addInitScript((token) => {
    try {
      window.localStorage.setItem('jwtToken', JSON.stringify(token));
    } catch {
      /* a browser with storage blocked simply shows the login page */
    }
  }, TOKEN);

  const page = await context.newPage();

  // Not networkidle: the admin keeps a live reload socket open in development,
  // so the network never goes quiet and the wait would always time out.
  await page.goto(`${BASE}/admin/settings/two-factor/me`, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: PANEL.width, height: 1000 });
  await page.waitForSelector('text=My authenticator', { timeout: 20000 });
  await page.waitForTimeout(600);
  await shot(page, 'admin-my-authenticator', 'an administrator setting up their own');

  await page.goto(`${BASE}/admin/settings/two-factor/policy`, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: PANEL.width, height: PANEL.height });
  await page.waitForSelector('text=Two-factor authentication', { timeout: 20000 });
  await page.waitForTimeout(600);
  await shot(page, 'admin-policy', 'the policy, coverage and the hosted pages');

  await context.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const response = await fetch(`${BASE}/two-factor/account`).catch(() => null);
  if (!response || response.status === 404) {
    console.error(
      `\nThe hosted pages are not being served at ${BASE}/two-factor/account.\n` +
        'Switch them on under Settings > Two-factor authentication > Policy, or set SCREENSHOT_BASE_URL.\n'
    );
    process.exit(1);
  }

  const enrolment = await enrolmentPayload();
  const browser = await chromium.launch();

  try {
    await captureHostedPages(browser, enrolment);
    await captureSignUp(browser);
    await captureChangePassword(browser);
    await captureMobile(browser, enrolment);
    await captureAdminPages(browser);
  } finally {
    await browser.close();
  }

  console.log(`\n${shots.length} screenshot(s) in docs/screenshots\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
