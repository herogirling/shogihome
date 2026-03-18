import { issueEngineURI } from "@/common/uri.js";
import { USIEngine, USIEngineLaunchOptions, USIEngineMetadata } from "@/common/settings/usi.js";
import { GameResult } from "@/common/game/result.js";
import { TimeStates } from "@/common/game/time.js";
import type { USISessionState } from "@/common/advanced/monitor.js";

export const WEB_USI_ENGINES_STORAGE_KEY = "webUSIEngines";

const SERVER_URL_STORAGE_KEY = "usiBridgeServerURL";
const ACTIVE_SESSIONS_STORAGE_KEY = "webUSIActiveSessions";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_FAIL_LIMIT = 2;
const DEFAULT_SERVER_URL =
  (import.meta.env.VITE_USI_BRIDGE_DEFAULT_URL as string | undefined) || "http://127.0.0.1:22391";

type PersistedUSISession = {
  sessionID: number;
  serverURL: string;
  uri: string;
  name: string;
  path: string;
  createdMs: number;
  updatedMs: number;
  resume?: PersistedResumeCommand;
};

type PersistedResumeCommand =
  | {
      type: "go";
      usi: string;
      timeStatesJSON: string;
    }
  | {
      type: "go-ponder";
      usi: string;
      timeStatesJSON: string;
    }
  | {
      type: "go-infinite";
      usi: string;
    }
  | {
      type: "go-mate";
      usi: string;
      maxSeconds?: number;
    };

type USIEventHandlers = {
  onBestMove?: (sessionID: number, usi: string, usiMove: string, ponder?: string) => void;
  onCheckmate?: (sessionID: number, usi: string, usiMoves: string[]) => void;
  onCheckmateNotImplemented?: (sessionID: number) => void;
  onCheckmateTimeout?: (sessionID: number, usi: string) => void;
  onNoMate?: (sessionID: number, usi: string) => void;
  onInfo?: (sessionID: number, usi: string, json: string) => void;
};

const handlers: USIEventHandlers = {};
const eventSources = new Map<string, EventSource>();
const reconnectTimers = new Map<string, number>();
const sessionServerMap = new Map<number, string>();
const sessionMetaMap = new Map<number, PersistedUSISession>();
const heartbeatTimers = new Map<number, number>();
const heartbeatFailures = new Map<number, number>();

