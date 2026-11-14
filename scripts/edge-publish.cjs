#!/usr/bin/env node
// Publishes the packaged extension to the Microsoft Edge Add-ons store via the
// Update REST API v1.1 (https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api).
// Flow: upload draft package → poll upload operation → publish draft → poll
// publish operation. Secrets come from the environment and are never logged:
//   EDGE_CLIENT_ID   Partner Center Publish API Client ID
//   EDGE_API_KEY     Partner Center Publish API API key
//   EDGE_PRODUCT_ID  Product ID (GUID) of the published extension
// Usage:
//   node scripts/edge-publish.cjs --zip dist/xhs-enhanced-extension-v2.2.0.zip [--notes "text"] [--dry-run]
// --dry-run validates inputs and prints the planned requests without calling
// the API (no secret leaves the machine).
const fs = require('node:fs');
const path = require('node:path');

const API_ROOT = 'https://api.addons.microsoftedge.microsoft.com/v1/products';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

function parseArgs(argv) {
  const args = { notes: '', zip: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--zip') args.zip = argv[++i] || '';
    else if (arg === '--notes') args.notes = argv[++i] || '';
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/edge-publish.cjs --zip <file.zip> [--notes "text"] [--dry-run]');
      process.exit(0);
    } else {
      console.error('unknown argument: ' + arg);
      process.exit(2);
    }
  }
  return args;
}

function apiHeaders(apiKey) {
  return {
    Authorization: 'ApiKey ' + apiKey,
    'X-ClientID': process.env.EDGE_CLIENT_ID || ''
  };
}

function locationOperationId(response, bodySnippet) {
  const location = response.headers.get('location') || '';
  const id = location.split('/').filter(Boolean).pop() || '';
  if (!id) {
    throw new Error('API returned ' + response.status + ' ' + (response.statusText || '') + ' without a Location header (operation id missing). Body: ' + bodySnippet);
  }
  return id;
}

// Microsoft's API often carries the only error detail in the HTTP reason
// phrase (e.g. `403 Client ID is Invalid`) with an empty body — always log it.
function httpStatus(response) {
  return 'HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : '');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

function bodySnippet(text) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, 500);
}

