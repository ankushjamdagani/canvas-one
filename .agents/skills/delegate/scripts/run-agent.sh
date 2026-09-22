#!/usr/bin/env bash
# Run one headless agent CLI with a hard timeout.
#
# Usage: run-agent.sh <prefix> <timeout_sec> <cli> <model> [effort] [-- extra args...]
#
# Reads the prompt from <prefix>.in and writes:
#   <prefix>.out   full stdout        <prefix>.err   full stderr
#   <prefix>.pid   agent process-group id (deleted on exit)
#   <prefix>.exit  exit code; 124 = timed out (written last — its presence means "finished")
#
# The agent runs in its own process group; on timeout that whole group gets
# TERM, then KILL after 10s. Nothing outside the group is signalled.
set -u

prefix=$1 secs=$2 cli=$3 model=$4
shift 4
effort=""
if [ $# -gt 0 ] && [ "$1" != "--" ]; then effort=$1; shift; fi
[ $# -gt 0 ] && [ "$1" = "--" ] && shift
extra=("$@")

in="$prefix.in" out="$prefix.out" err="$prefix.err" exitf="$prefix.exit" pidf="$prefix.pid"
[ -f "$in" ] || { echo "run-agent: missing prompt file $in" >&2; echo 2 > "$exitf"; exit 2; }
rm -f "$exitf" "$prefix.timedout"

case "$cli" in
  agy)
    cmd=(agy --print="$(cat "$in")" --model "$model")
    [ -n "$effort" ] && cmd+=(--effort "$effort") ;;
  codex)  cmd=(codex exec -c "model=\"$model\"") ;;
  claude) cmd=(claude -p --model "$model") ;;
  *) echo "run-agent: unknown cli '$cli'" >&2; echo 2 > "$exitf"; exit 2 ;;
esac
[ ${#extra[@]} -gt 0 ] && cmd+=("${extra[@]}")
# codex and claude read the prompt from stdin (variadic flags like --add-dir would swallow a positional prompt).
stdin=/dev/null
case "$cli" in codex) cmd+=(-); stdin=$in ;; claude) stdin=$in ;; esac

finish() { echo "$1" > "$exitf.tmp" && mv "$exitf.tmp" "$exitf"; rm -f "$pidf"; exit "$1"; }

tmo=$(command -v gtimeout || command -v timeout || true)
if [ -n "$tmo" ]; then
  # GNU timeout places the command in its own process group and signals the group.
  start=$SECONDS
  "$tmo" -k 10 "$secs" "${cmd[@]}" < "$stdin" > "$out" 2> "$err" &
  echo $! > "$pidf"
  wait $!; rc=$?
  # 137 = KILL after the grace period, still a timeout if the deadline passed.
  if [ $rc -eq 124 ] || { [ $rc -eq 137 ] && [ $((SECONDS - start)) -ge "$secs" ]; }; then rc=124; fi
  finish $rc
fi

# Portable fallback: job control gives each background job its own process group.
set -m
"${cmd[@]}" < "$stdin" > "$out" 2> "$err" &
pgid=$!
echo "$pgid" > "$pidf"
( sleep "$secs"
  kill -0 -- -"$pgid" 2>/dev/null || exit 0
  touch "$prefix.timedout"
  kill -TERM -- -"$pgid" 2>/dev/null
  sleep 10
  kill -KILL -- -"$pgid" 2>/dev/null ) > /dev/null 2>&1 &
watcher=$!
set +m
wait "$pgid" 2>/dev/null; rc=$?
kill -TERM -- -"$watcher" 2>/dev/null
wait "$watcher" 2>/dev/null
if [ -f "$prefix.timedout" ]; then rm -f "$prefix.timedout"; rc=124; fi
finish $rc