function loadPersistedSessions(): PersistedUSISession[] {
  // 前回ページで保持していたセッション情報を読み戻す。
  try {
    const raw = localStorage.getItem(ACTIVE_SESSIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PersistedUSISession[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((s) => s && typeof s.sessionID === "number");
  } catch {
    return [];
  }
}

function savePersistedSessions(): void {
  // メモリ上の追跡情報を都度localStorageへ反映する。
  const sessions = Array.from(sessionMetaMap.values());
  localStorage.setItem(ACTIVE_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

function removeSessionTracking(sessionID: number): void {
  // 監視タイマー/失敗回数/メタ情報をまとめて破棄する。
  const timer = heartbeatTimers.get(sessionID);
  if (timer) {
    clearInterval(timer);
  }
  heartbeatTimers.delete(sessionID);
  heartbeatFailures.delete(sessionID);
  sessionServerMap.delete(sessionID);
  sessionMetaMap.delete(sessionID);
  savePersistedSessions();
}

function markSessionActivity(sessionID: number): void {
  // UI側の「最終更新時刻」表示に使う更新時刻を進める。
  const meta = sessionMetaMap.get(sessionID);
  if (!meta) {
    return;
  }
  meta.updatedMs = Date.now();
  savePersistedSessions();
}

function updateSessionResumeCommand(sessionID: number, resume?: PersistedResumeCommand): void {
  // 直近の go 系コマンドを保存し、再接続時に同じ探索を再投入できるようにする。
  const meta = sessionMetaMap.get(sessionID);
  if (!meta) {
    return;
  }
  meta.resume = resume;
  meta.updatedMs = Date.now();
  savePersistedSessions();
}

function getServerURL(): string {
  // URLクエリ指定を最優先し、次にlocalStorage、最後にデフォルト値を使う。
  const params = new URL(window.location.toString()).searchParams;
  const fromQuery = params.get("usiBridgeURL");
  if (fromQuery) {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, fromQuery);
    return fromQuery;
  }
  return localStorage.getItem(SERVER_URL_STORAGE_KEY) || DEFAULT_SERVER_URL;
}

function normalizeServerURL(pathOrURL: string): string {
  // ユーザー入力は "IP:PORT" 形式を許容し、スキーム省略時は http を補う。
  const raw = pathOrURL.trim();
  if (!raw) {
    return getServerURL();
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  return `http://${raw}`;
}

function toURL(serverURL: string, path: string): string {
  return `${serverURL}${path}`;
}

async function postJSON<T>(serverURL: string, path: string, body: unknown): Promise<T> {
  // すべてのHTTP POSTをここに集約し、エラー整形も共通化する。
  const response = await fetch(toURL(serverURL, path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: string }).error || "unknown error")
        : `request failed: ${response.status}`;
    throw new Error(`USI bridge server error: ${message}`);
  }
  return payload as T;
}

async function sendHeartbeat(sessionID: number): Promise<void> {
  // 定期 heartbeat が一定回数連続で失敗したセッションは破棄する。
  const serverURL = getSessionServerURL(sessionID);
  try {
    await postJSON(serverURL, "/session/ping", { sessionID });
    heartbeatFailures.set(sessionID, 0);
    markSessionActivity(sessionID);
  } catch {
    const failed = (heartbeatFailures.get(sessionID) || 0) + 1;
    heartbeatFailures.set(sessionID, failed);
    if (failed >= HEARTBEAT_FAIL_LIMIT) {
      removeSessionTracking(sessionID);
    }
  }
}

function ensureHeartbeat(sessionID: number): void {
  // セッションごとに heartbeat タイマーは1本だけ作る。
  if (heartbeatTimers.has(sessionID)) {
    return;
  }
  const timer = window.setInterval(() => {
    void sendHeartbeat(sessionID);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimers.set(sessionID, timer);
  void sendHeartbeat(sessionID);
}

function scheduleReconnect(serverURL: string): void {
  // EventSource切断時の再接続を過剰に積まないよう、1URLにつき1本だけ予約する。
  if (reconnectTimers.has(serverURL)) {
    return;
  }
  const timer = window.setTimeout(() => {
    reconnectTimers.delete(serverURL);
    connectEventStream(serverURL);
  }, 2000);
  reconnectTimers.set(serverURL, timer);
}

function connectEventStream(serverURL: string): void {
  // 同じサーバーURLへのSSE接続は1本に制限する。
  if (eventSources.has(serverURL)) {
    return;
  }
  const eventSource = new EventSource(toURL(serverURL, "/events"));
  eventSources.set(serverURL, eventSource);
  eventSource.onmessage = (event) => {
    // USIブリッジサーバーから流れてくるイベントを既存ハンドラ形式に変換して中継する。
    const message = JSON.parse(event.data) as {
      type: string;
      sessionID: number;
      usi?: string;
      usiMove?: string;
      ponder?: string;
      usiMoves?: string[];
      info?: unknown;
      reason?: string;
    };
    switch (message.type) {
      case "usiBestMove":
        handlers.onBestMove?.(
          message.sessionID,
          message.usi || "",
          message.usiMove || "",
          message.ponder,
        );
        break;
      case "usiCheckmate":
        handlers.onCheckmate?.(message.sessionID, message.usi || "", message.usiMoves || []);
        break;
      case "usiCheckmateNotImplemented":
        handlers.onCheckmateNotImplemented?.(message.sessionID);
        break;
      case "usiCheckmateTimeout":
        handlers.onCheckmateTimeout?.(message.sessionID, message.usi || "");
        break;
      case "usiNoMate":
        handlers.onNoMate?.(message.sessionID, message.usi || "");
        break;
      case "usiInfo":
        handlers.onInfo?.(message.sessionID, message.usi || "", JSON.stringify(message.info || {}));
        break;
      case "sessionClosed":
        removeSessionTracking(message.sessionID);
        break;
    }
  };
  eventSource.onerror = () => {
    const current = eventSources.get(serverURL);
    current?.close();
    eventSources.delete(serverURL);
    scheduleReconnect(serverURL);
  };
}

function getSessionServerURL(sessionID: number): string {
  // セッション作成時に確定したサーバーURLを優先し、未登録時は現在設定値へフォールバックする。
  return sessionServerMap.get(sessionID) || getServerURL();
}

async function replayResumedSession(meta: PersistedUSISession): Promise<void> {
  // 復元時は保存していた最後の go 系コマンドを再送して探索状態を戻す。
  if (!meta.resume) {
    return;
  }
  const serverURL = meta.serverURL;
  switch (meta.resume.type) {
    case "go":
      await postJSON(serverURL, "/usi/go", {
        sessionID: meta.sessionID,
        usi: meta.resume.usi,
        timeStates: JSON.parse(meta.resume.timeStatesJSON) as TimeStates,
      });
      return;
    case "go-ponder":
      await postJSON(serverURL, "/usi/go-ponder", {
        sessionID: meta.sessionID,
        usi: meta.resume.usi,
        timeStates: JSON.parse(meta.resume.timeStatesJSON) as TimeStates,
      });
      return;
    case "go-infinite":
      await postJSON(serverURL, "/usi/go-infinite", {
        sessionID: meta.sessionID,
        usi: meta.resume.usi,
      });
      return;
    case "go-mate":
      await postJSON(serverURL, "/usi/go-mate", {
        sessionID: meta.sessionID,
        usi: meta.resume.usi,
        maxSeconds: meta.resume.maxSeconds,
      });
      return;
  }
}

async function restoreSessionTrackingFromStorage(): Promise<void> {
  const restored = loadPersistedSessions();
  if (!restored.length) {
    return;
  }

  // 復元可否をユーザーに確認し、不要な場合はサーバー側セッションを終了する。
  const shouldResume = window.confirm(
    "前回のエンジンセッションが見つかりました。再接続して状態を復元しますか？",
  );

  if (!shouldResume) {
    await Promise.all(
      restored.map(async (session) => {
        try {
          await postJSON(session.serverURL, "/usi/quit", { sessionID: session.sessionID });
        } catch {
          // 無視する。最終的に古いセッションはサーバー側の監視処理で回収される。
        }
      }),
    );
    localStorage.removeItem(ACTIVE_SESSIONS_STORAGE_KEY);
    return;
  }

  for (const session of restored) {
    try {
      // サーバー側セッションが存続しているか確認してから追跡を再開する。
      await postJSON(session.serverURL, "/session/resume", { sessionID: session.sessionID });
      sessionServerMap.set(session.sessionID, session.serverURL);
      sessionMetaMap.set(session.sessionID, session);
      connectEventStream(session.serverURL);
      ensureHeartbeat(session.sessionID);
      await replayResumedSession(session);
      markSessionActivity(session.sessionID);
    } catch {
      removeSessionTracking(session.sessionID);
    }
  }
}

void restoreSessionTrackingFromStorage();

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    return;
  }
  // タブ復帰時にSSE再接続とheartbeat送信を行い、切断状態を早期復旧する。
  const currentSessions = Array.from(sessionMetaMap.values());
  for (const session of currentSessions) {
    connectEventStream(session.serverURL);
    void sendHeartbeat(session.sessionID);
  }
});

window.addEventListener("online", () => {
  // オフライン復帰時に通信を即再開する。
  const currentSessions = Array.from(sessionMetaMap.values());
  for (const session of currentSessions) {
    connectEventStream(session.serverURL);
    void sendHeartbeat(session.sessionID);
  }
});

export function collectWebUSISessionStatesOnWeb(): USISessionState[] {
  // Web版でもネイティブ版と同じモニタ表示データ構造で返す。
  return Array.from(sessionMetaMap.values()).map((session) => {
    return {
      sessionID: session.sessionID,
      uri: session.uri,
      name: session.name,
      path: session.path,
      stateCode: "running",
      createdMs: session.createdMs,
      updatedMs: session.updatedMs,
      closed: false,
    } as USISessionState;
  });
}

export function setUSIBestMoveHandler(
  handler: (sessionID: number, usi: string, usiMove: string, ponder?: string) => void,
): void {
  handlers.onBestMove = handler;
  connectEventStream(getServerURL());
}

export function setUSICheckmateHandler(
  handler: (sessionID: number, usi: string, usiMoves: string[]) => void,
): void {
  handlers.onCheckmate = handler;
  connectEventStream(getServerURL());
}

export function setUSICheckmateNotImplementedHandler(handler: (sessionID: number) => void): void {
  handlers.onCheckmateNotImplemented = handler;
  connectEventStream(getServerURL());
}

export function setUSICheckmateTimeoutHandler(
  handler: (sessionID: number, usi: string) => void,
): void {
  handlers.onCheckmateTimeout = handler;
  connectEventStream(getServerURL());
}

export function setUSINoMateHandler(handler: (sessionID: number, usi: string) => void): void {
  handlers.onNoMate = handler;
  connectEventStream(getServerURL());
}

export function setUSIInfoHandler(
  handler: (sessionID: number, usi: string, json: string) => void,
): void {
  handlers.onInfo = handler;
  connectEventStream(getServerURL());
}

export async function showSelectUSIEngineDialogOnWeb(): Promise<string> {
  const path = window.prompt(
    "本機能はポート開放が可能な方を対象としています。githubからPythonプログラムをダウンロードしてサーバーを立ててください。詳細はgithub参照。\nサーバーアドレス(IP:PORT or URL)\n例：192.168.1.10:22391",
    "127.0.0.1:22391",
  );
  return path?.trim() || "";
}

export async function getUSIEngineInfoOnWeb(path: string, timeoutSeconds: number): Promise<string> {
  const serverURL = normalizeServerURL(path);
  localStorage.setItem(SERVER_URL_STORAGE_KEY, serverURL);
  connectEventStream(serverURL);
  const response = await postJSON<{ engine: USIEngine }>(serverURL, "/usi/get-engine-info", {
    timeoutSeconds,
    uri: issueEngineURI(),
  });
  response.engine.path = serverURL;
  return JSON.stringify(response.engine);
}

export async function getUSIEngineMetadataOnWeb(path: string): Promise<string> {
  const serverURL = normalizeServerURL(path);
  const metadata = await postJSON<USIEngineMetadata>(serverURL, "/usi/get-engine-metadata", {});
  return JSON.stringify(metadata);
}

export async function sendUSIOptionButtonSignalOnWeb(
  path: string,
  name: string,
  timeoutSeconds: number,
): Promise<void> {
  const serverURL = normalizeServerURL(path);
  await postJSON(serverURL, "/usi/send-option-button-signal", {
    name,
    timeoutSeconds,
  });
}

export async function usiLaunchOnWeb(engineJSON: string, optionsJSON: string): Promise<number> {
  const engine = JSON.parse(engineJSON) as USIEngine;
  const options = JSON.parse(optionsJSON) as USIEngineLaunchOptions;
  const serverURL = normalizeServerURL(engine.path);
  // 起動直後からSSE監視とheartbeatを有効化し、切断検知と復元データ保存を開始する。
  connectEventStream(serverURL);
  const response = await postJSON<{ sessionID: number }>(serverURL, "/usi/launch", {
    engine,
    options,
  });
  sessionServerMap.set(response.sessionID, serverURL);
  sessionMetaMap.set(response.sessionID, {
    sessionID: response.sessionID,
    serverURL,
    uri: engine.uri,
    name: engine.name,
    path: engine.path,
    createdMs: Date.now(),
    updatedMs: Date.now(),
    resume: undefined,
  });
  savePersistedSessions();
  ensureHeartbeat(response.sessionID);
  return response.sessionID;
}

export async function usiReadyOnWeb(sessionID: number): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/ready", { sessionID });
  markSessionActivity(sessionID);
}

