// Copies circuit artifacts and the deployment file into public/ so the browser can load them.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const pub = join(here, "..", "public");
mkdirSync(join(pub, "circuits"), { recursive: true });
for (const f of readdirSync(join(root, "sdk", "circuits"))) if (f.endsWith(".json")) cpSync(join(root, "sdk", "circuits", f), join(pub, "circuits", f));
const network = process.env.NEXT_PUBLIC_NETWORK ?? "local";
const dep = join(root, "contracts", "deployments", `${network}.json`);
if (existsSync(dep)) cpSync(dep, join(pub, "deployment.json"));
else console.warn(`no deployment for ${network} at ${dep}`);
console.log("assets ready");
