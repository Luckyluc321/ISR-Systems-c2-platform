// Reporter — two modes.
//
// Human (default): grouped table per agent × fixture × assertion.
//   Uses ANSI colours when running in a TTY.
// JSON (--json):   machine-readable single object dumped to stdout.
//   Consumed by CI when the pipeline lands.

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function _color(enabled, code, text) {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

export function reportHuman(results) {
  const useColor = !!process.stdout.isTTY;
  const c = (code, text) => _color(useColor, code, text);

  const byAgent = new Map();
  for (const r of results) {
    if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
    byAgent.get(r.agent).push(r);
  }

  let totalPass = 0, totalFail = 0, totalError = 0;

  for (const [agent, agentResults] of byAgent) {
    console.log('');
    console.log(c(ANSI.bold, `═══ ${agent} ═══`));

    for (const r of agentResults) {
      const header = c(ANSI.cyan, r.fixtureId);
      const tier = r.expectedTier ? c(ANSI.dim, ` (${r.expectedTier})`) : '';
      const timing = r.durationMs != null ? c(ANSI.gray, ` ${r.durationMs}ms`) : '';
      console.log(`  ${header}${tier}${timing}`);

      if (r.error) {
        totalError++;
        console.log(`    ${c(ANSI.red, '✗ ERROR')} ${r.error}`);
        continue;
      }

      for (const a of r.assertions) {
        const mark = a.pass
          ? c(ANSI.green, '✓')
          : c(ANSI.red, '✗');
        const name = a.name.padEnd(20);
        const status = a.pass ? c(ANSI.green, 'pass') : c(ANSI.red, 'fail');
        console.log(`    ${mark} ${name} ${status}  ${c(ANSI.gray, a.message)}`);
        if (a.pass) totalPass++; else totalFail++;
      }
    }
  }

  console.log('');
  console.log(c(ANSI.bold, '─── summary ───'));
  console.log(`  ${c(ANSI.green, `pass ${totalPass}`)}  ${c(ANSI.red, `fail ${totalFail}`)}  ${c(ANSI.yellow, `err ${totalError}`)}`);
  console.log('');

  return totalFail === 0 && totalError === 0;
}

export function reportJson(results) {
  const summary = {
    ranAt: new Date().toISOString(),
    fixtureCount: results.length,
    passCount: 0,
    failCount: 0,
    errorCount: 0,
  };
  for (const r of results) {
    if (r.error) summary.errorCount++;
    else {
      const anyFail = r.assertions.some(a => !a.pass);
      if (anyFail) summary.failCount++;
      else summary.passCount++;
    }
  }
  process.stdout.write(JSON.stringify({ summary, results }, null, 2) + '\n');
  return summary.failCount === 0 && summary.errorCount === 0;
}
