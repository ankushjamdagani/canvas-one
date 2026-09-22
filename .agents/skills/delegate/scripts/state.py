#!/usr/bin/env python3
"""Delegate run state helper.

  state.py init    <state.json> <task> <config-json>   create state; scratchpad = state's directory
  state.py get     <state.json> <key>                   print a top-level value as JSON
  state.py set     <state.json> <key> <json | ->       set a top-level value ("-" reads JSON from stdin)
  state.py dispatch <state.json>                        write prompt + runner script per unfinished subtask; print script paths
  state.py collect <state.json>                         classify current-round executor results into state
"""
import json
import os
import re
import shlex
import signal
import sys
import time

EXCERPT_CHARS = 800
FOOTER = (
    "When finished, print a final line exactly `DELEGATE_STATUS: done`. If you could not "
    "complete the task (tool or permission denied, missing context, failing checks), print "
    "`DELEGATE_STATUS: blocked <reason>` instead. Never print the done line for partial work.\n"
)
MARKER = re.compile(r"^\s*DELEGATE_STATUS:\s*(done|blocked)\b(.*)$", re.I | re.M)
# Headless CLIs often exit 0 after a tool/permission refusal; treat these as failures.
DENIAL_PATTERNS = [
    r"permission denied",
    r"haven'?t granted",
    r"permission to use \S+ (?:was )?(?:denied|not granted)",
    r"(?:tool|command|action)(?: call| execution)? (?:was )?(?:denied|rejected|blocked)",
    r"(?:requires?|needs?) (?:user )?(?:approval|permission)",
    r"approval (?:was )?(?:required|denied|rejected)",
    r"not allowed to (?:run|execute|use|write|edit)",
]


def load(path):
    with open(path) as f:
        return json.load(f)


def save(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, path)


def read(path):
    try:
        with open(path, errors="replace") as f:
            return f.read()
    except FileNotFoundError:
        return None


def classify(prefix, patterns):
    """Return (status, reason, exit_code). status: done|failed|timeout|error|pending."""
    code = read(prefix + ".exit")
    if code is None:
        pid = read(prefix + ".pid")
        return "pending", ("started, pid %s" % pid.strip()) if pid else "not started", None
    code = int(code.strip() or -1)
    if code == 124:
        return "timeout", "killed after timeout", code
    if code != 0:
        return "error", "exit %d" % code, code
    out, err = read(prefix + ".out") or "", read(prefix + ".err") or ""
    if not out.strip():
        return "failed", "exit 0 with empty stdout", code
    for pat in patterns:
        for name, text in (("stdout", out), ("stderr", err)):
            m = re.search(pat, text, re.I)
            if m:
                line = text[text.rfind("\n", 0, m.start()) + 1:].split("\n", 1)[0].strip()
                return "failed", "permission/tool denial in %s: %s" % (name, line[:200]), code
    marks = MARKER.findall(out)
    if not marks:
        return "failed", "exit 0 without DELEGATE_STATUS line", code
    verdict, detail = marks[-1]
    if verdict.lower() != "done":
        return "failed", ("executor reported blocked" + detail)[:200].strip(), code
    return "done", "", code


def collect(path):
    state = load(path)
    run_dir = os.path.join(state["scratchpad"], "r%d" % state.get("review_loop", 0))
    patterns = DENIAL_PATTERNS + state["config"].get("failure_patterns", [])
    executions = []
    for sub in state["plan"]["subtasks"]:
        prefix = os.path.join(run_dir, sub["id"])
        status, reason, code = classify(prefix, patterns)
        out = read(prefix + ".out") or ""
        executions.append({
            "id": sub["id"],
            "status": status,
            "reason": reason,
            "exit_code": code,
            "executor": sub["assigned_executor"],
            "stdout_path": prefix + ".out",
            "stderr_path": prefix + ".err",
            "excerpt": out[-EXCERPT_CHARS:],
        })
        print("%-6s %-8s %s" % (sub["id"], status, reason))
    state["executions"] = executions
    save(path, state)


def dispatch(path):
    """Write <id>.in and <id>.sh for every unfinished subtask of the current round; print the .sh paths."""
    state = load(path)
    cfg = state["config"]
    run_dir = os.path.join(state["scratchpad"], "r%d" % state.get("review_loop", 0))
    os.makedirs(run_dir, exist_ok=True)
    runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run-agent.sh")
    for sub in state["plan"]["subtasks"]:
        prefix = os.path.join(run_dir, sub["id"])
        if os.path.exists(prefix + ".exit"):
            continue  # finished in an earlier attempt; keep its result
        pid = read(prefix + ".pid")
        if pid:  # orphaned by an interrupted orchestrator: stop only its own process group
            try:
                os.killpg(int(pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError, ValueError):
                pass
            deadline = time.time() + 15  # a surviving wrapper may still write .exit
            while time.time() < deadline and os.path.exists(prefix + ".pid"):
                time.sleep(0.5)
            for ext in (".pid", ".exit"):
                if os.path.exists(prefix + ext):
                    os.remove(prefix + ext)
        with open(prefix + ".in", "w") as f:
            f.write(sub["prompt"].rstrip() + "\n\n" + FOOTER)
        ex = sub["assigned_executor"]
        argv = [runner, prefix, str(ex.get("timeout_sec", cfg.get("timeout_sec", 300))),
                ex["cli"], ex["model"], ex.get("effort", ""), "--"] + ex.get("args", [])
        with open(prefix + ".sh", "w") as f:
            f.write(" ".join(shlex.quote(a) for a in argv) + "\n")
        print(prefix + ".sh")


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    cmd, path = argv[1], argv[2]
    if cmd == "init":
        task, config = argv[3], json.loads(argv[4])
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        save(path, {
            "task": task,
            "config": config,
            "scratchpad": os.path.dirname(os.path.abspath(path)),
            "phase": "plan",
            "plan": None,
            "critique": None,
            "review_loop": 0,
            "executions": [],
            "review": None,
        })
    elif cmd == "get":
        print(json.dumps(load(path).get(argv[3]), indent=2))
    elif cmd == "set":
        raw = sys.stdin.read() if argv[4] == "-" else argv[4]
        state = load(path)
        state[argv[3]] = json.loads(raw)
        save(path, state)
    elif cmd == "dispatch":
        dispatch(path)
    elif cmd == "collect":
        collect(path)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
