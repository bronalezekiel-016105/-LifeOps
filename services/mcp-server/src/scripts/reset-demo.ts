/**
 * Reset the demo state to its seeded baseline.
 * Equivalent to running the seed script.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, 'seed.ts');

const result = spawnSync('npx', ['tsx', target], { stdio: 'inherit' });
process.exit(result.status ?? 0);
