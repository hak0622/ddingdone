#!/usr/bin/env python3
"""
Harness Step Executor — phase 내 step을 순차 실행하고 자가 교정한다.

Usage:
    python3 scripts/execute.py <phase-dir> [--push]
"""

import argparse
import copy
import contextlib
import json
import subprocess
import sys
import threading
import time
import types
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

HARNESS_ROOT = Path(__file__).resolve().parent.parent


@contextlib.contextmanager
def progress_indicator(label: str):
    """터미널 진행 표시기. with 문으로 사용하며 .elapsed 로 경과 시간을 읽는다."""
    frames = "◐◓◑◒"
    stop = threading.Event()
    t0 = time.monotonic()

    def _animate():
        idx = 0
        while not stop.wait(0.12):
            sec = int(time.monotonic() - t0)
            sys.stderr.write(f"\r{frames[idx % len(frames)]} {label} [{sec}s]")
            sys.stderr.flush()
            idx += 1
        sys.stderr.write("\r" + " " * (len(label) + 20) + "\r")
        sys.stderr.flush()

    th = threading.Thread(target=_animate, daemon=True)
    th.start()
    info = types.SimpleNamespace(elapsed=0.0)
    try:
        yield info
    finally:
        stop.set()
        th.join()
        info.elapsed = time.monotonic() - t0


