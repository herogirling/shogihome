#!/usr/bin/env python3
"""USIエンジンブリッジサーバー。

このサーバーはローカルのUSIエンジン実行ファイルをラップし、
Webクライアント向けにHTTPエンドポイントを公開します。
USIプロトコルのメッセージはエンジンへそのまま中継します。

実行例:
    python3 scripts/usi_engine_bridge_server.py --engine "C:/engines/usi-engine.exe" --host 0.0.0.0 --port 22391
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import queue
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

USI_HASH = "USI_Hash"
USI_PONDER = "USI_Ponder"
DEFAULT_HEARTBEAT_TIMEOUT_SEC = 75
WATCHDOG_INTERVAL_SEC = 5


def parse_score_mate(arg: str) -> int:
    if arg in {"+", "+0", "0"}:
        return 100000
    if arg in {"-", "-0"}:
        return -100000
    return int(arg)


def parse_info_command(args: str) -> dict[str, Any]:
    # USI info 行をShogiHome互換のJSON形式へ変換する。
    result: dict[str, Any] = {}
    s = args.split(" ")
    i = 0
    while i < len(s):
        token = s[i]
        if token == "depth" and i + 1 < len(s):
            result["depth"] = int(s[i + 1])
            i += 2
        elif token == "seldepth" and i + 1 < len(s):
            result["seldepth"] = int(s[i + 1])
            i += 2
        elif token == "time" and i + 1 < len(s):
            result["timeMs"] = int(s[i + 1])
            i += 2
        elif token == "nodes" and i + 1 < len(s):
            result["nodes"] = int(s[i + 1])
            i += 2
        elif token == "pv":
            result["pv"] = s[i + 1 :]
            break
        elif token == "multipv" and i + 1 < len(s):
            result["multipv"] = int(s[i + 1])
            i += 2
        elif token == "score" and i + 2 < len(s):
            if s[i + 1] == "cp":
                result["scoreCP"] = int(s[i + 2])
            elif s[i + 1] == "mate":
                result["scoreMate"] = parse_score_mate(s[i + 2])
            i += 3
        elif token == "lowerbound":
            result["lowerbound"] = True
            i += 1
        elif token == "upperbound":
            result["upperbound"] = True
            i += 1
        elif token == "currmove" and i + 1 < len(s):
            result["currmove"] = s[i + 1]
            i += 2
        elif token == "hashfull" and i + 1 < len(s):
            result["hashfullPerMill"] = int(s[i + 1])
            i += 2
        elif token == "nps" and i + 1 < len(s):
            result["nps"] = int(s[i + 1])
            i += 2
        elif token == "string":
            result["string"] = " ".join(s[i + 1 :])
            break
        else:
            i += 1
    return result


def parse_option_command(command: str, current_options: dict[str, Any]) -> None:
    # option 行からUI表示用のオプション定義を抽出する。
    args = command.split(" ")
    if len(args) < 4 or args[0] != "name" or args[2] != "type":
        return
    name = args[1]
    typ = args[3]
    order = 100 + len(current_options)
    option: dict[str, Any] = {"name": name, "type": typ, "order": order}
    if typ == "combo":
        option["vars"] = []
    if typ != "button":
        i = 4
        while i + 1 < len(args):
            key = args[i]
            val = args[i + 1]
            if key == "default":
                option["default"] = int(val) if typ == "spin" else val
            elif key == "min" and typ == "spin":
                option["min"] = int(val)
            elif key == "max" and typ == "spin":
                option["max"] = int(val)
            elif key == "var" and typ == "combo":
                option["vars"].append(val)
            i += 2
    current_options[name] = option


def build_time_options(time_state: dict[str, int] | None) -> str:
    # go コマンドに渡す時間指定を、byoyomi/incrementの有無で組み立てる。
    if not time_state:
        return "infinite"
    base = f"btime {time_state['btime']} wtime {time_state['wtime']}"
    if time_state.get("binc", 0) != 0 or time_state.get("winc", 0) != 0:
        return f"{base} binc {time_state['binc']} winc {time_state['winc']}"
    return f"{base} byoyomi {time_state['byoyomi']}"


def opposite_color(color: str) -> str:
    return "white" if color == "black" else "black"


def get_next_color_from_usi(usi: str) -> str:
    # 現局面の手番を USI 文字列から推定する。
    if not usi.startswith("position "):
        return "black"

    if usi.startswith("position startpos"):
        if " moves " not in usi:
            return "black"
        moves = usi.split(" moves ", 1)[1].split(" ")
        return "black" if len([m for m in moves if m]) % 2 == 0 else "white"

    if usi.startswith("position sfen "):
        rest = usi[len("position sfen ") :]
        if " moves " in rest:
            sfen_part, moves_part = rest.split(" moves ", 1)
            moves = [m for m in moves_part.split(" ") if m]
        else:
            sfen_part = rest
            moves = []
        sfen_tokens = sfen_part.split(" ")
        # SFEN: <盤面> <手番> <持ち駒> <手数>
        side_token = sfen_tokens[1] if len(sfen_tokens) >= 2 else "b"
        base_color = "black" if side_token == "b" else "white"
        return base_color if len(moves) % 2 == 0 else opposite_color(base_color)

    return "black"


def normalize_time_state_for_usi(usi: str, time_states: dict[str, Any] | None) -> dict[str, int] | None:
    # Web側の timeStates は複数形式で渡されるため、ここでUSI go向けに統一する。
    if not time_states:
        return None

    # 入力がすでに USI go 向け形式（btime/wtime/byoyomi/binc/winc）の場合は、
    # 型だけそろえてそのまま返す。
    if "btime" in time_states and "wtime" in time_states:
        return {
            "btime": int(time_states.get("btime", 0)),
            "wtime": int(time_states.get("wtime", 0)),
            "byoyomi": int(time_states.get("byoyomi", 0)),
            "binc": int(time_states.get("binc", 0)),
            "winc": int(time_states.get("winc", 0)),
        }

    black = time_states.get("black") or {}
    white = time_states.get("white") or {}
    color = get_next_color_from_usi(usi)
    current = time_states.get(color) or {}
    byoyomi_sec = int(current.get("byoyomi", 0))

    # ShogiHome 側の変換ロジックと同じ挙動に合わせる。
    btime = int(black.get("timeMs", 0) - black.get("increment", 0) * 1000)
    wtime = int(white.get("timeMs", 0) - white.get("increment", 0) * 1000)
    return {
        "btime": max(0, btime),
        "wtime": max(0, wtime),
        "byoyomi": max(0, byoyomi_sec * 1000),
        "binc": 0 if byoyomi_sec != 0 else max(0, int(black.get("increment", 0) * 1000)),
        "winc": 0 if byoyomi_sec != 0 else max(0, int(white.get("increment", 0) * 1000)),
    }


@dataclass
class Session:
    session_id: int
    proc: subprocess.Popen[str]
    current_position: str = ""
    listeners: list[Callable[[str], None]] = field(default_factory=list)
    close_listeners: list[Callable[[], None]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    created_ms: int = 0
    updated_ms: int = 0
    last_heartbeat_ms: int = 0
    closed: bool = False


class EngineBridge:
    def __init__(self, engine_path: str, heartbeat_timeout_sec: int = DEFAULT_HEARTBEAT_TIMEOUT_SEC):
        self.engine_path = engine_path
        self.heartbeat_timeout_ms = max(30, int(heartbeat_timeout_sec)) * 1000
        self._next_id = 1
        self._sessions: dict[int, Session] = {}
        self._sessions_lock = threading.Lock()
        self._subscribers: set[queue.Queue[str]] = set()
        self._subscribers_lock = threading.Lock()
        threading.Thread(target=self._watchdog_loop, daemon=True).start()

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _remove_session(self, session_id: int) -> None:
        with self._sessions_lock:
            self._sessions.pop(session_id, None)

    def _terminate_session(self, session: Session, reason: str) -> None:
        if session.closed:
            return
        session.closed = True
        try:
            if session.proc.poll() is None:
                session.proc.terminate()
        except Exception:
            pass
        self._remove_session(session.session_id)
        self._publish(
            {
                "type": "sessionClosed",
                "sessionID": session.session_id,
                "reason": reason,
            }
        )

    def _watchdog_loop(self) -> None:
        # heartbeat が一定時間止まったセッションを自動終了してリークを防ぐ。
        while True:
            time.sleep(WATCHDOG_INTERVAL_SEC)
            now_ms = self._now_ms()
            with self._sessions_lock:
                sessions = list(self._sessions.values())
            for session in sessions:
                if session.closed:
                    continue
                if now_ms - session.last_heartbeat_ms <= self.heartbeat_timeout_ms:
                    continue
                self._terminate_session(session, "heartbeat_timeout")

    def _issue_session_id(self) -> int:
        with self._sessions_lock:
            sid = self._next_id
            self._next_id += 1
            return sid

    def _publish(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        with self._subscribers_lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            q.put(data)

    def subscribe(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue()
        with self._subscribers_lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue[str]) -> None:
        with self._subscribers_lock:
            self._subscribers.discard(q)

    def _new_process(self) -> subprocess.Popen[str]:
        # OSと実行ファイル拡張子に応じて起動経路を分岐する。
        path = Path(self.engine_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"engine not found: {path}")

        cwd = str(path.parent)
        cmd = str(path)

        if sys.platform.startswith("win") and cmd.lower().endswith((".bat", ".cmd")):
            return subprocess.Popen(
                ["cmd.exe", "/c", cmd],
                cwd=cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )

        if not sys.platform.startswith("win") and cmd.lower().endswith(".exe"):
            is_wsl = "microsoft" in platform.release().lower() or bool(os.environ.get("WSL_INTEROP"))
            if is_wsl:
                # WSL 連携では wine を介さずに Windows .exe を直接実行できる。
                try:
                    return subprocess.Popen(
                        [cmd],
                        cwd=cwd,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL,
                        text=True,
                        bufsize=1,
                    )
                except OSError:
                    # 直接実行に失敗した場合は、この後の wine 経路にフォールバックする。
                    pass

            wine = shutil.which("wine64") or shutil.which("wine")
            if not wine:
                raise PermissionError(
                    "Windows .exe cannot be executed directly on Linux/macOS. "
                    "Install wine and retry, run this USI bridge server on a Windows host, "
                    "or on WSL use a Windows path (e.g. /mnt/c/...) and enable interop."
                )
            return subprocess.Popen(
                [wine, cmd],
                cwd=cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )

        if not os.access(cmd, os.X_OK):
            raise PermissionError(
                f"permission denied: '{path.name}'. "
                "Set execute permission (chmod +x) or verify mount option 'noexec' is not set."
            )

        return subprocess.Popen(
            [cmd],
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def _start_session(self) -> Session:
        # Engine1プロセスと読取スレッドを作り、イベントをApp側へ配信する。
        sid = self._issue_session_id()
        proc = self._new_process()
        now_ms = self._now_ms()
        session = Session(
            session_id=sid,
            proc=proc,
            created_ms=now_ms,
            updated_ms=now_ms,
            last_heartbeat_ms=now_ms,
        )
        with self._sessions_lock:
            self._sessions[sid] = session

        def reader() -> None:
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = raw.strip()
                listeners = list(session.listeners)
                for listener in listeners:
                    listener(line)
                session.updated_ms = self._now_ms()
                if line.startswith("bestmove "):
                    parts = line[9:].split(" ")
                    usi_move = parts[0] if parts else ""
                    ponder = parts[2] if len(parts) >= 3 and parts[1] == "ponder" else None
                    self._publish(
                        {
                            "type": "usiBestMove",
                            "sessionID": sid,
                            "usi": session.current_position,
                            "usiMove": usi_move,
                            "ponder": ponder,
                        }
                    )
                elif line.startswith("checkmate "):
                    body = line[10:].strip()
                    if body == "notimplemented":
                        self._publish({"type": "usiCheckmateNotImplemented", "sessionID": sid})
                    elif body == "timeout":
                        self._publish(
                            {
                                "type": "usiCheckmateTimeout",
                                "sessionID": sid,
                                "usi": session.current_position,
                            }
                        )
                    elif body == "nomate":
                        self._publish(
                            {"type": "usiNoMate", "sessionID": sid, "usi": session.current_position}
                        )
                    else:
                        self._publish(
                            {
                                "type": "usiCheckmate",
                                "sessionID": sid,
                                "usi": session.current_position,
                                "usiMoves": body.split(" "),
                            }
                        )
                elif line.startswith("info "):
                    # infoは高頻度で来るため、必要項目だけ抽出して即配信する。
                    self._publish(
                        {
                            "type": "usiInfo",
                            "sessionID": sid,
                            "usi": session.current_position,
                            "info": parse_info_command(line[5:]),
                        }
                    )

            close_listeners = list(session.close_listeners)
            for callback in close_listeners:
                callback()
            session.closed = True
            self._remove_session(sid)

        threading.Thread(target=reader, daemon=True).start()
        return session

    def _send(self, session: Session, line: str) -> None:
        if session.proc.stdin is None:
            raise RuntimeError("engine stdin unavailable")
        session.proc.stdin.write(line + "\n")
        session.proc.stdin.flush()

    def _wait_for(
        self,
        session: Session,
        predicate: Callable[[str], Any],
        timeout_ms: int = 10_000,
    ) -> Any:
        # 条件に一致する行だけを待ち受け、タイムアウト時は明示的に例外化する。
        waiter: queue.Queue[Any] = queue.Queue()

        def on_line(line: str) -> None:
            out = predicate(line)
            if out is not None:
                waiter.put(("ok", out))

        def on_close() -> None:
            waiter.put(("close", None))

        session.listeners.append(on_line)
        session.close_listeners.append(on_close)
        try:
            kind, value = waiter.get(timeout=timeout_ms / 1000)
            if kind == "close":
                raise RuntimeError("engine process closed")
            return value
        except queue.Empty as e:
            raise TimeoutError("timeout waiting engine response") from e
        finally:
            if on_line in session.listeners:
                session.listeners.remove(on_line)
            if on_close in session.close_listeners:
                session.close_listeners.remove(on_close)

    def get_engine_info(self, timeout_seconds: int) -> dict[str, Any]:
        # 使い捨てセッションで usi -> usiok まで問い合わせ、メタ情報を収集する。
        session = self._start_session()
        options: dict[str, Any] = {}
        name = "NO NAME"
        author = ""

        with session.lock:
            self._send(session, "usi")

            def pred(line: str) -> bool | None:
                nonlocal name, author
                if line.startswith("id name "):
                    name = line[8:]
                elif line.startswith("id author "):
                    author = line[10:]
                elif line.startswith("option "):
                    parse_option_command(line[7:], options)
                elif line == "usiok":
                    return True
                return None

            self._wait_for(session, pred, timeout_seconds * 1000)

            if USI_HASH not in options:
                options[USI_HASH] = {"name": USI_HASH, "type": "spin", "order": 1, "default": 32}
            if USI_PONDER not in options:
                options[USI_PONDER] = {
                    "name": USI_PONDER,
                    "type": "check",
                    "order": 2,
                    "default": "true",
                }

            self._send(session, "quit")

        return {
            "uri": f"es://usi-engine/{int(time.time() * 1000)}",
            "name": name,
            "defaultName": name,
            "author": author,
            "path": "",
            "options": options,
            "labels": {"game": True, "research": True, "mate": True},
            "tags": ["対局", "検討", "詰将棋"],
            "enableEarlyPonder": False,
            "extraBook": {"enabled": False, "filePath": "", "onTheFly": False},
        }

    def send_option_button_signal(self, name: str, timeout_seconds: int) -> None:
        session = self._start_session()
        with session.lock:
            self._send(session, "usi")
            self._wait_for(session, lambda l: True if l == "usiok" else None, timeout_seconds * 1000)
            self._send(session, f"setoption name {name}")
            self._send(session, "quit")

    def launch(self, enable_early_ponder: bool = False, options: list[dict[str, Any]] | None = None) -> int:
        # 常駐セッションを起動し、受け取ったオプション値を起動時に反映する。
        session = self._start_session()
        with session.lock:
            self._send(session, "usi")
            self._wait_for(session, lambda l: True if l == "usiok" else None)
            for option in options or []:
                if option.get("type") == "button":
                    continue
                value = option.get("value", option.get("default"))
                if value is not None:
                    self._send(session, f"setoption name {option['name']} value {value}")
        session.enable_early_ponder = bool(enable_early_ponder)  # type: ignore[attr-defined]
        return session.session_id

    def _get_session(self, session_id: int) -> Session:
        with self._sessions_lock:
            session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"No engine session: SessionID={session_id}")
        now_ms = self._now_ms()
        session.updated_ms = now_ms
        return session

    def ping(self, session_id: int) -> None:
        # Webクライアントからの定期heartbeat受信時に監視時刻を更新する。
        session = self._get_session(session_id)
        now_ms = self._now_ms()
        session.last_heartbeat_ms = now_ms
        session.updated_ms = now_ms

    def resume(self, session_id: int) -> dict[str, Any]:
        session = self._get_session(session_id)
        now_ms = self._now_ms()
        session.last_heartbeat_ms = now_ms
        session.updated_ms = now_ms
        return {
            "currentPosition": session.current_position,
        }

    def ready(self, session_id: int) -> None:
        # isready -> readyok を確認してから usinewgame を送る。
        session = self._get_session(session_id)
        with session.lock:
            self._send(session, "isready")
            self._wait_for(session, lambda l: True if l == "readyok" else None)
            self._send(session, "usinewgame")

    def set_option(self, session_id: int, name: str, value: str) -> None:
        session = self._get_session(session_id)
        with session.lock:
            self._send(session, f"setoption name {name} value {value}")

    def go(self, session_id: int, usi: str, time_states: dict[str, int]) -> None:
        session = self._get_session(session_id)
        with session.lock:
            session.current_position = usi
            self._send(session, usi)
            normalized = normalize_time_state_for_usi(usi, time_states)
            self._send(session, f"go {build_time_options(normalized)}")

    def go_ponder(self, session_id: int, usi: str, time_states: dict[str, int]) -> None:
        session = self._get_session(session_id)
        with session.lock:
            session.current_position = usi
            self._send(session, usi)
            normalized = normalize_time_state_for_usi(usi, time_states)
            self._send(session, f"go ponder {build_time_options(normalized)}")

    def ponder_hit(self, session_id: int, time_states: dict[str, int]) -> None:
        session = self._get_session(session_id)
        with session.lock:
            enable_early_ponder = bool(getattr(session, "enable_early_ponder", False))
            if enable_early_ponder:
                normalized = normalize_time_state_for_usi(session.current_position, time_states)
                self._send(session, f"ponderhit {build_time_options(normalized)}")
            else:
                self._send(session, "ponderhit")

    def go_infinite(self, session_id: int, usi: str) -> None:
        session = self._get_session(session_id)
        with session.lock:
            session.current_position = usi
            self._send(session, usi)
            self._send(session, "go infinite")

    def go_mate(self, session_id: int, usi: str, max_seconds: float | None) -> None:
        session = self._get_session(session_id)
        with session.lock:
            session.current_position = usi
            self._send(session, usi)
            if max_seconds and max_seconds > 0:
                self._send(session, f"go mate {int(max_seconds * 1000)}")
            else:
                self._send(session, "go mate infinite")

    def stop(self, session_id: int) -> None:
        session = self._get_session(session_id)
        with session.lock:
            self._send(session, "stop")

    def gameover(self, session_id: int, result: str) -> None:
        session = self._get_session(session_id)
        with session.lock:
            self._send(session, f"gameover {result}")

    def quit(self, session_id: int) -> None:
        session = self._get_session(session_id)
        with session.lock:
            self._send(session, "quit")
            session.closed = True


class Handler(BaseHTTPRequestHandler):
    server_version = "USIEngineBridgeServer/1.0"

    def _json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        body = self.rfile.read(length)
        return json.loads(body.decode("utf-8"))

    def do_GET(self) -> None:
        bridge: EngineBridge = self.server.bridge  # type: ignore[attr-defined]
        if self.path == "/health":
            self._json(HTTPStatus.OK, {"ok": True})
            return
        if self.path == "/events":
            q = bridge.subscribe()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                while True:
                    data = q.get()
                    self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                bridge.unsubscribe(q)
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        bridge: EngineBridge = self.server.bridge  # type: ignore[attr-defined]
        try:
            # WebクライアントからのAPI呼び出しを、EngineBridgeのメソッドへ1対1で中継する。
            data = self._read_json()
            if self.path == "/usi/get-engine-info":
                timeout = int(data.get("timeoutSeconds", 10))
                engine = bridge.get_engine_info(timeout)
                engine["uri"] = data.get("uri") or engine["uri"]
                self._json(HTTPStatus.OK, {"engine": engine})
                return
            if self.path == "/usi/get-engine-metadata":
                self._json(HTTPStatus.OK, {"isShellScript": False, "isRemote": True})
                return
            if self.path == "/usi/send-option-button-signal":
                bridge.send_option_button_signal(str(data["name"]), int(data.get("timeoutSeconds", 10)))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/launch":
                engine = data.get("engine", {})
                sid = bridge.launch(
                    bool(engine.get("enableEarlyPonder", False)),
                    list((engine.get("options") or {}).values()),
                )
                self._json(HTTPStatus.OK, {"sessionID": sid})
                return
            if self.path == "/usi/ready":
                bridge.ready(int(data["sessionID"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/set-option":
                bridge.set_option(int(data["sessionID"]), str(data["name"]), str(data["value"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/go":
                bridge.go(int(data["sessionID"]), str(data["usi"]), data.get("timeStates") or {})
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/go-ponder":
                bridge.go_ponder(int(data["sessionID"]), str(data["usi"]), data.get("timeStates") or {})
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/ponder-hit":
                bridge.ponder_hit(int(data["sessionID"]), data.get("timeStates") or {})
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/go-infinite":
                bridge.go_infinite(int(data["sessionID"]), str(data["usi"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/go-mate":
                bridge.go_mate(int(data["sessionID"]), str(data["usi"]), data.get("maxSeconds"))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/stop":
                bridge.stop(int(data["sessionID"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/gameover":
                bridge.gameover(int(data["sessionID"]), str(data["result"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/usi/quit":
                bridge.quit(int(data["sessionID"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/session/ping":
                bridge.ping(int(data["sessionID"]))
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if self.path == "/session/resume":
                resume_info = bridge.resume(int(data["sessionID"]))
                self._json(HTTPStatus.OK, {"ok": True, **resume_info})
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(e)})


def main() -> None:
    parser = argparse.ArgumentParser(description="USI Engine Bridge Server")
    parser.add_argument("--engine", required=True, help="Path to USI engine executable")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=22391)
    args = parser.parse_args()

    bridge = EngineBridge(args.engine)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.bridge = bridge  # type: ignore[attr-defined]

    print(f"[usi-engine-bridge-server] listening on http://{args.host}:{args.port}")
    print(f"[usi-engine-bridge-server] engine={args.engine}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
