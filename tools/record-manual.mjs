/**
 * Records the user-manual video.
 *
 * Drives a real browser through the app over the Chrome DevTools Protocol,
 * captures the screen as it goes, and encodes the frames to MP4 with the
 * ffmpeg binary that ships as a dev dependency. Nothing is faked: every click
 * in the video is a real click, so the manual cannot drift from the product —
 * re-run it after a UI change and the video is current again.
 *
 *   node tools/record-manual.mjs [--base http://localhost:3000] [--out path/to/video.mp4]
 *
 * Needs the app running (npm run dev / npm start) and Chrome started with
 * --remote-debugging-port=9222, or it launches its own headless Chrome.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = argOf('base', 'http://localhost:3000');
// Lives in the marketing site's public folder so one copy serves both the
// docs link and the website's walkthrough section.
const OUT = path.resolve(ROOT, argOf('out', path.join('apps', 'site', 'public', 'user-manual.mp4')));
const EMAIL = argOf('email', process.env.AUTH_EMAIL ?? 'ganeshmesta1234@gmail.com');
const PASSWORD = argOf('password', process.env.AUTH_PASSWORD ?? 'Ganesh@123');
const WIDTH = 1440;
const HEIGHT = 900;

const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-manual-'));
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// --- Chrome ----------------------------------------------------------------

async function chromeReady() {
  try {
    const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let chromeProcess = null;
if (!(await chromeReady())) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome not found. Set CHROME_PATH, or start Chrome with --remote-debugging-port=9222.');
  chromeProcess = spawn(
    exe,
    [
      '--headless=new',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=9222',
      `--user-data-dir=${path.join(frameDir, 'profile')}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--no-first-run',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );
  for (let i = 0; i < 30 && !(await chromeReady()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await chromeReady())) throw new Error('Chrome did not expose a debugging port.');
}

// --- CDP plumbing ----------------------------------------------------------

const version = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
const frames = [];
let capturing = false;
let sessionId = null;

ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pending.has(x.id)) {
    const p = pending.get(x.id);
    pending.delete(x.id);
    x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result);
    return;
  }
  if (x.method === 'Page.screencastFrame') {
    const { data, sessionId: frameSession, metadata } = x.params;
    if (capturing) {
      const file = path.join(frameDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, at: metadata.timestamp ? metadata.timestamp * 1000 : Date.now() });
    }
    send('Page.screencastFrameAck', { sessionId: frameSession }).catch(() => {});
  }
};

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const n = ++msgId;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(n)) {
        pending.delete(n);
        reject(new Error(`timeout ${method}`));
      }
    }, 30000);
  });
}
const browserSend = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++msgId;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => {
      if (pending.has(n)) {
        pending.delete(n);
        reject(new Error(`timeout ${method}`));
      }
    }, 30000);
  });

const { browserContextId } = await browserSend('Target.createBrowserContext', { disposeOnDetach: false });
const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank', browserContextId });
({ sessionId } = await browserSend('Target.attachToTarget', { targetId, flatten: true }));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return null;
  return r.result.value;
};

// --- on-screen furniture: a cursor you can see, and captions ---------------

/**
 * A headless capture has no mouse pointer, and a video of a UI where things
 * happen with no visible cause is hard to follow. This injects a pointer that
 * tracks the synthetic events, a ripple on click, and the caption bar.
 */
