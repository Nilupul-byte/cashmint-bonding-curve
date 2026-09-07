// Compile the three production contracts, or check the committed .json artifacts against
// a fresh compile from source.
//
//   npm run verify    # default: recompile in memory, assert bytecode + fingerprint match
//   npm run compile   # overwrite the .json artifacts from source
//
// Two cashc versions are pinned in devDependencies:
//   - cashc@0.13.2            -> p_bond_curve, p_bond_vesting_v2
//   - cashc@0.12.1 (cashc-v12) -> p_bond_complete (predates 0.13's language changes;
//                                 do not "upgrade" it)
//
// cashc 0.13.2 runs with its default options (enforceFunctionParameterTypes and
// enforceLocktimeGuard both ON); the committed artifacts record `compiler.options`
// accordingly. No opt-out flags are used.

import { compileFile as compile13, utils as utils13 } from 'cashc';
import { compileFile as compile12, utils as utils12 } from 'cashc-v12';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONTRACTS = new URL('./contracts/', import.meta.url);
const write = process.argv.includes('--write');

const TARGETS = [
  { cash: 'p_bond_curve.cash',      json: 'p_bond_curve.json',      compile: compile13, utils: utils13 },
  { cash: 'p_bond_vesting_v2.cash', json: 'p_bond_vesting_v2.json', compile: compile13, utils: utils13 },
  { cash: 'p_bond_complete.cash',   json: 'p_bond_complete.json',   compile: compile12, utils: utils12 },
];

let mismatch = false;

for (const t of TARGETS) {
  const artifact = t.compile(new URL(t.cash, CONTRACTS));
  const jsonPath = fileURLToPath(new URL(t.json, CONTRACTS));

  if (write) {
    // No trailing newline: matches the format cashc's own CLI writes.
    writeFileSync(jsonPath, t.utils.formatArtifact(artifact));
    console.log(`wrote  ${t.json}  (cashc ${artifact.compiler.version})`);
    continue;
  }

  const committed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const bytecodeOk = artifact.bytecode === committed.bytecode;
  const fingerprintOk = artifact.fingerprint === committed.fingerprint;
  const ok = bytecodeOk && fingerprintOk;
  if (!ok) mismatch = true;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'}  ${t.json.padEnd(22)}  cashc ${artifact.compiler.version.padEnd(7)}  ` +
    `bytecode ${bytecodeOk ? 'match' : 'MISMATCH'}, fingerprint ${fingerprintOk ? 'match' : 'MISMATCH'}`,
  );
}

if (mismatch) {
  console.error('\nOne or more committed artifacts do not match their source.');
  process.exit(1);
}
if (!write) console.log('\nAll committed artifacts match their source.');
