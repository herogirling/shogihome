<template>
  <div>
    <dialog v-if="!isInitialPositionMenuVisible" ref="dialog" class="menu tree-menu">
      <div class="tree-root">
        <div class="title menu-title">Menu</div>

        <!-- モバイルWebでは対局/検討関連の操作を最上段にまとめる。 -->
        <div class="leaf-group" v-if="isMobileWebApp()">
          <div class="leaf-group-title">対局・検討</div>
          <button class="tree-action" @click="onFlip">
            <Icon :icon="IconType.FLIP" />
            <span>{{ t.flipBoard }}</span>
          </button>
          <button v-if="states.game" class="tree-action" @click="onGame">
            <Icon :icon="IconType.GAME" />
            <span>{{ t.game }}</span>
          </button>
          <button v-if="states.stopGame" class="tree-action" @click="onStopGame">
            <Icon :icon="IconType.STOP" />
            <span>{{ t.stopGame }}</span>
          </button>
          <button v-if="states.researchSettings" class="tree-action" @click="onResearchSettings">
            <Icon :icon="IconType.RESEARCH" />
            <span>{{ t.research }}</span>
          </button>
          <button v-if="states.stopResearch" class="tree-action" @click="onStopResearch">
            <Icon :icon="IconType.STOP" />
            <span>{{ t.endResearch }}</span>
          </button>
          <button v-if="states.analysis" class="tree-action" @click="onAnalysis">
            <Icon :icon="IconType.ANALYSIS" />
            <span>棋譜解析</span>
          </button>
          <button v-if="states.stopAnalysis" class="tree-action" @click="onStopAnalysis">
            <Icon :icon="IconType.STOP" />
            <span>{{ t.stopAnalysis }}</span>
          </button>
          <button v-if="states.manageEngines" class="tree-action" @click="onManageEngines">
            <Icon :icon="IconType.ENGINE_SETTINGS" />
            <span>{{ t.manageEngines }}</span>
          </button>
        </div>

        <div class="leaf-group">
          <div class="leaf-group-title">ファイル</div>
          <button class="tree-action" :disabled="!states.newFile" @click="onNewFile">
            <Icon :icon="IconType.FILE" />
            <span>盤面初期化</span>
          </button>
          <button class="tree-action" :disabled="!states.open" @click="onOpen">
            <Icon :icon="IconType.OPEN" />
            <span>棋譜ファイルを開く</span>
          </button>
          <button class="tree-action" :disabled="!states.paste" @click="onPaste">
            <Icon :icon="IconType.PASTE" />
            <span>クリップボードから棋譜を取り込む</span>
          </button>
          <button v-if="isNative()" class="tree-action" :disabled="!states.save" @click="onSave">
            <Icon :icon="IconType.SAVE" />
            <span>{{ t.saveOverwrite }}</span>
          </button>
          <details class="tree-node">
            <summary class="tree-action tree-summary" :class="{ disabled: !states.saveAs }">
              <Icon :icon="IconType.SAVE_AS" />
              <span>棋譜をファイルに保存</span>
            </summary>
            <div class="tree-children">
              <button v-if="isNative()" class="tree-action" :disabled="!states.saveAs" @click="onSaveAs">
                <Icon :icon="IconType.SAVE_AS" />
                <span>保存形式を選択</span>
              </button>
              <button class="tree-action" :disabled="!states.saveAs" @click="onSaveByFormat(RecordFileFormat.KIF)">
                <Icon :icon="IconType.SAVE" />
                <span>.kif形式</span>
              </button>
              <button class="tree-action" :disabled="!states.saveAs" @click="onSaveByFormat(RecordFileFormat.KIFU)">
                <Icon :icon="IconType.SAVE" />
                <span>.kifu形式</span>
              </button>
              <button class="tree-action" :disabled="!states.saveAs" @click="onSaveByFormat(RecordFileFormat.KI2)">
                <Icon :icon="IconType.SAVE" />
                <span>.ki2形式</span>
              </button>
              <button class="tree-action" :disabled="!states.saveAs" @click="onSaveByFormat(RecordFileFormat.KI2U)">
                <Icon :icon="IconType.SAVE" />
                <span>.ki2u形式</span>
              </button>
              <button class="tree-action" :disabled="!states.saveAs" @click="onSaveByFormat(RecordFileFormat.CSA)">
                <Icon :icon="IconType.SAVE" />
                <span>.csa形式</span>
              </button>
              <button class="tree-action" :disabled="!states.saveAs" @click="onSaveByFormat(RecordFileFormat.JKF)">
                <Icon :icon="IconType.SAVE" />
                <span>.jkf形式</span>
              </button>
            </div>
          </details>
          <button v-if="isNative()" class="tree-action" :disabled="!states.history" @click="onHistory">
            <Icon :icon="IconType.HISTORY" />
            <span>{{ t.history }}</span>
          </button>
          <button
            v-if="isNative()"
            class="tree-action"
            :disabled="!states.loadRemoteFile"
            @click="onLoadRemoteFile"
          >
            <Icon :icon="IconType.INTERNET" />
            <span>{{ t.loadRecordFromWeb }}</span>
          </button>
          <button
            v-if="!isMobileWebApp()"
            class="tree-action"
            :disabled="!states.exportImage"
            @click="onExportImage"
          >
            <Icon :icon="IconType.GRID" />
            <span>{{ t.positionImage }}</span>
          </button>
          <button
            v-if="isNative()"
            class="tree-action"
            :disabled="!states.batchConversion"
            @click="onBatchConversion"
          >
            <Icon :icon="IconType.BATCH" />
            <span>{{ t.batchConversion }}</span>
          </button>
          <button v-if="isNative()" class="tree-action" @click="onOpenAutoSaveDirectory">
            <Icon :icon="IconType.OPEN_FOLDER" />
            <span>{{ t.openAutoSaveDirectory }}</span>
          </button>
          <details class="tree-node">
            <summary class="tree-action tree-summary">
              <Icon :icon="IconType.COPY" />
              <span>形式を指定して棋譜をコピー</span>
            </summary>
            <div class="tree-children">
              <button class="tree-action" @click="onCopyKIF">
                <Icon :icon="IconType.COPY" />
                <span>.kif形式</span>
              </button>
              <button class="tree-action" @click="onCopyKI2">
                <Icon :icon="IconType.COPY" />
                <span>.ki2形式</span>
              </button>
              <button class="tree-action" @click="onCopyCSA">
                <Icon :icon="IconType.COPY" />
                <span>.csa形式</span>
              </button>
              <button class="tree-action" @click="onCopyJKF">
                <Icon :icon="IconType.COPY" />
                <span>.jkf形式</span>
              </button>
              <button class="tree-action" @click="onCopyUSI">
                <Icon :icon="IconType.COPY" />
                <span>.usi形式</span>
              </button>
              <button class="tree-action" @click="onCopyUSEN">
                <Icon :icon="IconType.COPY" />
                <span>.usen形式</span>
              </button>
              <button class="tree-action" @click="onCopySFEN">
                <Icon :icon="IconType.COPY" />
                <span>.sfen形式</span>
              </button>
              <button class="tree-action" @click="onCopyBOD">
                <Icon :icon="IconType.COPY" />
                <span>.bod形式</span>
              </button>
            </div>
          </details>
          <button class="tree-action" @click="onShowRecordInfo">
            <Icon :icon="IconType.DESCRIPTION" />
            <span>{{ t.recordProperties }}</span>
          </button>
          <button class="tree-action" :disabled="!states.share" @click="onShare">
            <Icon :icon="IconType.SHARE" />
            <span>{{ t.share }}</span>
          </button>
        </div>

        <div v-if="isMobileWebApp()" class="leaf-group">
          <div class="leaf-group-title">アプリ</div>
          <button class="tree-action" @click="onAppSettings">
            <Icon :icon="IconType.SETTINGS" />
            <span>{{ t.appSettings }}</span>
          </button>
          <button class="tree-action" @click="openCopyright">
            <Icon :icon="IconType.LICENSE" />
            <span>{{ t.license }}</span>
          </button>
        </div>
      </div>

      <div class="bottom-bar">
        <button data-hotkey="Escape" class="tree-action back-anchor" @click="onClose">
          <Icon :icon="IconType.CLOSE" />
          <span>{{ t.back }}</span>
        </button>
      </div>
    </dialog>
    <InitialPositionMenu v-if="isInitialPositionMenuVisible" @close="emit('close')" />
    <MobileRecordInfoMenu v-if="isRecordInfoMenuVisible" @close="isRecordInfoMenuVisible = false" />
  </div>
