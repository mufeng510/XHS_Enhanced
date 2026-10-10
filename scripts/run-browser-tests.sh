#!/usr/bin/env bash
# POSIX counterpart of scripts/run-browser-tests.ps1 for Linux/macOS.
#
# Protocol, mirroring the PowerShell runner:
#   1. pick a free loopback port and start `node scripts/browser-test-server.cjs <port>`
#   2. wait until the harness route answers 200
#   3. launch headless Chrome against http://127.0.0.1:<port>/search_result
#   4. read data-test-result / data-test-terminal-writes / data-test-summary
#   5. fail closed unless result === 'pass' AND terminal writes === 1
#
# Transport 1 is `--dump-dom` with `--virtual-time-budget`. When that transport
# does not reach the terminal pass state, the runner falls back to the loopback
# remote-debugging listing the PowerShell script already uses and reads the same
# harness terminal attributes. The verdict always comes from one authoritative
# terminal state; nothing is ever waived.
set -euo pipefail

BROWSER="${XHS_BROWSER:-/usr/bin/google-chrome}"
NODE_BIN="${XHS_NODE:-node}"
HARNESS_ROUTE='/search_result'
POLL_ATTEMPTS="${XHS_BROWSER_POLL_ATTEMPTS:-40}"
POLL_INTERVAL_S="${XHS_BROWSER_POLL_INTERVAL:-0.5}"

SERVER_PID=''
CHROME_PID=''
WORK_DIR=''