export async function usiSetOptionOnWeb(
  sessionID: number,
  name: string,
  value: string,
): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/set-option", { sessionID, name, value });
  markSessionActivity(sessionID);
}

export async function usiGoOnWeb(
  sessionID: number,
  usi: string,
  timeStatesJSON: string,
): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/go", {
    sessionID,
    usi,
    timeStates: JSON.parse(timeStatesJSON) as TimeStates,
  });
  updateSessionResumeCommand(sessionID, {
    type: "go",
    usi,
    timeStatesJSON,
  });
}

export async function usiGoPonderOnWeb(
  sessionID: number,
  usi: string,
  timeStatesJSON: string,
): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/go-ponder", {
    sessionID,
    usi,
    timeStates: JSON.parse(timeStatesJSON) as TimeStates,
  });
  updateSessionResumeCommand(sessionID, {
    type: "go-ponder",
    usi,
    timeStatesJSON,
  });
}

export async function usiPonderHitOnWeb(sessionID: number, timeStatesJSON: string): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/ponder-hit", {
    sessionID,
    timeStates: JSON.parse(timeStatesJSON) as TimeStates,
  });
  markSessionActivity(sessionID);
}

export async function usiGoInfiniteOnWeb(sessionID: number, usi: string): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/go-infinite", {
    sessionID,
    usi,
  });
  updateSessionResumeCommand(sessionID, {
    type: "go-infinite",
    usi,
  });
}

export async function usiGoMateOnWeb(
  sessionID: number,
  usi: string,
  maxSeconds?: number,
): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/go-mate", {
    sessionID,
    usi,
    maxSeconds,
  });
  updateSessionResumeCommand(sessionID, {
    type: "go-mate",
    usi,
    maxSeconds,
  });
}

export async function usiStopOnWeb(sessionID: number): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/stop", { sessionID });
  updateSessionResumeCommand(sessionID, undefined);
}

export async function usiGameoverOnWeb(sessionID: number, result: GameResult): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/gameover", { sessionID, result });
  updateSessionResumeCommand(sessionID, undefined);
}

export async function usiQuitOnWeb(sessionID: number): Promise<void> {
  await postJSON(getSessionServerURL(sessionID), "/usi/quit", { sessionID });
  removeSessionTracking(sessionID);
}