class StepExecutor:
    """Phase 디렉토리 안의 step들을 순차 실행하는 하네스."""

    MAX_RETRIES = 3
    FEAT_MSG = "feat({phase}): step {num} — {name}"
    TZ = timezone(timedelta(hours=9))
    DEFAULT_VERIFY_TIMEOUT = 300
    CLAUDE_RESULT_SCHEMA = {
        "type": "object",
        "properties": {
            "outcome": {
                "type": "string",
                "enum": ["ready_for_verification", "blocked"],
            },
            "summary": {"type": "string"},
            "blocked_reason": {"type": ["string", "null"]},
        },
        "required": ["outcome", "summary", "blocked_reason"],
        "additionalProperties": False,
    }

    def __init__(self, phase_dir_name: str, *, auto_push: bool = False):
        self._harness_root = HARNESS_ROOT
        bootstrap_phase_dir = HARNESS_ROOT / "phases" / phase_dir_name
        self._phase_dir_name = phase_dir_name
        self._auto_push = auto_push

        if not bootstrap_phase_dir.is_dir():
            print(f"ERROR: {bootstrap_phase_dir} not found")
            sys.exit(1)

        bootstrap_index_file = bootstrap_phase_dir / "index.json"
        if not bootstrap_index_file.exists():
            print(f"ERROR: {bootstrap_index_file} not found")
            sys.exit(1)

        idx = self._read_json(bootstrap_index_file)
        project_root = idx.get("project_root")
        if not isinstance(project_root, str) or not project_root.strip():
            print(f"ERROR: {bootstrap_index_file}에 project_root가 필요합니다.")
            sys.exit(1)

        self._project_root = (HARNESS_ROOT / project_root).resolve()
        if not self._project_root.is_dir():
            print(f"ERROR: project_root {self._project_root} not found")
            sys.exit(1)

        self._root = str(self._project_root)
        self._phases_dir = self._project_root / "phases"
        self._phase_dir = self._phases_dir / phase_dir_name
        self._top_index_file = self._phases_dir / "index.json"
        self._index_file = self._phase_dir / "index.json"
        self._project = idx.get("project", "project")
        self._phase_name = idx.get("phase", phase_dir_name)
        self._total = len(idx["steps"])

    def run(self):
        self._print_header()
        self._check_blockers()
        self._checkout_branch()
        guardrails = self._load_guardrails()
        self._ensure_created_at()
        self._execute_all_steps(guardrails)
        self._finalize()

    # --- timestamps ---

    def _stamp(self) -> str:
        return datetime.now(self.TZ).strftime("%Y-%m-%dT%H:%M:%S%z")

    # --- JSON I/O ---

    @staticmethod
    def _read_json(p: Path) -> dict:
        return json.loads(p.read_text(encoding="utf-8"))

    @staticmethod
    def _write_json(p: Path, data: dict):
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # --- git ---

    def _run_git(self, *args) -> subprocess.CompletedProcess:
        cmd = ["git"] + list(args)
        return subprocess.run(cmd, cwd=self._project_root, capture_output=True, text=True)

    def _git_head(self) -> Optional[str]:
        result = self._run_git("rev-parse", "HEAD")
        return result.stdout.strip() if result.returncode == 0 else None

    def _checkout_branch(self):
        branch = f"feat-{self._phase_name}"

        r = self._run_git("rev-parse", "--abbrev-ref", "HEAD")
        if r.returncode != 0:
            print(f"  ERROR: git을 사용할 수 없거나 git repo가 아닙니다.")
            print(f"  {r.stderr.strip()}")
            sys.exit(1)

        if r.stdout.strip() == branch:
            return

        r = self._run_git("rev-parse", "--verify", branch)
        r = self._run_git("checkout", branch) if r.returncode == 0 else self._run_git("checkout", "-b", branch)

        if r.returncode != 0:
            print(f"  ERROR: 브랜치 '{branch}' checkout 실패.")
            print(f"  {r.stderr.strip()}")
            print(f"  Hint: 변경사항을 stash하거나 commit한 후 다시 시도하세요.")
            sys.exit(1)

        print(f"  Branch: {branch}")

    def _commit_step(self, step_num: int, step_name: str):
        self._run_git("add", "-A")
        if self._run_git("diff", "--cached", "--quiet").returncode == 0:
            return True

        msg = self.FEAT_MSG.format(phase=self._phase_name, num=step_num, name=step_name)
        result = self._run_git("commit", "-m", msg)
        if result.returncode == 0:
            print(f"  Commit: {msg}")
            return True

        print(f"  ERROR: Step 커밋 실패: {result.stderr.strip()}")
        return False

    # --- top-level index ---

    def _update_top_index(self, status: str):
        if not self._top_index_file.exists():
            return
        top = self._read_json(self._top_index_file)
        ts = self._stamp()
        for phase in top.get("phases", []):
            if phase.get("dir") == self._phase_dir_name:
                phase["status"] = status
                ts_key = {"completed": "completed_at", "error": "failed_at", "blocked": "blocked_at"}.get(status)
                if ts_key:
                    phase[ts_key] = ts
                break
        self._write_json(self._top_index_file, top)

    # --- guardrails & context ---

    def _load_guardrails(self) -> str:
        sections = []
        claude_md = self._project_root / "CLAUDE.md"
        if claude_md.exists():
            sections.append(f"## 프로젝트 규칙 (CLAUDE.md)\n\n{claude_md.read_text()}")
        docs_dir = self._project_root / "docs"
        if docs_dir.is_dir():
            for doc in sorted(docs_dir.glob("*.md")):
                sections.append(f"## {doc.stem}\n\n{doc.read_text()}")
        return "\n\n---\n\n".join(sections) if sections else ""

    @staticmethod
    def _build_step_context(index: dict) -> str:
        lines = [
            f"- Step {s['step']} ({s['name']}): {s['summary']}"
            for s in index["steps"]
            if s["status"] == "completed" and s.get("summary")
        ]
        if not lines:
            return ""
        return "## 이전 Step 산출물\n\n" + "\n".join(lines) + "\n\n"

    def _build_preamble(self, guardrails: str, step_context: str,
                        prev_error: Optional[str] = None) -> str:
        retry_section = ""
        if prev_error:
            retry_section = (
                f"\n## ⚠ 이전 시도 실패 — 아래 에러를 반드시 참고하여 수정하라\n\n"
                f"{prev_error}\n\n---\n\n"
            )
        return (
            f"당신은 {self._project} 프로젝트의 개발자입니다. 아래 step을 수행하세요.\n\n"
            f"{guardrails}\n\n---\n\n"
            f"{step_context}{retry_section}"
            f"## 작업 규칙\n\n"
            f"1. 이전 step에서 작성된 코드를 확인하고 일관성을 유지하라.\n"
            f"2. 이 step에 명시된 작업만 수행하라. 추가 기능이나 파일을 만들지 마라.\n"
            f"3. 기존 테스트를 깨뜨리지 마라.\n"
            f"4. phase index의 status, verify 설정을 수정하지 마라.\n"
            f"5. git commit과 git push를 실행하지 마라. 최종 검증과 커밋은 Harness가 수행한다.\n"
            f"6. 구현을 마치면 ready_for_verification과 산출물 summary를 반환하라.\n"
            f"7. 사용자 개입이 필요한 경우 blocked와 구체적인 blocked_reason을 반환하라.\n"
            f"8. 이전 실패 정보가 있으면 원인을 수정한 뒤 다시 결과를 반환하라.\n\n---\n\n"
        )

    # --- Claude 호출 ---

    def _invoke_claude(self, step: dict, preamble: str) -> dict:
        step_num, step_name = step["step"], step["name"]
        step_file = self._phase_dir / f"step{step_num}.md"

        if not step_file.exists():
            print(f"  ERROR: {step_file} not found")
            sys.exit(1)

        prompt = preamble + step_file.read_text()
        settings_file = self._harness_root / ".claude" / "settings.json"
        result = subprocess.run(
            [
                "claude", "-p", "--dangerously-skip-permissions",
                "--output-format", "json",
                "--json-schema", json.dumps(self.CLAUDE_RESULT_SCHEMA),
                "--disallowedTools", "Bash(git commit *),Bash(git push *)",
                "--settings", str(settings_file),
                prompt,
            ],
            cwd=self._project_root, capture_output=True, text=True, timeout=1800,
        )

        if result.returncode != 0:
            print(f"\n  WARN: Claude가 비정상 종료됨 (code {result.returncode})")
            if result.stderr:
                print(f"  stderr: {result.stderr[:500]}")

        return {
            "step": step_num, "name": step_name,
            "exitCode": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr,
            "executed_at": self._stamp(),
        }

    def _parse_claude_result(self, output: dict) -> dict:
        if output["exitCode"] != 0:
            raise ValueError(
                f"Claude exited with code {output['exitCode']}: {output['stderr'].strip()}"
            )

        try:
            envelope = json.loads(output["stdout"])
        except json.JSONDecodeError as exc:
            raise ValueError(f"Claude JSON output 파싱 실패: {exc}") from exc

        payload = envelope.get("structured_output")
        if payload is None:
            payload = envelope.get("result")
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise ValueError("Claude structured result가 JSON이 아닙니다.") from exc

        if not isinstance(payload, dict):
            raise ValueError("Claude structured result가 없습니다.")

        outcome = payload.get("outcome")
        summary = payload.get("summary")
        blocked_reason = payload.get("blocked_reason")
        if outcome not in {"ready_for_verification", "blocked"}:
            raise ValueError(f"지원하지 않는 Claude outcome: {outcome}")
        if not isinstance(summary, str):
            raise ValueError("Claude summary는 문자열이어야 합니다.")
        if outcome == "blocked" and not isinstance(blocked_reason, str):
            raise ValueError("blocked 결과에는 blocked_reason이 필요합니다.")

        return {
            "outcome": outcome,
            "summary": summary,
            "blocked_reason": blocked_reason,
        }

    def _validate_step_config(self, step: dict):
        verify = step.get("verify")
        if not isinstance(verify, list) or not verify:
            raise ValueError(f"Step {step.get('step')}에 비어 있지 않은 verify 배열이 필요합니다.")

        names = set()
        for item in verify:
            if not isinstance(item, dict):
                raise ValueError("verify 항목은 객체여야 합니다.")
            name = item.get("name")
            command = item.get("command")
            timeout = item.get("timeout_seconds", self.DEFAULT_VERIFY_TIMEOUT)
            if not isinstance(name, str) or not name.strip():
                raise ValueError("verify name은 비어 있지 않은 문자열이어야 합니다.")
            if name in names:
                raise ValueError(f"중복된 verify name: {name}")
            names.add(name)
            if (
                not isinstance(command, list)
                or not command
                or not all(isinstance(arg, str) and arg for arg in command)
            ):
                raise ValueError(f"verify command는 비어 있지 않은 문자열 배열이어야 합니다: {name}")
            if not isinstance(timeout, int) or timeout <= 0:
                raise ValueError(f"timeout_seconds는 양의 정수여야 합니다: {name}")

    def _run_verification(self, verify: list) -> dict:
        results = []
        for item in verify:
            command = list(item["command"])
            timeout = item.get("timeout_seconds", self.DEFAULT_VERIFY_TIMEOUT)
            executed_at = self._stamp()
            try:
                result = subprocess.run(
                    command,
                    cwd=self._project_root,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                )
                command_result = {
                    "name": item["name"],
                    "command": command,
                    "exit_code": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "executed_at": executed_at,
                    "status": "passed" if result.returncode == 0 else "failed",
                }
            except subprocess.TimeoutExpired as exc:
                command_result = {
                    "name": item["name"],
                    "command": command,
                    "exit_code": None,
                    "stdout": exc.stdout or "",
                    "stderr": exc.stderr or f"Command timed out after {timeout} seconds",
                    "executed_at": executed_at,
                    "status": "timeout",
                }
            except OSError as exc:
                command_result = {
                    "name": item["name"],
                    "command": command,
                    "exit_code": None,
                    "stdout": "",
                    "stderr": str(exc),
                    "executed_at": executed_at,
                    "status": "spawn_error",
                }
            results.append(command_result)

        passed = all(item["exit_code"] == 0 for item in results)
        return {
            "status": "passed" if passed else "failed",
            "verified_at": self._stamp(),
            "commands": results,
        }

    @staticmethod
    def _format_verification_error(verification: dict) -> str:
        sections = ["Harness 독립 검증에 실패했습니다."]
        for result in verification["commands"]:
            if result["exit_code"] == 0:
                continue
            command = " ".join(result["command"])
            sections.append(
                f"[{result['name']}]\n"
                f"command: {command}\n"
                f"status: {result['status']}\n"
                f"exit code: {result['exit_code']}\n\n"
                f"stdout:\n{result['stdout']}\n\n"
                f"stderr:\n{result['stderr']}"
            )
        return "\n\n".join(sections)

    def _record_attempt(self, step: dict, attempt: int, claude_output: dict,
                        claude_result: Optional[dict], verification: Optional[dict]):
        out_path = self._phase_dir / f"step{step['step']}-output.json"
        data = {"step": step["step"], "name": step["name"], "attempts": []}
        if out_path.exists():
            existing = self._read_json(out_path)
            if isinstance(existing.get("attempts"), list):
                data = existing
            else:
                data["legacy"] = existing

        data["attempts"].append({
            "attempt": attempt,
            "claude": {
                "exit_code": claude_output["exitCode"],
                "stdout": claude_output["stdout"],
                "stderr": claude_output["stderr"],
                "executed_at": claude_output["executed_at"],
                "result": claude_result,
            },
            "verification": verification,
        })
        self._write_json(out_path, data)

    # --- 헤더 & 검증 ---

    def _print_header(self):
        print(f"\n{'='*60}")
        print(f"  Harness Step Executor")
        print(f"  Phase: {self._phase_name} | Steps: {self._total}")
        if self._auto_push:
            print(f"  Auto-push: enabled")
        print(f"{'='*60}")

    def _check_blockers(self):
        index = self._read_json(self._index_file)
        for s in reversed(index["steps"]):
            if s["status"] == "error":
                print(f"\n  ✗ Step {s['step']} ({s['name']}) failed.")
                print(f"  Error: {s.get('error_message', 'unknown')}")
                print(f"  Fix and reset status to 'pending' to retry.")
                sys.exit(1)
            if s["status"] == "blocked":
                print(f"\n  ⏸ Step {s['step']} ({s['name']}) blocked.")
                print(f"  Reason: {s.get('blocked_reason', 'unknown')}")
                print(f"  Resolve and reset status to 'pending' to retry.")
                sys.exit(2)
            if s["status"] != "pending":
                break

    def _ensure_created_at(self):
        index = self._read_json(self._index_file)
        if "created_at" not in index:
            index["created_at"] = self._stamp()
            self._write_json(self._index_file, index)

    # --- 실행 루프 ---

    def _execute_single_step(self, step: dict, guardrails: str) -> bool:
        """단일 step 실행 (재시도 포함). 완료되면 True, 실패/차단이면 False."""
        step_num, step_name = step["step"], step["name"]
        done = sum(1 for s in self._read_json(self._index_file)["steps"] if s["status"] == "completed")
        prev_error = None
        self._validate_step_config(step)
        verify_snapshot = copy.deepcopy(step["verify"])

        for attempt in range(1, self.MAX_RETRIES + 1):
            index = self._read_json(self._index_file)
            step_context = self._build_step_context(index)
            preamble = self._build_preamble(guardrails, step_context, prev_error)

            tag = f"Step {step_num}/{self._total - 1} ({done} done): {step_name}"
            if attempt > 1:
                tag += f" [retry {attempt}/{self.MAX_RETRIES}]"

            head_before = self._git_head()
            with progress_indicator(tag) as pi:
                claude_output = self._invoke_claude(step, preamble)
            elapsed = int(pi.elapsed)
            head_after = self._git_head()
            ts = self._stamp()

            if head_before is None or head_after is None or head_before != head_after:
                reason = (
                    "Claude 실행 중 Git HEAD가 변경되었습니다. 자동 검증과 커밋을 중단하고 "
                    f"사람의 확인이 필요합니다. before={head_before}, after={head_after}"
                )
                self._record_attempt(step, attempt, claude_output, None, None)
                index = self._read_json(self._index_file)
                for current in index["steps"]:
                    if current["step"] == step_num:
                        current["verify"] = copy.deepcopy(verify_snapshot)
                        current["status"] = "blocked"
                        current["blocked_reason"] = reason
                        current["blocked_at"] = ts
                        current.pop("completed_at", None)
                        current.pop("failed_at", None)
                self._write_json(self._index_file, index)
                self._update_top_index("blocked")
                print(f"  ⏸ Step {step_num}: {step_name} blocked [{elapsed}s]")
                print(f"    Reason: {reason}")
                sys.exit(2)

            claude_result = None
            verification = None
            try:
                claude_result = self._parse_claude_result(claude_output)
                if claude_result["outcome"] == "blocked":
                    reason = claude_result["blocked_reason"]
                    self._record_attempt(step, attempt, claude_output, claude_result, None)
                    index = self._read_json(self._index_file)
                    for current in index["steps"]:
                        if current["step"] == step_num:
                            current["verify"] = copy.deepcopy(verify_snapshot)
                            current["status"] = "blocked"
                            current["summary"] = claude_result["summary"]
                            current["blocked_reason"] = reason
                            current["blocked_at"] = ts
                            current.pop("completed_at", None)
                            current.pop("failed_at", None)
                    self._write_json(self._index_file, index)
                    self._update_top_index("blocked")
                    print(f"  ⏸ Step {step_num}: {step_name} blocked [{elapsed}s]")
                    print(f"    Reason: {reason}")
                    sys.exit(2)

                verification = self._run_verification(verify_snapshot)
                err_msg = (
                    "" if verification["status"] == "passed"
                    else self._format_verification_error(verification)
                )
            except ValueError as exc:
                err_msg = str(exc)

            self._record_attempt(step, attempt, claude_output, claude_result, verification)

            if verification is not None and verification["status"] == "passed":
                index = self._read_json(self._index_file)
                compact_verification = {
                    "status": "passed",
                    "verified_at": verification["verified_at"],
                    "commands": [
                        {
                            "name": result["name"],
                            "command": result["command"],
                            "exit_code": result["exit_code"],
                            "status": result["status"],
                            "executed_at": result["executed_at"],
                        }
                        for result in verification["commands"]
                    ],
                }
                for current in index["steps"]:
                    if current["step"] == step_num:
                        current["verify"] = copy.deepcopy(verify_snapshot)
                        current["status"] = "completed"
                        current["summary"] = claude_result["summary"]
                        current["verification"] = compact_verification
                        current["completed_at"] = ts
                        current.pop("error_message", None)
                        current.pop("failed_at", None)
                        current.pop("blocked_reason", None)
                        current.pop("blocked_at", None)
                self._write_json(self._index_file, index)

                if not self._commit_step(step_num, step_name):
                    index = self._read_json(self._index_file)
                    for current in index["steps"]:
                        if current["step"] == step_num:
                            current["status"] = "error"
                            current["error_message"] = "독립 검증은 통과했지만 Step 커밋에 실패했습니다."
                            current["failed_at"] = self._stamp()
                            current.pop("completed_at", None)
                    self._write_json(self._index_file, index)
                    self._update_top_index("error")
                    sys.exit(1)

                print(f"  ✓ Step {step_num}: {step_name} [{elapsed}s]")
                return True

            if attempt < self.MAX_RETRIES:
                index = self._read_json(self._index_file)
                for s in index["steps"]:
                    if s["step"] == step_num:
                        s["verify"] = copy.deepcopy(verify_snapshot)
                        s["status"] = "pending"
                        s["error_message"] = err_msg
                        s.pop("completed_at", None)
                        s.pop("failed_at", None)
                        s.pop("blocked_reason", None)
                        s.pop("blocked_at", None)
                self._write_json(self._index_file, index)
                prev_error = err_msg
                print(f"  ↻ Step {step_num}: retry {attempt}/{self.MAX_RETRIES} — {err_msg}")
            else:
                index = self._read_json(self._index_file)
                for s in index["steps"]:
                    if s["step"] == step_num:
                        s["verify"] = copy.deepcopy(verify_snapshot)
                        s["status"] = "error"
                        s["error_message"] = f"[{self.MAX_RETRIES}회 시도 후 실패] {err_msg}"
                        s["failed_at"] = ts
                        s.pop("completed_at", None)
                        s.pop("blocked_reason", None)
                        s.pop("blocked_at", None)
                self._write_json(self._index_file, index)
                print(f"  ✗ Step {step_num}: {step_name} failed after {self.MAX_RETRIES} attempts [{elapsed}s]")
                print(f"    Error: {err_msg}")
                self._update_top_index("error")
                sys.exit(1)

        return False  # unreachable

    def _execute_all_steps(self, guardrails: str):
        while True:
            index = self._read_json(self._index_file)
            pending = next((s for s in index["steps"] if s["status"] == "pending"), None)
            if pending is None:
                print("\n  All steps completed!")
                return

            step_num = pending["step"]
            for s in index["steps"]:
                if s["step"] == step_num and "started_at" not in s:
                    s["started_at"] = self._stamp()
                    self._write_json(self._index_file, index)
                    break

            self._execute_single_step(pending, guardrails)

    def _finalize(self):
        index = self._read_json(self._index_file)
        index["completed_at"] = self._stamp()
        self._write_json(self._index_file, index)
        self._update_top_index("completed")

        self._run_git("add", "-A")
        if self._run_git("diff", "--cached", "--quiet").returncode != 0:
            msg = f"chore({self._phase_name}): mark phase completed"
            r = self._run_git("commit", "-m", msg)
            if r.returncode == 0:
                print(f"  ✓ {msg}")

        if self._auto_push:
            branch = f"feat-{self._phase_name}"
            r = self._run_git("push", "-u", "origin", branch)
            if r.returncode != 0:
                print(f"\n  ERROR: git push 실패: {r.stderr.strip()}")
                sys.exit(1)
            print(f"  ✓ Pushed to origin/{branch}")

        print(f"\n{'='*60}")
        print(f"  Phase '{self._phase_name}' completed!")
        print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Harness Step Executor")
    parser.add_argument("phase_dir", help="Phase directory name (e.g. 0-mvp)")
    parser.add_argument("--push", action="store_true", help="Push branch after completion")
    args = parser.parse_args()

    StepExecutor(args.phase_dir, auto_push=args.push).run()


if __name__ == "__main__":
    main()