const OVERLAY = `(() => {
  if (window.__manualOverlay) return 'already';
  const style = document.createElement('style');
  style.textContent = \`
    #manual-cursor { position: fixed; width: 22px; height: 22px; margin: -3px 0 0 -3px; z-index: 2147483647;
      pointer-events: none; transition: transform 60ms linear; }
    #manual-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 2px solid #38bdf8; z-index: 2147483646; pointer-events: none; opacity: 0; }
    #manual-caption { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483645; pointer-events: none;
      padding: 18px 28px 20px; background: linear-gradient(to top, rgba(4,6,11,0.96), rgba(4,6,11,0.86) 62%, rgba(4,6,11,0));
      font-family: ui-sans-serif, system-ui, 'Segoe UI', sans-serif; opacity: 0; transition: opacity 260ms ease; }
    #manual-caption .chapter { font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #38bdf8; font-weight: 700; }
    #manual-caption .title { font-size: 21px; font-weight: 650; color: #fff; margin-top: 3px; }
    #manual-caption .line { font-size: 14px; color: #cbd5e1; margin-top: 5px; max-width: 70ch; line-height: 1.5; }
    #manual-keys { position: fixed; left: 50%; top: 22px; transform: translateX(-50%); z-index: 2147483645;
      display: flex; gap: 6px; pointer-events: none; opacity: 0; transition: opacity 160ms ease; }
    #manual-keys span { background: rgba(9,12,18,.94); border: 1px solid rgba(56,189,248,.5); color: #e2e8f0;
      border-radius: 7px; padding: 5px 11px; font: 600 13px ui-monospace, monospace; box-shadow: 0 6px 20px rgba(0,0,0,.5); }
    #manual-title-card { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
      background: #05070c; opacity: 0; transition: opacity 400ms ease; pointer-events: none;
      font-family: ui-sans-serif, system-ui, sans-serif; text-align: center; }
    #manual-title-card h1 { font-size: 44px; color: #fff; font-weight: 700; margin: 0; }
    #manual-title-card p { font-size: 18px; color: #94a3b8; margin-top: 12px; }
  \`;
  document.head.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = 'manual-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 2l14 9-6 1.4L15.6 20 12.8 21 10 13.6 5 18z" fill="#fff" stroke="#0b1220" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const ripple = document.createElement('div');
  ripple.id = 'manual-ripple';
  const caption = document.createElement('div');
  caption.id = 'manual-caption';
  caption.innerHTML = '<div class="chapter"></div><div class="title"></div><div class="line"></div>';
  const keys = document.createElement('div');
  keys.id = 'manual-keys';
  const card = document.createElement('div');
  card.id = 'manual-title-card';
  card.innerHTML = '<div><h1></h1><p></p></div>';
  document.body.append(cursor, ripple, caption, keys, card);

  const place = (x, y) => { cursor.style.transform = \`translate(\${x}px, \${y}px)\`; };
  place(window.innerWidth / 2, window.innerHeight / 2);
  window.addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true);
  window.addEventListener('mousedown', (e) => {
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    ripple.animate(
      [{ opacity: .9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }],
      { duration: 480, easing: 'ease-out' },
    );
  }, true);

  window.__manualOverlay = {
    caption(chapter, title, line) {
      caption.querySelector('.chapter').textContent = chapter;
      caption.querySelector('.title').textContent = title;
      caption.querySelector('.line').textContent = line || '';
      caption.style.opacity = title ? '1' : '0';
    },
    keys(list) {
      keys.innerHTML = (list || []).map((k) => '<span>' + k + '</span>').join('');
      keys.style.opacity = list && list.length ? '1' : '0';
    },
    card(title, subtitle) {
      card.querySelector('h1').textContent = title || '';
      card.querySelector('p').textContent = subtitle || '';
      card.style.opacity = title ? '1' : '0';
    },
  };
  return 'ready';
})()`;

const overlay = {
  install: () => ev(OVERLAY),
  caption: (chapter, title, line) =>
    ev(`window.__manualOverlay && window.__manualOverlay.caption(${JSON.stringify(chapter)}, ${JSON.stringify(title)}, ${JSON.stringify(line ?? '')})`),
  keys: (list) => ev(`window.__manualOverlay && window.__manualOverlay.keys(${JSON.stringify(list ?? [])})`),
  card: (title, subtitle) =>
    ev(`window.__manualOverlay && window.__manualOverlay.card(${JSON.stringify(title ?? '')}, ${JSON.stringify(subtitle ?? '')})`),
};

// --- input that looks human ------------------------------------------------

let mouseX = WIDTH / 2;
let mouseY = HEIGHT / 2;

async function moveTo(x, y, steps = 18) {
  const fromX = mouseX;
  const fromY = mouseY;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    mouseX = fromX + (x - fromX) * eased;
    mouseY = fromY + (y - fromY) * eased;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mouseX, y: mouseY, button: 'none', buttons: 0 });
    await sleep(14);
  }
  mouseX = x;
  mouseY = y;
}

async function clickAt(x, y, { settle = 450 } = {}) {
  await moveTo(x, y);
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(settle);
}

/** Centre of an element, so the pointer visibly travels to what it clicks. */
async function centreOf(selector) {
  const box = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  return box;
}

async function clickSelector(selector, opts) {
  const box = await centreOf(selector);
  if (!box) {
    console.warn('  (skipped, not on screen:', selector, ')');
    return false;
  }
  await clickAt(box.x, box.y, opts);
  return true;
}