</template>

<script setup lang="ts">
import { t } from "@/common/i18n";
import { showModalDialog } from "@/renderer/helpers/dialog.js";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "@/renderer/view/primitive/Icon.vue";
import { IconType } from "@/renderer/assets/icons";
import { useStore } from "@/renderer/store";
import { AppState, ResearchState } from "@/common/control/state.js";
import api, { isMobileWebApp, isNative } from "@/renderer/ipc/api";
import { useAppSettings } from "@/renderer/store/settings";
import { installHotKeyForDialog, uninstallHotKeyForDialog } from "@/renderer/devices/hotkey";
import { openCopyright } from "@/renderer/helpers/copyright";
import { RecordFileFormat } from "@/common/file/record";
import InitialPositionMenu from "@/renderer/view/menu/InitialPositionMenu.vue";
import MobileRecordInfoMenu from "@/renderer/view/menu/MobileRecordInfoMenu.vue";

const emit = defineEmits<{
  close: [];
}>();

const store = useStore();
const dialog = ref();
const isInitialPositionMenuVisible = ref(false);
const isRecordInfoMenuVisible = ref(false);
const onClose = () => {
  emit("close");
};
onMounted(() => {
  showModalDialog(dialog.value, onClose);
  installHotKeyForDialog(dialog.value);
});
onBeforeUnmount(() => {
  uninstallHotKeyForDialog(dialog.value);
});
const onFlip = () => {
  useAppSettings().flipBoard();
  emit("close");
};
const onGame = () => {
  store.showGameDialog();
  emit("close");
};
const onStopGame = () => {
  store.stopGame();
  emit("close");
};
const onAnalysis = () => {
  store.showAnalysisDialog();
  emit("close");
};
const onStopAnalysis = () => {
  store.stopAnalysis();
  emit("close");
};
const onManageEngines = () => {
  store.showUsiEngineManagementDialog();
  emit("close");
};
const onResearchSettings = () => {
  store.showResearchDialog();
  emit("close");
};
const onStopResearch = () => {
  store.stopResearch();
  emit("close");
};
const onNewFile = () => {
  if (isMobileWebApp()) {
    isInitialPositionMenuVisible.value = true;
  } else {
    store.resetRecord();
    emit("close");
  }
};
const onOpen = () => {
  store.openRecord();
  emit("close");
};
const onSave = () => {
  store.saveRecord({ overwrite: true });
  emit("close");
};
const onSaveAs = () => {
  store.saveRecord();
  emit("close");
};
const onSaveByFormat = (format: RecordFileFormat) => {
  store.saveRecord({ format });
  emit("close");
};
const onHistory = () => {
  store.showRecordFileHistoryDialog();
  emit("close");
};
const onLoadRemoteFile = () => {
  store.showLoadRemoteFileDialog();
  emit("close");
};
const onShare = () => {
  store.showShareDialog();
  emit("close");
};
const onBatchConversion = () => {
  store.showBatchConversionDialog();
  emit("close");
};
const onExportImage = () => {
  store.showExportBoardImageDialog();
  emit("close");
};
const onOpenAutoSaveDirectory = async () => {
  const gameSettings = await api.loadGameSettings();
  api.openExplorer(gameSettings.autoSaveDirectory);
  emit("close");
};
const onCopyKIF = () => {
  store.copyRecordKIF();
  emit("close");
};
const onCopyKI2 = () => {
  store.copyRecordKI2();
  emit("close");
};
const onCopyCSA = () => {
  store.copyRecordCSA();
  emit("close");
};
const onCopyJKF = () => {
  store.copyRecordJKF();
  emit("close");
};
const onCopyUSI = () => {
  store.copyRecordUSI("all");
  emit("close");
};
const onCopyUSEN = () => {
  store.copyRecordUSEN();
  emit("close");
};
const onCopySFEN = () => {
  store.copyBoardSFEN();
  emit("close");
};
const onCopyBOD = () => {
  store.copyBoardBOD();
  emit("close");
};
const onPaste = () => {
  store.showPasteDialog();
  emit("close");
};
const onAppSettings = () => {
  store.showAppSettingsDialog();
  emit("close");
};
const onShowRecordInfo = () => {
  isRecordInfoMenuVisible.value = true;
};
const states = computed(() => {
  return {
    game: store.appState === AppState.NORMAL,
    stopGame: store.appState === AppState.GAME,
    analysis: store.appState === AppState.NORMAL,
    stopAnalysis: store.appState === AppState.ANALYSIS,
    researchSettings: store.appState === AppState.NORMAL,
    stopResearch: store.researchState === ResearchState.RUNNING,
    manageEngines: store.appState === AppState.NORMAL,
    newFile: store.appState === AppState.NORMAL,
    open: store.appState === AppState.NORMAL,
    save: store.appState === AppState.NORMAL,
    saveAs: store.appState === AppState.NORMAL,
    history: store.appState === AppState.NORMAL,
    loadRemoteFile: store.appState === AppState.NORMAL,
    share: store.appState === AppState.NORMAL,
    batchConversion: store.appState === AppState.NORMAL,
    exportImage: store.appState === AppState.NORMAL,
    paste: store.appState === AppState.NORMAL,
  };
});
</script>

