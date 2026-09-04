// The bundle has a budget. A single-file game that embeds its canon and fonts
// grows one feature at a time; this makes each step visible and refuses the
// one that quietly doubles it. Raise BUDGET_KB deliberately, in a commit that
// says why.
import fs from "node:fs";
import { gzipSync } from "node:zlib";
const BUDGET_KB = 420;         // raw
const BUDGET_GZIP_KB = 120;    // over the wire
const f = "dist/buster-whack.js";
if (!fs.existsSync(f)) { console.error("size-check: build first (npm run build)"); process.exit(2); }
const buf = fs.readFileSync(f);
const raw = buf.length / 1024, gz = gzipSync(buf).length / 1024;
console.log(`bundle ${raw.toFixed(1)} KB raw (budget ${BUDGET_KB}), ${gz.toFixed(1)} KB gzip (budget ${BUDGET_GZIP_KB})`);
if (raw > BUDGET_KB || gz > BUDGET_GZIP_KB) { console.error("size-check: over budget"); process.exit(1); }
