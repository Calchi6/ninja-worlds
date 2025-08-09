// simulate.js
// Usage: node simulate.js --url https://<your-gh-pages-url>/ninja-worlds/ --iters 200

const puppeteer = require('puppeteer');

function arg(name, def) {
  const ix = process.argv.indexOf(name);
  if (ix === -1) return def;
  const v = process.argv[ix + 1];
  return v ?? def;
}

const URL = arg('--url', 'http://127.0.0.1:8080/index.html'); // or your GH Pages URL
const ITERS = parseInt(arg('--iters', '200'), 10);
const RUN_SECONDS = parseFloat(arg('--seconds', '12'));

function randIn(base, pct) {
  // +/- pct% around base
  const span = base * pct;
  return base + (Math.random() * 2 - 1) * span;
}

function randomConfig(best) {
  // Start near "best" (or default known-good)
  const seed = best || { RUN: 260, AIR_ACCEL: 1100, RUN_DECEL: 2400, JUMP_V: 420, GRAV: 980 };
  return {
    RUN:       Math.max(120, randIn(seed.RUN, 0.35)),
    AIR_ACCEL: Math.max(300, randIn(seed.AIR_ACCEL, 0.50)),
    RUN_DECEL: Math.max(600, randIn(seed.RUN_DECEL, 0.45)),
    JUMP_V:    Math.max(220, randIn(seed.JUMP_V, 0.35)),
    GRAV:      Math.max(500, randIn(seed.GRAV, 0.35)),
  };
}

function fitnessSample(s) {
  // Score: coins (heavily), distance, stayed alive
  // tweak weights as you like
  const aliveBonus = s.hp > 0 ? 200 : 0;
  return s.coins * 300 + s.x * 0.6 + aliveBonus;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1280, height: 720 } });

  let bestCfg = null;
  let bestScore = -Infinity;

  for (let i = 1; i <= ITERS; i++) {
    const page = await browser.newPage();

    // Go to the game
    await page.goto(URL, { waitUntil: ['domcontentloaded', 'networkidle0'] });

    // Start the run (click "Play")
    await page.waitForSelector('#new', { timeout: 15000 });
    await page.click('#new');

    // Apply a random config to MOVE (your game exposes MOVE at window scope).
    const cfg = randomConfig(bestCfg);
    await page.evaluate((cfg) => {
      // Mutate physics
      for (const k in cfg) { if (window.MOVE && k in window.MOVE) window.MOVE[k] = cfg[k]; }
      // Reset player on ground near start for consistency
      if (window.L && window.P) {
        window.P.x = 80;
        window.P.y = window.L.groundY - window.P.h - 2;
        window.P.vx = 0; window.P.vy = 0; window.P.hp = 3; window.P.coins = 0;
      }
    }, cfg);

    // Dumb bot: hold RIGHT, sometimes jump/attack
    const holdRight = async () => page.keyboard.down('ArrowRight');
    const releaseRight = async () => page.keyboard.up('ArrowRight');
    await holdRight();

    const t0 = Date.now();
    let jumps = 0, attacks = 0;

    while ((Date.now() - t0) / 1000 < RUN_SECONDS) {
      // Jump every ~700–1100ms if grounded recently (approx)
      if ((Date.now() - t0) % 900 < 40 && jumps < 30) {
        await page.keyboard.down('Space'); await page.waitForTimeout(60); await page.keyboard.up('Space'); jumps++;
      }
      // Attack sometimes
      if ((Date.now() - t0) % 1200 < 30 && attacks < 20) {
        await page.keyboard.down('KeyJ'); await page.waitForTimeout(40); await page.keyboard.up('KeyJ'); attacks++;
      }
      // If died, stop early
      const dead = await page.evaluate(() => !!document.querySelector('#gameOverDlg:not(.hidden)'));
      if (dead) break;
      await page.waitForTimeout(40);
    }

    await releaseRight();

    // Read out stats
    const stats = await page.evaluate(() => {
      return {
        x: (window.P?.x ?? 0),
        coins: (window.P?.coins ?? 0),
        hp: (window.P?.hp ?? 0),
        enemies: (window.L?.enemies?.length ?? 0),
      };
    });

    const score = fitnessSample(stats);

    // Log iteration result
    console.log(
      `#${String(i).padStart(4, '0')}  score=${score.toFixed(1)}  coins=${stats.coins}  x=${stats.x.toFixed(0)}  hp=${stats.hp}  cfg=`,
      cfg
    );

    if (score > bestScore) {
      bestScore = score;
      bestCfg = cfg;
      console.log('  👉 new BEST!');
    }

    await page.close();
  }

  console.log('\n==== BEST CONFIG FOUND ====');
  console.log(JSON.stringify(bestCfg, null, 2));
  console.log('Score:', bestScore.toFixed(1));
  console.log('\nPaste these into MOVE in index.html.');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
