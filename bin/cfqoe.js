#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[x] ${message}`);
  if (process.env.CFQOE_DEBUG === '1' && error?.stack) console.error(error.stack);
  process.exitCode = 1;
});
