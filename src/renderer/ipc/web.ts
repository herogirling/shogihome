/* eslint-disable no-console */
import { defaultAnalysisSettings } from "@/common/settings/analysis.js";
import { defaultAppSettings } from "@/common/settings/app.js";
import { defaultGameSettings } from "@/common/settings/game.js";
import { defaultResearchSettings } from "@/common/settings/research.js";
import { USIEngines } from "@/common/settings/usi.js";
import { LogLevel } from "@/common/log.js";
import { Bridge } from "@/renderer/ipc/bridge.js";
import { t } from "@/common/i18n/index.js";
import { defaultCSAGameSettingsHistory } from "@/common/settings/csa.js";
import { defaultMateSearchSettings } from "@/common/settings/mate.js";
import { defaultBatchConversionSettings } from "@/common/settings/conversion.js";
import { getEmptyHistory } from "@/common/file/history.js";
import { VersionStatus } from "@/common/version.js";
import { blankOSState, SessionStates, MachineSpec } from "@/common/advanced/monitor.js";
import { emptyLayoutProfileList } from "@/common/settings/layout.js";
import * as uri from "@/common/uri.js";
import { basename } from "@/renderer/helpers/path.js";
import { ProcessArgs } from "@/common/ipc/process";
import { getPieceImageAssetNameByIndex } from "@/common/assets/pieces.js";
import {
  collectWebUSISessionStatesOnWeb,
  getUSIEngineInfoOnWeb,
  getUSIEngineMetadataOnWeb,
  sendUSIOptionButtonSignalOnWeb,
  setUSIBestMoveHandler,
  setUSICheckmateHandler,
  setUSICheckmateNotImplementedHandler,
  setUSICheckmateTimeoutHandler,
  setUSIInfoHandler,
  setUSINoMateHandler,
  showSelectUSIEngineDialogOnWeb,
  usiGameoverOnWeb,
  usiGoInfiniteOnWeb,
  usiGoMateOnWeb,
  usiGoOnWeb,
  usiGoPonderOnWeb,
  usiLaunchOnWeb,
  usiPonderHitOnWeb,
  usiQuitOnWeb,
  usiReadyOnWeb,
  usiSetOptionOnWeb,
  usiStopOnWeb,
  WEB_USI_ENGINES_STORAGE_KEY,
} from "@/renderer/ipc/web_usi_bridge.js";

enum STORAGE_KEY {
  APP_SETTINGS = "appSetting",
  RESEARCH_SETTINGS = "researchSetting",
  BATCH_CONVERSION_SETTINGS = "batchConversionSetting",
  ANALYSIS_SETTINGS = "analysisSetting",
  GAME_SETTINGS = "gameSetting",
  MATE_SEARCH_SETTINGS = "mateSearchSetting",
  CSA_GAME_SETTINGS_HISTORY = "csaGameSettingHistory",
}

const fileCache = new Map<string, ArrayBuffer>();
const WEB_PIECE_MAP_PREFIX = "piece-map://";
const PIECE_MARGIN_RATIO = 0.05;

function selectSingleImageAsDataURL(): Promise<string> {
  const input = document.createElement("input");
  input.setAttribute("type", "file");
  input.setAttribute("accept", "image/*");
  return new Promise<string>((resolve, reject) => {
    input.click();
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve("");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result);
          return;
        }
        reject(new Error("failed to read selected image"));
      };
      reader.onerror = () => reject(new Error("failed to read selected image"));
      reader.readAsDataURL(file);
    };
    input.oncancel = () => {
      resolve("");
    };
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to load image"));
    image.src = src;
  });
}

function cropSpriteToPieceMap(src: HTMLImageElement, deleteMargin: boolean): string {
  const cellWidth = src.width / 8;
  const cellHeight = src.height / 4;
  if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
    throw new Error("cannot get image metadata");
  }
  const pieceMap: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas is not available");
  }

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row === 1 && col === 3) || (row === 3 && col === 3)) {
        continue;
      }
      const assetName = getPieceImageAssetNameByIndex(row, col);
      const marginRatio = deleteMargin ? PIECE_MARGIN_RATIO : 0;
      const x = cellWidth * col + cellWidth * marginRatio;
      const y = cellHeight * row + cellHeight * marginRatio;
      const w = cellWidth * (1 - marginRatio * 2);
      const h = cellHeight * (1 - marginRatio * 2);
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(src, x, y, w, h, 0, 0, canvas.width, canvas.height);
      pieceMap[assetName] = canvas.toDataURL("image/png");
    }
  }

  return WEB_PIECE_MAP_PREFIX + encodeURIComponent(JSON.stringify(pieceMap));
}

