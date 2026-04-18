/**
 * upload-r2.js — Upload local MMDB files to Cloudflare R2
 *
 * Prerequisites:
 *   1. Run `npm run update-db` first to download the MMDB files
 *   2. Authenticated with Wrangler: `npx wrangler login`
 *   3. R2 bucket exists: `npx wrangler r2 bucket create ip-du-db`
 *
 * Usage:
 *   node scripts/upload-r2.js
 *   npm run upload-r2
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'data');
const BUCKET    = 'ip-du-db';

const MMDB_FILES = [
  'dbip-city-ipv4.mmdb',
  'dbip-city-ipv6.mmdb',
  'asn.mmdb',
];

async function uploadToR2() {
  console.log(`Uploading MMDB files to R2 bucket: ${BUCKET}\n`);

  let uploaded = 0;
  let skipped  = 0;

  for (const file of MMDB_FILES) {
    const filePath = join(DATA_DIR, file);

    if (!existsSync(filePath)) {
      console.warn(`  ⚠  Skipping ${file} — not found. Run: npm run update-db`);
      skipped++;
      continue;
    }

    console.log(`  ⬆  Uploading ${file}…`);
    try {
      execSync(
        `npx wrangler r2 object put ${BUCKET}/${file} --file="${filePath}"`,
        { stdio: 'inherit' },
      );
      console.log(`  ✔  ${file} uploaded\n`);
      uploaded++;
    } catch (err) {
      console.error(`  ✗  Failed to upload ${file}: ${err.message}\n`);
    }
  }

  console.log(`\n✅ Done: ${uploaded} uploaded, ${skipped} skipped.`);
  if (uploaded > 0) {
    console.log('   Redeploy your Worker for it to pick up the new databases:');
    console.log('   npm run deploy:cf');
  }
}

uploadToR2().catch(err => {
  console.error(err);
  process.exit(1);
});