// Poll an operation URL until status leaves InProgress. Returns the terminal
// operation JSON. Exits the process with a readable message on failure.
async function pollOperation(url, headers, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let transientFailures = 0;
  for (;;) {
    let response;
    try {
      response = await fetchWithTimeout(url, { method: 'GET', headers }, 60000);
    } catch (error) {
      transientFailures += 1;
      if (transientFailures > 5) throw new Error(label + ': status polling keeps failing (network/timeout): ' + (error && error.message));
      console.log(label + ': poll error (' + (error && error.message || error) + '), retrying…');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      transientFailures += 1;
      if (transientFailures > 5) throw new Error(label + ': status endpoint keeps returning ' + httpStatus(response));
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    const text = await response.text();
    if (response.status !== 200) {
      throw new Error(label + ': status endpoint returned ' + httpStatus(response) + (text ? ': ' + bodySnippet(text) : ''));
    }
    transientFailures = 0;
    let operation = null;
    try { operation = JSON.parse(text); } catch (_) {
      throw new Error(label + ': status response is not JSON: ' + bodySnippet(text));
    }
    const status = String(operation.status || '');
    console.log(label + ': status=' + (status || '<unknown>') + (operation.message ? ' — ' + operation.message : ''));
    if (status === 'Succeeded') return operation;
    if (status === 'Failed') {
      const details = operation.errors ? ' errors=' + bodySnippet(JSON.stringify(operation.errors)) : '';
      const errorCode = operation.errorCode ? ' errorCode=' + operation.errorCode : '';
      throw new Error(label + ': operation failed' + errorCode + (operation.message ? ' — ' + operation.message : '') + details);
    }
    if (Date.now() > deadline) {
      throw new Error(label + ': timed out after ' + Math.round(POLL_TIMEOUT_MS / 60000) + ' minutes waiting for the operation');
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.zip) {
    console.error('missing --zip <file.zip>');
    process.exit(2);
  }
  const zipPath = path.resolve(args.zip);
  if (!fs.existsSync(zipPath)) {
    console.error('zip not found: ' + zipPath);
    process.exit(2);
  }
  const zipBytes = fs.readFileSync(zipPath);
  if (zipBytes.length === 0) {
    console.error('zip is empty: ' + zipPath);
    process.exit(2);
  }
  const clientId = process.env.EDGE_CLIENT_ID || '';
  const apiKey = process.env.EDGE_API_KEY || '';
  const productId = process.env.EDGE_PRODUCT_ID || '';
  const notes = args.notes || 'Automated update published from GitHub Actions.';

  if (args.dryRun) {
    console.log('[dry-run] zip: ' + zipPath + ' (' + zipBytes.length + ' bytes)');
    console.log('[dry-run] would POST ' + API_ROOT + '/' + (productId || '<EDGE_PRODUCT_ID>') + '/submissions/draft/package');
    console.log('[dry-run]   headers: Authorization: ApiKey <redacted>, X-ClientID: ' + (clientId ? '<set>' : '<MISSING>') + ', Content-Type: application/zip');
    console.log('[dry-run] would poll .../submissions/draft/package/operations/<operationId> until Succeeded');
    console.log('[dry-run] would POST ' + API_ROOT + '/' + (productId || '<EDGE_PRODUCT_ID>') + '/submissions  (JSON notes: ' + JSON.stringify(notes) + ')');
    console.log('[dry-run] would poll .../submissions/operations/<operationId> until Succeeded');
    const missing = [['EDGE_CLIENT_ID', clientId], ['EDGE_API_KEY', apiKey], ['EDGE_PRODUCT_ID', productId]].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      console.error('[dry-run] FAIL: missing required env vars: ' + missing.join(', '));
      process.exit(1);
    }
    console.log('[dry-run] all inputs present; no API call made.');
    process.exit(0);
  }

  const missing = [['EDGE_CLIENT_ID', clientId], ['EDGE_API_KEY', apiKey], ['EDGE_PRODUCT_ID', productId]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('missing required env vars: ' + missing.join(', ') + ' (set them as GitHub Actions secrets)');
    process.exit(1);
  }

  const headers = apiHeaders(apiKey);
  const productBase = API_ROOT + '/' + encodeURIComponent(productId);

  console.log('edge-publish: uploading ' + path.basename(zipPath) + ' (' + zipBytes.length + ' bytes) to product ' + productId);
  const uploadResponse = await fetchWithTimeout(productBase + '/submissions/draft/package', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/zip' }, headers),
    body: zipBytes
  }, UPLOAD_TIMEOUT_MS);
  const uploadText = await uploadResponse.text().catch(() => '');
  if (uploadResponse.status !== 202) {
    console.error('upload failed: ' + httpStatus(uploadResponse) + (uploadText ? ': ' + bodySnippet(uploadText) : ''));
    process.exit(1);
  }
  const uploadOpId = locationOperationId(uploadResponse, bodySnippet(uploadText));
  console.log('edge-publish: upload accepted (operation ' + uploadOpId + ')');
  await pollOperation(productBase + '/submissions/draft/package/operations/' + encodeURIComponent(uploadOpId), headers, 'upload');

  console.log('edge-publish: publishing draft submission');
  const publishResponse = await fetchWithTimeout(productBase + '/submissions', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify({ notes })
  }, 60000);
  const publishText = await publishResponse.text().catch(() => '');
  if (publishResponse.status !== 202) {
    console.error('publish failed: ' + httpStatus(publishResponse) + (publishText ? ': ' + bodySnippet(publishText) : ''));
    process.exit(1);
  }
  const publishOpId = locationOperationId(publishResponse, bodySnippet(publishText));
  console.log('edge-publish: publish accepted (operation ' + publishOpId + ')');
  await pollOperation(productBase + '/submissions/operations/' + encodeURIComponent(publishOpId), headers, 'publish');

  console.log('edge-publish: done. The new version was submitted to the Edge Add-ons certification queue.');
}

main().catch(error => {
  console.error('edge-publish: ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