// Electron を使わずにシンプルな Web アプリケーションとして実行した場合に使用します。
export const webAPI: Bridge = {
  // Core
  updateAppState(): void {
    // DO NOTHING
  },
  async fetchProcessArgs(): Promise<string> {
    return JSON.stringify({} as ProcessArgs);
  },
  onClosable(): void {
    // Do Nothing
  },
  onClose(): void {
    // Do Nothing
  },
  onSendError(): void {
    // Do Nothing
  },
  onSendMessage(): void {
    // Do Nothing
  },
  onMenuEvent(): void {
    // Do Nothing
  },

  // Settings
  async loadAppSettings(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.APP_SETTINGS);
    if (!json) {
      return JSON.stringify(defaultAppSettings());
    }
    return JSON.stringify({
      ...defaultAppSettings(),
      ...JSON.parse(json),
    });
  },
  async saveAppSettings(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.APP_SETTINGS, json);
  },
  async loadBatchConversionSettings(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.BATCH_CONVERSION_SETTINGS);
    if (!json) {
      return JSON.stringify(defaultBatchConversionSettings());
    }
    return JSON.stringify({
      ...defaultBatchConversionSettings(),
      ...JSON.parse(json),
    });
  },
  async saveBatchConversionSettings(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.BATCH_CONVERSION_SETTINGS, json);
  },
  async loadResearchSettings(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.RESEARCH_SETTINGS);
    if (!json) {
      return JSON.stringify(defaultResearchSettings());
    }
    return JSON.stringify({
      ...defaultResearchSettings(),
      ...JSON.parse(json),
    });
  },
  async saveResearchSettings(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.RESEARCH_SETTINGS, json);
  },
  async loadAnalysisSettings(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.ANALYSIS_SETTINGS);
    if (!json) {
      return JSON.stringify(defaultAnalysisSettings());
    }
    return JSON.stringify({
      ...defaultAnalysisSettings(),
      ...JSON.parse(json),
    });
  },
  async saveAnalysisSettings(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.ANALYSIS_SETTINGS, json);
  },
  async loadGameSettings(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.GAME_SETTINGS);
    if (!json) {
      return JSON.stringify({
        ...defaultGameSettings(),
        enableAutoSave: false,
      });
    }
    return JSON.stringify({
      ...defaultGameSettings(),
      ...JSON.parse(json),
    });
  },
  async saveGameSettings(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.GAME_SETTINGS, json);
  },
  async loadCSAGameSettingsHistory(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.CSA_GAME_SETTINGS_HISTORY);
    if (!json) {
      return JSON.stringify(defaultCSAGameSettingsHistory());
    }
    return JSON.stringify({
      ...defaultCSAGameSettingsHistory(),
      ...JSON.parse(json),
    });
  },
  async saveCSAGameSettingsHistory(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.CSA_GAME_SETTINGS_HISTORY, json);
  },
  async loadMateSearchSettings(): Promise<string> {
    const json = localStorage.getItem(STORAGE_KEY.MATE_SEARCH_SETTINGS);
    if (!json) {
      return JSON.stringify(defaultMateSearchSettings());
    }
    return JSON.stringify({
      ...defaultMateSearchSettings(),
      ...JSON.parse(json),
    });
  },
  async saveMateSearchSettings(json: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY.MATE_SEARCH_SETTINGS, json);
  },
  async loadUSIEngines(): Promise<string> {
    const json = localStorage.getItem(WEB_USI_ENGINES_STORAGE_KEY);
    if (!json) {
      return new USIEngines().json;
    }
    return json;
  },
  async saveUSIEngines(json: string): Promise<void> {
    localStorage.setItem(WEB_USI_ENGINES_STORAGE_KEY, json);
  },
  async loadBookImportSettings(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async saveBookImportSettings(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  onUpdateAppSettings(): void {
    // Do Nothing
  },

  // Record File
  async showOpenRecordDialog(formats: string[]): Promise<string> {
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", formats.join(","));
    return new Promise<string>((resolve, reject) => {
      input.click();
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) {
          file
            .arrayBuffer()
            .then((data) => {
              const fileURI = uri.issueTempFileURI(file.name);
              fileCache.clear();
              fileCache.set(fileURI, data);
              resolve(fileURI);
            })
            .catch((error) => {
              reject(error);
            });
        } else {
          reject(new Error("invalid file"));
        }
      };
      input.oncancel = () => {
        resolve("");
      };
    });
  },
  async showSaveRecordDialog(defualtPath: string): Promise<string> {
    return defualtPath;
  },
  async showSaveMergedRecordDialog(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async openRecord(uri: string): Promise<Uint8Array> {
    const data = fileCache.get(uri);
    if (data) {
      return new Uint8Array(data);
    }
    return Promise.reject(new Error("invalid URI"));
  },
  async saveRecord(path: string, data: Uint8Array): Promise<void> {
    const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = basename(path);
    a.click();
    URL.revokeObjectURL(url);
  },
  async loadRecordFileHistory(): Promise<string> {
    return JSON.stringify(getEmptyHistory());
  },
  addRecordFileHistory(): void {
    // Do Nothing
  },
  async clearRecordFileHistory(): Promise<void> {
    // Do Nothing
  },
  async saveRecordFileBackup(): Promise<void> {
    // Do Nothing
  },
  async loadRecordFileBackup(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async loadRemoteTextFile(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async convertRecordFiles(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async showSelectSFENDialog(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async loadSFENFile(): Promise<string[]> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  onOpenRecord(): void {
    // Do Nothing
  },

  // Book
  async showOpenBookDialog(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async showSaveBookDialog(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async clearBook(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async openBook(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async openBookAsNewSession(): Promise<number> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async closeBookSession(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async saveBook(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async searchBookMoves(): Promise<string> {
    return "[]";
  },
  async updateBookMove(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async removeBookMove(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async updateBookMoveOrder(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async importBookMoves(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },

  // USI
  async showSelectUSIEngineDialog(): Promise<string> {
    return await showSelectUSIEngineDialogOnWeb();
  },
  async getUSIEngineInfo(path: string, timeoutSeconds: number): Promise<string> {
    return await getUSIEngineInfoOnWeb(path, timeoutSeconds);
  },
  async getUSIEngineMetadata(path: string): Promise<string> {
    return await getUSIEngineMetadataOnWeb(path);
  },
  async sendUSIOptionButtonSignal(path: string, name: string, timeoutSeconds: number): Promise<void> {
    await sendUSIOptionButtonSignalOnWeb(path, name, timeoutSeconds);
  },
  async usiLaunch(json: string, options: string): Promise<number> {
    return await usiLaunchOnWeb(json, options);
  },
  async usiReady(sessionID: number): Promise<void> {
    await usiReadyOnWeb(sessionID);
  },
  async usiSetOption(sessionID: number, name: string, value: string): Promise<void> {
    await usiSetOptionOnWeb(sessionID, name, value);
  },
  async usiGo(sessionID: number, usi: string, timeStatesJSON: string): Promise<void> {
    await usiGoOnWeb(sessionID, usi, timeStatesJSON);
  },
  async usiGoPonder(sessionID: number, usi: string, timeStatesJSON: string): Promise<void> {
    await usiGoPonderOnWeb(sessionID, usi, timeStatesJSON);
  },
  async usiPonderHit(sessionID: number, timeStatesJSON: string): Promise<void> {
    await usiPonderHitOnWeb(sessionID, timeStatesJSON);
  },
  async usiGoInfinite(sessionID: number, usi: string): Promise<void> {
    await usiGoInfiniteOnWeb(sessionID, usi);
  },
  async usiGoMate(sessionID: number, usi: string, maxSeconds?: number): Promise<void> {
    await usiGoMateOnWeb(sessionID, usi, maxSeconds);
  },
  async usiStop(sessionID: number): Promise<void> {
    await usiStopOnWeb(sessionID);
  },
  async usiGameover(sessionID: number, result): Promise<void> {
    await usiGameoverOnWeb(sessionID, result);
  },
  async usiQuit(sessionID: number): Promise<void> {
    await usiQuitOnWeb(sessionID);
  },
  onUSIBestMove(callback): void {
    setUSIBestMoveHandler(callback);
  },
  onUSICheckmate(callback): void {
    setUSICheckmateHandler(callback);
  },
  onUSICheckmateNotImplemented(callback): void {
    setUSICheckmateNotImplementedHandler(callback);
  },
  onUSICheckmateTimeout(callback): void {
    setUSICheckmateTimeoutHandler(callback);
  },
  onUSINoMate(callback): void {
    setUSINoMateHandler(callback);
  },
  onUSIInfo(callback): void {
    setUSIInfoHandler(callback);
  },

  // CSA
  async csaLogin(): Promise<number> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async csaLogout(): Promise<void> {
    // Do Nothing
  },
  async csaAgree(): Promise<void> {
    // Do Nothing
  },
  async csaMove(): Promise<void> {
    // Do Nothing
  },
  async csaResign(): Promise<void> {
    // Do Nothing
  },
  async csaWin(): Promise<void> {
    // Do Nothing
  },
  async csaStop(): Promise<void> {
    // Do Nothing
  },
  onCSAGameSummary(): void {
    // Do Nothing
  },
  onCSAReject(): void {
    // Do Nothing
  },
  onCSAStart(): void {
    // Do Nothing
  },
  onCSAMove(): void {
    // Do Nothing
  },
  onCSAGameResult(): void {
    // Do Nothing
  },
  onCSAClose(): void {
    // Do Nothing
  },

  // Sessions
  async collectSessionStates(): Promise<string> {
    return JSON.stringify({
      os: blankOSState(),
      usiSessions: collectWebUSISessionStatesOnWeb(),
      csaSessions: [],
    } as SessionStates);
  },
  async setupPrompt(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async openPrompt() {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  invokePromptCommand(): void {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  onPromptCommand(): void {
    // Do Nothing
  },

  // Images
  async showSelectImageDialog(): Promise<string> {
    return await selectSingleImageAsDataURL();
  },
  async cropPieceImage(srcURL: string, deleteMargin: boolean): Promise<string> {
    if (!srcURL) {
      throw new Error("invalid image URL");
    }
    const image = await loadImageElement(srcURL);
    return cropSpriteToPieceMap(image, deleteMargin);
  },
  async exportCaptureAsPNG(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async exportCaptureAsJPEG(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },

  // Layout
  async loadLayoutProfileList(): Promise<[string, string]> {
    return [uri.ES_STANDARD_LAYOUT_PROFILE, JSON.stringify(emptyLayoutProfileList())];
  },
  updateLayoutProfileList(): void {
    // Do Nothing
  },
  onUpdateLayoutProfile(): void {
    // Do Nothing
  },
  createDesktopShortcutForLayoutProfile(): Promise<void> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },

  // Log
  openLogFile(): void {
    // Do Nothing
  },
  log(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.log(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  },

  // MISC
  async showSelectFileDialog(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  async showSelectDirectoryDialog(): Promise<string> {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  openExplorer() {
    // DO NOTHING
  },
  openWebBrowser(url: string) {
    window.open(url, "_blank");
  },
  async getMachineSpec(): Promise<string> {
    const spec: MachineSpec = { cpuCores: 1, memory: 1024 ** 2 };
    return JSON.stringify(spec);
  },
  async isEncryptionAvailable(): Promise<boolean> {
    return false;
  },
  async getVersionStatus(): Promise<string> {
    return JSON.stringify({} as VersionStatus);
  },
  sendTestNotification(): void {
    throw new Error(t.thisFeatureNotAvailableOnWebApp);
  },
  getPathForFile(file: File): string {
    return file.name;
  },
  onProgress(): void {
    // Do Nothing
  },
};