<style scoped>
.tree-menu {
  position: fixed;
  inset: 0;
  width: 100dvw;
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  border: none;
  border-radius: 0;
  background-color: var(--dialog-bg-color);
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  touch-action: pan-y;
}

.tree-root {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 8px calc(env(safe-area-inset-bottom, 0px) + 72px) 8px;
}

.menu-title {
  margin-top: 2px;
}

.leaf-group {
  margin: 8px 0 12px;
}

.leaf-group-title {
  font-size: 0.82rem;
  opacity: 0.75;
  margin: 0 0 4px 4px;
}

.tree-node,
.tree-subnode {
  margin: 4px 0;
  border: none;
  background: transparent;
}

.tree-node > summary::-webkit-details-marker,
.tree-subnode > summary::-webkit-details-marker {
  display: none;
}

.tree-node > summary::before,
.tree-subnode > summary::before {
  content: "▸";
  display: inline-block;
  width: 1em;
  text-align: center;
  margin-right: 6px;
  transition: transform 0.15s ease;
}

.tree-node[open] > summary::before,
.tree-subnode[open] > summary::before {
  transform: rotate(90deg);
}

.tree-children {
  padding: 0 0 0 12px;
}

.tree-children.sub {
  padding-left: 14px;
}

.tree-action {
  width: 100%;
  margin: 0;
  padding: 6px 4px;
  border-radius: 0;
  border: none;
  background: transparent;
  appearance: none;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  color: var(--dialog-color);
  text-align: left;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.tree-action::before {
  content: "";
  display: inline-block;
  width: 1em;
  margin-right: 6px;
  flex: 0 0 auto;
}

.tree-action + .tree-action {
  margin-top: 1px;
}

.tree-summary {
  cursor: pointer;
  user-select: none;
  list-style: none;
  font-weight: 400;
  padding-left: 0;
}

.tree-summary.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.tree-children > .tree-action,
.tree-children .tree-subnode > summary,
.tree-children .tree-subnode .tree-action {
  padding-left: 16px;
}

.tree-summary > span {
  margin-left: 0;
}

.tree-summary .icon {
  margin-left: 0;
}

.tree-action .icon {
  width: 14px;
  height: 14px;
  opacity: 1;
  filter: var(--dialog-icon-filter);
}

.tree-action span {
  margin-left: 6px;
  font-size: 0.94rem;
  text-align: left;
}

.tree-action:enabled {
  box-shadow: none;
}

.tree-menu button,
.tree-menu button:hover,
.tree-menu button:active,
.tree-menu button:focus,
.tree-menu button:focus-visible {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}

.tree-menu summary,
.tree-menu summary:hover,
.tree-menu summary:active,
.tree-menu summary:focus,
.tree-menu summary:focus-visible {
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}

.tree-action:focus,
.tree-action:focus-visible,
.tree-action:active {
  outline: none;
  box-shadow: none;
  background: transparent;
}

.tree-action:disabled {
  opacity: 0.45;
}

.bottom-bar {
  position: fixed;
  right: 8px;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  z-index: 10;
  padding: 0;
  border-top: none;
  background-color: transparent;
}

.back-anchor {
  width: auto;
  min-width: 92px;
  padding: 8px 10px;
}
</style>
