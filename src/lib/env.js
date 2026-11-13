// Shared environment accessors. Kept in one module so every other module reads
// the globals the same way (the vm-based unit tests substitute these).
export function getRoot() {
  return globalThis;
}

export function isTestMode() {
  return globalThis.__XHS_ENHANCED_TEST_MODE__ === true;
}

export function getChrome() {
  try {
    const candidate = globalThis.chrome;
    if (candidate && typeof candidate === 'object') return candidate;
  } catch (_) {}
  return null;
}

export function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}
