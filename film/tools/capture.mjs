// Captures real Cachet / Fieldnote / Stall screens from the local stack (npm run dev:local)
// at 2x for use as textures in the film. Usage: node tools/capture.mjs [light|dark]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const theme = process.argv[2] === 'dark' ? 'dark' : 'light';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../assets/ui', theme);
await mkdir(out, { recursive: true });

const CACHET = 'http://localhost:5173';
const FIELDNOTE = 'http://localhost:5174';
const STALL = 'http://localhost:5175';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: theme,
  reducedMotion: 'no-preference',
});
await ctx.addInitScript((t) => {
  try {
    localStorage.setItem('cachet.theme', t);
  } catch {}
}, theme);

/** Saves the published binding (and attack variants built from it) for the film to draw. */
async function dumpData(url) {
  const { default: WebSocket } = await import('ws');
  const core = await import('@cachet/core');
  const { getPublicKey } = await import('nostr-tools/pure');
  const { createHash } = await import('node:crypto');
  const npub = url.match(/npub1[02-9ac-hj-np-z]+/)[0];
  const pubkey = core.decodeNip19(npub).data;
  const event = await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:7777');
    let found;
    ws.on('open', () => ws.send(JSON.stringify(['REQ', 'f', { kinds: [10011], authors: [pubkey] }])));
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d[0] === 'EVENT') found = d[2];
      if (d[0] === 'EOSE') {
        ws.close();
        found ? resolve(found) : reject(new Error('no event'));
      }
    });
  });
  const result = core.verifyBinding(event);
  const b = result.binding;
  const sk = (label) => new Uint8Array(createHash('sha256').update(`cachet-film/${label}`).digest());
  // Steal: the attacker names this address but can only sign M with their own key.
  const stolenSig = core.signMessage(sk('attacker-bch'), b.message);
  const rec = core.recoverSigner(b.message, stolenSig);
  const attackerAddress = core.addressFromPublicKey(rec.publicKey, 'mainnet');
  // Replay: the same proof inside another npub's snapshot.
  const attackerNpub = core.npubEncode(getPublicKey(sk('attacker-nostr')));
  const data = {
    npub: b.npub,
    pubkey: b.nostrPubkey,
    cashaddr: b.cashaddr,
    bindingId: b.bindingId,
    message: b.message,
    statement: b.statement,
    bchSignature: b.bchSignature,
    bchPublicKey: b.bchPublicKey,
    eventId: event.id,
    nostrSig: event.sig,
    expiresAt: b.expiresAt,
    checks: result.checks.map((c) => ({ label: c.label, status: c.status })),
    attack: { attackerAddress, attackerNpub, stolenSig },
  };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.resolve(here, '../src/data.json'), JSON.stringify(data, null, 2));
  console.log('data', b.npub, b.cashaddr, result.ok);
}

const page = await ctx.newPage();
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(opts.settle ?? 900);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: opts.full ?? false, ...(opts.clip ? { clip: opts.clip } : {}) });
  console.log('captured', name, page.url());
};
const el = async (name, locator, settle = 700) => {
  await page.waitForTimeout(settle);
  await locator.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('captured', name);
};

// 1. Home
await page.goto(CACHET);
await page.waitForLoadState('networkidle');
await shot('home', { settle: 2600 });

// 2. Instant sandbox: dual-sign + publish
await page.goto(`${CACHET}/new?sandbox=1`);
await page.getByText('Your link is live').waitFor({ timeout: 20000 });
await shot('live', { settle: 2600 });
await el('live-card', page.locator('.cachet').first(), 400);

// 3. Profile + pay
await page.getByRole('link', { name: /Open payable profile/ }).first().click().catch(async () => {
  await page.getByText('Open payable profile').click();
});
await page.waitForURL(/\/(p|npub|profile|u)\b|npub1/, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
await shot('profile', { settle: 1500 });
await shot('profile-full', { full: true, settle: 300 });
const pay = page.locator('.pay, .paypanel, [class*="pay"]').first();
if (await pay.count()) await el('pay-panel', pay).catch(() => {});
const payPanelCard = page.locator('.c-card.panel').first();
if (theme === 'light' && (await payPanelCard.count())) {
  await page.evaluate(() => {
    const note = document.querySelector('.c-card.panel .c-note');
    if (note instanceof HTMLElement) note.style.display = 'none';
  });
  await payPanelCard.screenshot({ path: path.resolve(here, '../assets/ui/pay.png') }).catch(() => {});
  await page.evaluate(() => {
    const note = document.querySelector('.c-card.panel .c-note');
    if (note instanceof HTMLElement) note.style.display = '';
  });
  console.log('captured', 'ui/pay.png');
}
const profileUrl = page.url();
if (theme === 'light') await dumpData(profileUrl);

// 4. Fieldnote: signed out, then Sign in with Cachet (redirect flow)
const rp = async (base, name) => {
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  await shot(`${name}-out`, { settle: 1500 });
  await page.getByRole('button', { name: /Sign in with Cachet/ }).click();
  await page.waitForURL(/localhost:5173\/sign/, { timeout: 15000 });
  await page.getByRole('button', { name: /Approve & sign in/ }).waitFor({ timeout: 15000 });
  await shot(`${name}-approve`, { settle: 1600 });
  await page.getByRole('button', { name: /Approve & sign in/ }).click();
  await page.waitForURL(new RegExp(base.replace(/[.:/]/g, (c) => `\\${c}`)), { timeout: 20000 });
  await page.waitForTimeout(3500);
  await shot(`${name}-in`, { settle: 800 });
  await shot(`${name}-in-full`, { full: true, settle: 200 });
};
await rp(FIELDNOTE, 'fieldnote');
await rp(STALL, 'stall');

// 5. Withdraw on Cachet
await page.goto(profileUrl);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /^Withdraw$/ }).click();
await page.getByRole('button', { name: /Withdraw and publish/ }).click();
await page.waitForTimeout(3500);
await shot('profile-withdrawn', { settle: 800 });

// 6. Relying parties re-check and end the session
for (const [base, name] of [
  [FIELDNOTE, 'fieldnote'],
  [STALL, 'stall'],
]) {
  await page.goto(base);
  await page.waitForTimeout(2500);
  const btn = page.getByRole('button', { name: /Re-check/ });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(3000);
  }
  await shot(`${name}-ended`, { settle: 600 });
}

// 7. Lab
await page.goto(`${CACHET}/lab`);
await page.waitForTimeout(2500);
await shot('lab', { settle: 800 });
await shot('lab-full', { full: true, settle: 200 });

await browser.close();
