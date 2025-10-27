const fs = require('fs');
const path = require('path');
const outDir = path.resolve(__dirname, '..', 'results');
fs.mkdirSync(outDir, { recursive: true });
const status = {
  commit: process.env.GIT_COMMIT || null,
  timestamp: new Date().toISOString(),
  modules: {},
  overall: { ok: true }
};
fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(status, null, 2));
console.log('Wrote results/status.json');