/**
 * Click whichever button carries this text. When a dialog is open the search
 * stays inside it: the page behind a modal still matches a text search, which
 * is how a click meant for the gallery can land on the dashboard underneath.
 */
async function clickText(text, opts) {
  const box = await ev(`(() => {
    const scope = document.querySelector('[role=dialog]') || document;
    const el = [...scope.querySelectorAll('button, a')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}) && b.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) {
    console.warn('  (skipped, no button reading:', text, ')');
    return false;
  }
  await clickAt(box.x, box.y, opts);
  return true;
}

async function dragTo(fromX, fromY, toX, toY, { button = 'left', modifiers = 0, steps = 20 } = {}) {
  await moveTo(fromX, fromY);
  const buttons = button === 'middle' ? 4 : 1;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button, buttons, clickCount: 1, modifiers });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    mouseX = x;
    mouseY = y;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons, modifiers });
    await sleep(22);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button, buttons: 0, modifiers });
  mouseX = toX;
  mouseY = toY;
}

async function press(code, key, vk, text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text });
  await sleep(60);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

async function typeText(value) {
  for (const ch of value) {
    await send('Input.insertText', { text: ch });
    await sleep(45);
  }
}

async function wheel(x, y, deltaY, times = 3) {
  await moveTo(x, y);
  for (let i = 0; i < times; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, button: 'none' });
    await sleep(140);
  }
  await sleep(500);
}

/** Show a caption, hold it long enough to read, then run the demonstration. */
async function chapter(number, total, title, line, keys, body) {
  console.log(`  chapter ${number}/${total}: ${title}`);
  await overlay.caption(`Chapter ${number} of ${total}`, title, line);
  await overlay.keys(keys);
  await sleep(2100);
  if (body) await body();
  await overlay.keys([]);
  await sleep(700);
}

// --- the lesson ------------------------------------------------------------

console.log('Recording the user manual…');
console.log('  frames ->', frameDir);

await send('Page.navigate', { url: `${BASE}/login` });
await sleep(3500);
await overlay.install();

await send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
capturing = true;

// Title card
await overlay.card('Interior Studio', 'A complete walkthrough: create, modify, furnish, share');
await sleep(2600);
await overlay.card('', '');
await sleep(600);

const TOTAL = 13;

await chapter(1, TOTAL, 'Signing in', 'Your studio is behind a login. Clients never need one — they open a link you send.', null, async () => {
  await clickSelector('input[type=email]');
  await typeText(EMAIL);
  await sleep(300);
  await clickSelector('input[type=password]');
  await typeText(PASSWORD);
  await sleep(400);
  await clickText('Sign in', { settle: 1200 });
  await sleep(4500);
  await overlay.install();
  // The first-run tour card is a feature of its own; it gets its own chapter
  // rather than appearing over someone else's lesson.
  await ev("localStorage.setItem('interior.tour.seen.v1','1')");
  await overlay.caption('Chapter 1 of 13', 'Signing in', 'Your projects, templates and client links live here.');
  await sleep(1400);
});

await chapter(2, TOTAL, 'Creating a project', 'Start from a ready-made 1, 2 or 3 BHK plan — or an empty floor — and compare them side by side.', null, async () => {
  await clickText('New project', { settle: 1400 });
  await sleep(900);
  await clickText('3 BHK apartment', { settle: 1500 });
  await sleep(1200);
  await overlay.caption('Chapter 2 of 13', 'Compare before you commit', 'Footprint, carpet area, a room-by-room breakdown and what comes furnished.');
  await sleep(2600);
  await clickText('Use this plan', { settle: 2000 });
  for (let i = 0; i < 30; i++) {
    await sleep(1200);
    if (await ev("location.pathname.indexOf('/editor')===0 && !!document.querySelector('canvas')")) break;
  }
  await sleep(2500);
  await overlay.install();
});

await chapter(3, TOTAL, 'Finding your way around', 'Scroll to zoom toward the cursor. Hold Space and drag to pan. Press F to fit the drawing.', ['Space', 'F'], async () => {
  await wheel(720, 440, -220, 3);
  await sleep(600);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await dragTo(820, 470, 620, 380);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(700);
  await press('KeyF', 'f', 70, 'f');
  await sleep(1400);
});

await chapter(4, TOTAL, 'Adding objects', 'Pick a piece from the catalogue, then click where it goes. Every item is at its real size.', null, async () => {
  await clickSelector('[data-tour="tab-furniture"]', { settle: 700 });
  await clickSelector('input[placeholder*="Search furniture"]', { settle: 300 });
  await typeText('recliner');
  await sleep(900);
  await clickSelector('[data-tour="furniture-grid"] button', { settle: 900 });
  await clickAt(560, 620, { settle: 1400 });
  await sleep(900);
});

await chapter(5, TOTAL, 'Moving and rotating', 'Drag to move. Arrow keys nudge. [ and ] rotate by 15°, and the properties panel takes exact numbers.', ['[', ']', '↑ ↓ ← →'], async () => {
  await dragTo(560, 620, 610, 585);
  await sleep(800);
  await press('BracketRight', ']', 221, ']');
  await sleep(500);
  await press('BracketRight', ']', 221, ']');
  await sleep(500);
  await press('BracketRight', ']', 221, ']');
  await sleep(1200);
});

await chapter(6, TOTAL, 'Painting a wall', 'Select a wall, then click a finish in the Materials tab. Colour and finish travel together.', null, async () => {
  // Pick a wall by clicking along the outer shell.
  let selectedWall = false;
  for (const [x, y] of [[700, 205], [702, 208], [420, 300], [1000, 300]]) {
    await clickAt(x, y, { settle: 500 });
    if (await ev("/Thickness|Length/.test(document.body.innerText)")) {
      selectedWall = true;
      break;
    }
  }
  if (selectedWall) {
    await clickSelector('[data-tour="tab-materials"]', { settle: 800 });
    await overlay.caption('Chapter 6 of 13', 'Painting a wall', 'Wood, stone, metal, fabric, glass and paint — applied to whatever is selected.');
    await sleep(1200);
    await clickSelector('[data-tour="left-panel"] button:nth-of-type(6)', { settle: 1400 });
  }
  await sleep(900);
});

await chapter(7, TOTAL, 'The 3D walkthrough', 'The same model, no export step. Press 2 for 3D, 1 for the plan.', ['1', '2'], async () => {
  await clickSelector('[data-tour="view-toggle"] button:last-child', { settle: 1200 });
  await sleep(6500);
  await overlay.install();
  await overlay.caption('Chapter 7 of 13', 'The 3D walkthrough', 'Left-drag or middle-drag orbits. Shift+middle-drag pans. The wheel zooms to the cursor.');
  await dragTo(720, 450, 900, 500);
  await sleep(900);
  await wheel(720, 450, -180, 2);
  await sleep(900);
});

await chapter(8, TOTAL, 'Viewpoints and lighting', 'Jump to top-down or isometric, and relight the scene from daylight to evening.', ['Numpad 1 3 7'], async () => {
  await clickSelector('[data-tour="camera-presets"] button:nth-of-type(2)', { settle: 2200 });
  await clickSelector('[data-tour="camera-presets"] button:nth-of-type(3)', { settle: 2200 });
  await ev("(() => { const s = document.querySelector('select'); if (!s) return; s.value = 'evening'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(2200);
  await ev("(() => { const s = document.querySelector('select'); if (!s) return; s.value = 'daylight'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(1500);
});

await chapter(9, TOTAL, 'Precise moves, Blender style', 'Select a piece, press G, lock an axis with X or Y, type the distance, press Enter.', ['G', 'R', 'S', 'X', 'Y'], async () => {
  // Select something in the 3D view first.
  for (const [x, y] of [[700, 470], [660, 500], [760, 450], [620, 520]]) {
    await clickAt(x, y, { settle: 500 });
    if (await ev("/Footprint/.test(document.body.innerText)")) break;
  }
  await moveTo(700, 450);
  await press('KeyG', 'g', 71, 'g');
  await sleep(700);
  await moveTo(820, 470, 22);
  await sleep(900);
  await press('KeyX', 'x', 88, 'x');
  await sleep(800);
  await press('Digit1', '1', 49, '1');
  await sleep(1400);
  await press('Enter', 'Enter', 13);
  await sleep(1400);
});

await chapter(10, TOTAL, 'Exporting', 'A PNG of the current view, or the whole project as JSON to archive or hand over.', ['Ctrl + S'], async () => {
  await clickSelector('[data-tour="view-toggle"] button:first-child', { settle: 1500 });
  await sleep(1200);
  await overlay.install();
  await clickSelector('[data-tour="export"] button', { settle: 900 });
  await overlay.caption('Chapter 10 of 13', 'Exporting and importing', 'Import reads a JSON file back in as a new project — it never overwrites the one you have open.');
  await sleep(2600);
  await press('Escape', 'Escape', 27);
  await sleep(600);
});

await chapter(11, TOTAL, 'Sharing with a client', 'A read-only link: no editing, no download, no printing — watermarked, with an expiry and an optional passcode.', null, async () => {
  await clickSelector('[data-tour="share"]', { settle: 1200 });
  await sleep(800);
  await clickSelector('[role=dialog] input', { settle: 300 });
  await typeText('Mrs. Sharma');
  await sleep(700);
  await overlay.caption('Chapter 11 of 13', 'Sharing with a client', 'Choose what they can do, when the link stops working, and whether it needs a passcode.');
  await sleep(2400);
  await clickText('Create client link', { settle: 3000 });
  await sleep(2000);
  await overlay.caption('Chapter 11 of 13', 'Sharing with a client', 'Copy the link and send it. They open it in any browser, with no account.');
  await sleep(2600);
  const link = await ev("(document.querySelector('[role=dialog] input[readonly]')||{}).value");
  if (link) {
    await send('Page.navigate', { url: link });
    await sleep(9000);
    await overlay.install();
    await overlay.caption('Chapter 11 of 13', 'What the client sees', 'Watermarked, read-only, with a room-by-room summary — and no way to edit, export or print.');
    await sleep(4000);
  }
});

await chapter(12, TOTAL, 'The guided tour inside the app', 'Press ? for the shortcut list, then "Take the tour" — every tool in order, with Skip and Back at each step.', ['?'], async () => {
  await send('Page.navigate', { url: `${BASE}/` });
  await sleep(4000);
  await overlay.install();
  await ev("[...document.querySelectorAll('a')].find(a=>(a.getAttribute('href')||'').indexOf('/editor')===0).click()");
  for (let i = 0; i < 25; i++) {
    await sleep(1200);
    if (await ev("location.pathname.indexOf('/editor')===0 && !!document.querySelector('canvas')")) break;
  }
  await sleep(3000);
  await overlay.install();
  await overlay.caption('Chapter 12 of 13', 'The guided tour inside the app', 'Every tool gets a stop of its own — leave at any point, or come back to it later.');
  await clickSelector('[data-tour="help"]', { settle: 1200 });
  await clickText('Take the tour', { settle: 1800 });
  for (let i = 0; i < 4; i++) {
    await sleep(1700);
    await clickSelector('.driver-popover-next-btn', { settle: 500 });
  }
  await sleep(1200);
  await press('Escape', 'Escape', 27);
  await sleep(900);
});

await chapter(13, TOTAL, 'Where to go next', 'Every tool has a guided tour inside the app: press ? and choose "Take the tour".', ['?'], async () => {
  await sleep(1200);
});

await overlay.caption('', '', '');
await overlay.card('That is the whole workflow', 'Create · furnish · walk through · share');
await sleep(3200);

capturing = false;
await send('Page.stopScreencast');
console.log(`  captured ${frames.length} frames`);

// --- encode ----------------------------------------------------------------

if (frames.length < 10) throw new Error('Not enough frames captured — is the app running?');

// Real per-frame durations, so the video plays back at the speed it was driven.
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1];
  const duration = Math.min(Math.max(((next ? next.at : frames[i].at + 400) - frames[i].at) / 1000, 1 / 30), 2);
  lines.push(`file '${frames[i].file.replace(/\\/g, '/')}'`);
  lines.push(`duration ${duration.toFixed(3)}`);
}
lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
const listFile = path.join(frameDir, 'frames.txt');
fs.writeFileSync(listFile, lines.join('\n'));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const result = spawnSync(
  ffmpegPath,
  [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-vf', 'fps=24,format=yuv420p,scale=1440:-2',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '26',
    '-movflags', '+faststart',
    OUT,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
);

if (result.status !== 0) {
  console.error(result.stderr?.split('\n').slice(-12).join('\n'));
  throw new Error('ffmpeg failed');
}

const size = fs.statSync(OUT).size;
console.log(`\n  ${OUT}`);
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB\n`);

ws.close();
if (chromeProcess) {
  chromeProcess.kill();
  // Chrome holds its profile directory open for a moment after it exits.
  await sleep(1500);
}
try {
  fs.rmSync(frameDir, { recursive: true, force: true });
} catch {
  console.warn('  (left frames behind in', frameDir, ')');
}
process.exit(0);
