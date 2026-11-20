// Records the app scenes of the demo video against the live Fuji stack on localhost:4001.
// Usage: node .record-demo.mjs <outDir> <scene...>   scenes: login deposit send receive onchain withdraw after verify
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, decodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const OUT = process.argv[2];
const SCENES = process.argv.slice(3);
const APP = "http://localhost:4001";
const W = 1440, H = 810;
const keys = JSON.parse(readFileSync(join(OUT, "..", "keys.json"), "utf8"));
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const dep = JSON.parse(readFileSync(new URL("../contracts/deployments/fuji.json", import.meta.url), "utf8"));
const marksFile = join(OUT, "marks.json");
const marks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, "utf8")) : {};
mkdirSync(OUT, { recursive: true });

const cursorJs = `
addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(239,51,64,.35);border:2px solid #EF3340;z-index:2147483647;pointer-events:none;transition:transform .12s";
  document.body.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => (c.style.transform = "scale(.7)"), true);
  addEventListener("mouseup", () => (c.style.transform = ""), true);
});`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;

async function scene(name, who, fn, zoom = 1) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, colorScheme: "dark" });
  await ctx.addInitScript(cursorJs);
  if (zoom !== 1) await ctx.addInitScript((z) => addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }), zoom);
  if (who) {
    const k = keys[who];
    await ctx.addInitScript(([s, e]) => { sessionStorage.setItem("vatanta:seed", s); sessionStorage.setItem("vatanta:eoa", "demo:" + e); }, [k.seed.slice(2), k.eoa]);
  }
  const page = await ctx.newPage();
  const t0 = Date.now();
  const m = {};
  const mark = (k) => { m[k] = (Date.now() - t0) / 1000; console.log(`  [${name}] ${k} @ ${m[k].toFixed(1)}s`); };
  page.mark = mark;
  try {
    await fn(page, mark);
  } finally {
    mark("end");
    const v = page.video();
    await ctx.close();
    renameSync(await v.path(), join(OUT, `${name}.webm`));
    marks[name] = m;
    writeFileSync(marksFile, JSON.stringify(marks, null, 2));
  }
}

async function move(page, sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await sleep(250);
  return el;
}
async function click(page, sel) { const el = await move(page, sel); await el.click(); }
async function type(page, sel, text) { const el = await move(page, sel); await el.click(); await el.fill(""); await el.pressSequentially(text, { delay: 70 }); }
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await sleep(800); }
async function unlocked(page) { await page.waitForFunction(() => !document.body.innerText.includes("Unlocking your private balance") && !document.body.innerText.includes("Locked ·"), null, { timeout: 60000 }); }

const c = createPublicClient({ transport: http(env.C_RPC) });
const l1 = createPublicClient({ transport: http(env.L1_RPC) });
const funder = privateKeyToAccount(env.DEPLOYER_PK);
const cw = createWalletClient({ account: funder, transport: http(env.C_RPC), chain: { id: 43113, name: "Fuji", nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [env.C_RPC] } } } });

const run = {
  async login() {
    await scene("login", null, async (page, mark) => {
      await page.goto(APP + "/"); await settle(page); mark("loaded"); await sleep(1500);
      await click(page, "button:has-text('Unlock')"); mark("dialog"); await sleep(6000);
    });
  },
  async deposit() {
    await scene("deposit", "alice", async (page, mark) => {
      await page.goto(APP + "/"); await unlocked(page); await settle(page); mark("home");
      await sleep(1500);
      await click(page, "a:has-text('Deposit'), button:has-text('Deposit')"); await settle(page); mark("depositPage");
      await type(page, "#dep-amt", "20"); await sleep(800);
      await click(page, "button:has-text('Deposit 20 USDC')"); mark("clicked");
      await page.waitForFunction(() => /Waiting for 20/.test(document.body.innerText), null, { timeout: 60000 }); mark("waiting");
      const addr = (await page.locator("code").first().innerText()).trim();
      await sleep(1500);
      const hash = await cw.writeContract({ address: dep.usdc, abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [addr, 20_000_000n] });
      mark("funded"); console.log("  funded", addr, hash);
      await page.waitForFunction(() => /Deposited|added to your private balance|arrived/i.test(document.body.innerText) && !/Waiting for 20/.test(document.body.innerText), null, { timeout: 300000 }).catch(() => {});
      mark("done"); await sleep(2500);
      await page.goto(APP + "/"); await unlocked(page); await settle(page);
      await page.waitForFunction(() => /19\.95/.test(document.body.innerText) || true, null, { timeout: 5000 });
      await click(page, "button:has-text('Show')"); mark("balance"); await sleep(4000);
    });
  },
  async send() {
    await scene("send", "alice", async (page, mark) => {
      await page.goto(APP + "/send"); await unlocked(page); await settle(page); mark("page"); await sleep(1000);
      await type(page, "#to", keys.bob.zk); await sleep(600);
      await type(page, "#amt", "5"); await sleep(800); mark("filled");
      await click(page, "form button[type='button']:not([aria-label])"); mark("clicked");
      await page.waitForFunction(() => /Sent · send another/.test(document.body.innerText), null, { timeout: 180000 }).catch(() => {});
      mark("done"); await sleep(4000);
    });
  },
  async receive() {
    await scene("receive", "bob", async (page, mark) => {
      await page.goto(APP + "/"); await unlocked(page); await settle(page);
      mark("home"); await sleep(1500);
      await click(page, "button:has-text('Show')");
      await page.waitForFunction(() => /5\.00/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
      mark("shown"); await sleep(5000);
    });
  },
  async withdraw() {
    await scene("withdraw", "alice", async (page, mark) => {
      await page.goto(APP + "/withdraw"); await unlocked(page); await settle(page); mark("page"); await sleep(800);
      await type(page, "#w-amt", "2,340"); mark("big"); await sleep(1200);
      await move(page, "#plan-h"); await sleep(1500);
      await move(page, "text=Batches run"); await sleep(2500); mark("bigEnd");
      await type(page, "#w-amt", "10"); mark("ten"); await sleep(600);
      const opt = await page.locator("#w-dest option").nth(1).getAttribute("value");
      await move(page, "#w-dest"); await page.selectOption("#w-dest", opt); mark("dest"); await sleep(1500);
      await click(page, "button[aria-pressed]:has-text('Fast')"); await sleep(800);
      await click(page, "button:has-text('Schedule')"); mark("clicked");
      await page.waitForFunction(() => /scheduled to/i.test(document.body.innerText), null, { timeout: 300000 }).catch(() => {});
      mark("done"); await sleep(4000);
    }, 0.68);
  },
  async after() {
    await scene("after", "alice", async (page, mark) => {
      await page.goto(APP + "/"); await unlocked(page); await settle(page); await sleep(2500);
      await click(page, "button:has-text('Show')"); mark("shown"); await sleep(1500);
      await page.mouse.wheel(0, 380); await sleep(5000); mark("history");
    });
  },
  async verify() {
    await scene("verify", null, async (page, mark) => {
      await page.goto(APP + "/verify"); await settle(page); await sleep(4000); mark("top");
      await move(page, "text=USDC held by the bridge"); await sleep(3500);
      await move(page, "text=Crowd size by amount"); await sleep(3500);
      await move(page, "text=Recent batches"); await sleep(3500);
      await move(page, "text=Withdrawals by destination"); await sleep(4500); mark("bottom");
    }, 0.61);
  },
};

browser = await chromium.launch();
try {
  for (const s of SCENES) { console.log("scene", s); await run[s](); }
} finally {
  await browser.close();
}
