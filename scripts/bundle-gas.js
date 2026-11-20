import esbuild from 'esbuild';
import fs from 'node:fs';

const bridges = `

// --- Top-level Apps Script entry point bridges ---
function doGet(e) { return globalThis.doGet(e); }
function apiVerifyScan(params) { return globalThis.apiVerifyScan(params); }
function apiProcessOfflineQueue(params) { return globalThis.apiProcessOfflineQueue(params); }
function apiManualOverride(params) { return globalThis.apiManualOverride(params); }
function apiRegisterWalkIn(params) { return globalThis.apiRegisterWalkIn(params); }
function apiCancelRegistration(params) { return globalThis.apiCancelRegistration(params); }
function apiGetEventDashboard(params) { return globalThis.apiGetEventDashboard(params); }
function setupEventlySheet(sheetId) { return globalThis.setupEventlySheet(sheetId); }
`;

async function build() {
  await esbuild.build({
    entryPoints: ['src/gas/gateway.ts'],
    bundle: true,
    target: 'es2019',
    platform: 'node',
    format: 'iife',
    outfile: 'dist/gas/Code.js',
    footer: {
      js: bridges,
    },
  });

  fs.copyFileSync('appsscript.json', 'dist/gas/appsscript.json');
  console.log('Successfully bundled dist/gas/Code.js with top-level Apps Script bridges.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