cleanup() {
  for pid in "$CHROME_PID" "$SERVER_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$CHROME_PID" "$SERVER_PID"; do
    if [ -n "$pid" ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT INT TERM

fail() {
  printf '%s\n' "$1" >&2
  exit "${2:-1}"
}

for tool in "$NODE_BIN" grep sed; do
  command -v "$tool" >/dev/null 2>&1 || fail "ENVIRONMENT SKIP: $tool is required but was not found." 2
done
if [ ! -x "$BROWSER" ]; then
  command -v "$BROWSER" >/dev/null 2>&1 || fail "ENVIRONMENT SKIP: $BROWSER was not found; browser verification is unavailable." 2
fi

free_port() {
  "$NODE_BIN" -e 'const net = require("node:net"); const server = net.createServer(); server.on("error", () => process.exit(1)); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => console.log(port)); });'
}

harness_is_up() {
  "$NODE_BIN" -e '
    const http = require("node:http");
    http.get(process.argv[1], response => { response.resume(); process.exit(response.statusCode === 200 ? 0 : 1); }).on("error", () => process.exit(1));
  ' "$1" >/dev/null 2>&1
}

# Read the harness terminal attributes out of a DOM snapshot.
# $1 = DOM file, $2 = "1" to also print the per-assertion PASS:/FAIL: lines.
report() {
  local dom="$1" verbose="${2:-0}"
  local result writes summary assertions
  result="$(grep -o 'data-test-result="[^"]*"' "$dom" | head -n 1 | sed 's/.*="//; s/"$//' || true)"
  writes="$(grep -o 'data-test-terminal-writes="[^"]*"' "$dom" | head -n 1 | sed 's/.*="//; s/"$//' || true)"
  summary="$(grep -o 'data-test-summary="[^"]*"' "$dom" | head -n 1 | sed 's/.*="//; s/"$//' || true)"
  assertions="$(grep -o '<li data-status="[a-z]*">[^<]*' "$dom" | sed 's/<li data-status="[a-z]*">//' || true)"
  printf 'Harness result: %s; terminal writes: %s\n' "${result:-<none>}" "${writes:-<none>}"
  printf 'Harness summary (HTML encoded): %s\n' "${summary:-<none>}"
  if [ "$verbose" = '1' ] && [ -n "$assertions" ]; then
    printf 'Per-assertion results:\n%s\n' "$assertions"
  fi
  # Fail closed: only one explicit `pass` terminal write is accepted.
  if [ "$result" != 'pass' ] || [ "$writes" != '1' ]; then
    printf 'Harness did not reach one explicit pass terminal state.\n' >&2
    return 1
  fi
  return 0
}

# Fail-closed verdict for a DOM snapshot: one explicit `pass` terminal write only.
is_terminal_pass() {
  local result writes
  result="$(grep -o 'data-test-result="[^"]*"' "$1" | head -n 1 | sed 's/.*="//; s/"$//' || true)"
  writes="$(grep -o 'data-test-terminal-writes="[^"]*"' "$1" | head -n 1 | sed 's/.*="//; s/"$//' || true)"
  [ "$result" = 'pass' ] && [ "$writes" = '1' ]
}

WORK_DIR="$(mktemp -d)"
SERVER_LOG="$WORK_DIR/server.log"
DOM_DUMP="$WORK_DIR/dom.html"
SERVER_PORT="$(free_port)"
URI="http://127.0.0.1:${SERVER_PORT}${HARNESS_ROUTE}"

"$NODE_BIN" scripts/browser-test-server.cjs "$SERVER_PORT" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

READY='false'
for _ in $(seq 1 50); do
  if harness_is_up "$URI"; then
    READY='true'
    break
  fi
  sleep 0.1
done
if [ "$READY" != 'true' ]; then
  printf 'Browser test server failed to start\n' >&2
  if [ -s "$SERVER_LOG" ]; then cat "$SERVER_LOG" >&2; fi
  exit 1
fi

printf 'Browser: %s (%s)\n' "$BROWSER" "$("$BROWSER" --version 2>/dev/null || printf 'unknown version')"
printf 'Harness URL: %s\n' "$URI"

# --- Transport 1: --dump-dom with virtual time -------------------------------
DUMP_PROFILE="$WORK_DIR/profile-dump"
mkdir -p "$DUMP_PROFILE"
"$BROWSER" \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-extensions \
  --disable-crash-reporter \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --no-proxy-server \
  --allow-file-access-from-files \
  --user-data-dir="$DUMP_PROFILE" \
  --virtual-time-budget=10000 \
  --dump-dom "$URI" >"$DOM_DUMP" 2>/dev/null || true

if is_terminal_pass "$DOM_DUMP"; then
  report "$DOM_DUMP" 1
  printf 'Transport: dump-dom\n'
  exit 0
fi
printf 'Transport dump-dom did not reach the terminal pass state (result=%s, writes=%s); retrying over the loopback debug listing.\n' \
  "$(grep -o 'data-test-result="[^"]*"' "$DOM_DUMP" | head -n 1 | sed 's/.*="//; s/"$//' || true)" \
  "$(grep -o 'data-test-terminal-writes="[^"]*"' "$DOM_DUMP" | head -n 1 | sed 's/.*="//; s/"$//' || true)" >&2

# --- Transport 2: loopback remote-debugging listing (ps1 fallback) ------------
DEBUG_PORT="$(free_port)"
DEBUG_PROFILE="$WORK_DIR/profile-debug"
mkdir -p "$DEBUG_PROFILE"
"$BROWSER" \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-extensions \
  --disable-crash-reporter \
  --disable-breakpad \
  --noerrdialogs \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --no-proxy-server \
  --allow-file-access-from-files \
  --remote-debugging-port="$DEBUG_PORT" \
  --remote-allow-origins='*' \
  --user-data-dir="$DEBUG_PROFILE" \
  "$URI" >"$WORK_DIR/debug.out" 2>/dev/null &
CHROME_PID=$!

SERIALIZED_DOM="$WORK_DIR/serialized.html"
SNAPSHOT="$WORK_DIR/snapshot.html"
for attempt in $(seq 1 "$POLL_ATTEMPTS"); do
  sleep "$POLL_INTERVAL_S"
  : >"$SNAPSHOT"
  "$NODE_BIN" -e '
    const [debugPort, target] = process.argv.slice(1);
    const listing = `http://127.0.0.1:${debugPort}/json`;
    const read = async url => (await fetch(url)).json();
    (async () => {
      let pages;
      try { pages = await read(listing); } catch (_) { return; }
      const page = pages.find(entry => entry.url === target);
      if (!page || !page.webSocketDebuggerUrl) return;
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      const closed = new Promise(resolve => socket.addEventListener("close", () => resolve(null), { once: true }));
      await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
      if (socket.readyState !== 1) { await closed; return; }
      const evaluate = expression => new Promise(resolve => {
        const id = Math.floor(Math.random() * 1e9);
        const listener = event => {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          socket.removeEventListener("message", listener);
          resolve(message.result && message.result.result ? message.result.result.value : "");
        };
        socket.addEventListener("message", listener);
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      const markup = await evaluate(`(async () => {
        const deadline = Date.now() + 1000;
        while (!document.documentElement.hasAttribute("data-test-result") && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return document.documentElement.outerHTML;
      })()`);
      socket.close();
      // The harness page must stay open: closing the debug target here would
      // destroy the running suite before it reaches its terminal state.
      if (!markup) return;
      process.stdout.write(markup);
    })();
  ' "$DEBUG_PORT" "$URI" >"$SNAPSHOT" || true
  if grep -q 'data-test-result="\(pass\|fail\)"' "$SNAPSHOT"; then
    mv "$SNAPSHOT" "$SERIALIZED_DOM"
    break
  fi
  printf 'Attempt %s: harness has not reached a terminal state yet.\n' "$attempt" >&2
done

if kill -0 "$CHROME_PID" 2>/dev/null; then
  kill "$CHROME_PID" 2>/dev/null || true
fi
CHROME_PID=''

if ! grep -q 'data-test-result="\(pass\|fail\)"' "$SERIALIZED_DOM"; then
  fail "Harness never reported a terminal state after $POLL_ATTEMPTS attempts; browser verification is unavailable."
fi
printf 'Transport: loopback-debug-listing\n'
report "$SERIALIZED_DOM" 1