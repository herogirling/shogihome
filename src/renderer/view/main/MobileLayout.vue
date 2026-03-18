<template>
  <div class="full mobile-layout-root">
    <div class="full row layout-main-row">
      <div class="column">
        <div
          class="evaluation-rate-bar"
          :style="{
            width: `${windowSize.width}px`,
            height: `${evaluationBarHeight}px`,
          }"
        >
          <div class="bar" :style="{ background: evaluationBarBackground }">
            <div class="sente-text">{{ senteDisplayText }}</div>
            <div class="gote-text">{{ goteDisplayText }}</div>
          </div>
        </div>
        <BoardPane
          :max-size="boardPaneMaxSize"
          :layout-type="boardLayoutType"
          @resize="onBoardPaneResize"
        />
        <MobileControls
          v-if="showRecordViewOnBottom"
          class="no-horizontal-swipe"
          :style="{ height: `${controlPaneHeight}px` }"
        />
        <RecordPane
          v-if="showRecordViewOnBottom"
          v-show="bottomUIType === BottomUIType.RECORD"
          class="no-horizontal-swipe"
          :style="{
            width: `${windowSize.width}px`,
            height: `${bottomViewSize.height}px`,
          }"
          :show-top-control="false"
          :show-bottom-control="false"
          :show-elapsed-time="true"
          :show-comment="true"
        />
        <RecordComment
          v-if="showRecordViewOnBottom"
          v-show="bottomUIType === BottomUIType.COMMENT"
          class="no-horizontal-swipe"
          :style="{
            width: `${windowSize.width}px`,
            height: `${bottomViewSize.height}px`,
          }"
        />
        <MobileResearchTable
          v-if="showRecordViewOnBottom"
          v-show="bottomUIType === BottomUIType.RESEARCH"
          class="no-horizontal-swipe"
          :style="{
            width: `${windowSize.width}px`,
            height: `${bottomViewSize.height}px`,
          }"
          :size="bottomViewSize"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
          :active="bottomUIType === BottomUIType.RESEARCH"
        />
        <EvaluationChart
          v-if="showRecordViewOnBottom"
          v-show="bottomUIType === BottomUIType.CHART"
          class="no-horizontal-swipe"
          :style="{
            width: `${windowSize.width}px`,
            height: `${bottomViewSize.height}px`,
          }"
          :size="bottomViewSize"
          :thema="appSettings.thema"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
          :type="EvaluationChartType.RAW"
          :show-legend="false"
        />
        <HorizontalSelector
          v-if="showRecordViewOnBottom"
          v-model:value="bottomUIType"
          class="no-horizontal-swipe bottom-tab-selector"
          :items="[
            { label: t.record, value: BottomUIType.RECORD },
            { label: t.comments, value: BottomUIType.COMMENT },
            { label: t.research, value: BottomUIType.RESEARCH },
            { label: t.chart, value: BottomUIType.CHART },
          ]"
          :height="selectorHeight"
        />
      </div>
      <div
        v-if="!showRecordViewOnBottom"
        class="column no-horizontal-swipe"
        :style="{ width: `${windowSize.width - boardPaneSize.width}px` }"
      >
        <MobileControls class="no-horizontal-swipe" :style="{ height: `${controlPaneHeight}px` }" />
        <RecordPane
          v-show="sideUIType === SideUIType.RECORD"
          class="no-horizontal-swipe"
          :style="{ height: `${sideViewSize.height * 0.6}px` }"
          :show-top-control="false"
          :show-bottom-control="false"
          :show-elapsed-time="true"
          :show-comment="true"
        />
        <RecordComment
          v-show="sideUIType === SideUIType.RECORD"
          class="no-horizontal-swipe"
          :style="{
            'margin-top': '5px',
            height: `${sideViewSize.height * 0.4 - 5}px`,
          }"
        />
        <MobileResearchTable
          v-show="sideUIType === SideUIType.RESEARCH"
          class="no-horizontal-swipe"
          :style="{
            width: `${sideViewSize.width}px`,
            height: `${sideViewSize.height}px`,
          }"
          :size="sideViewSize"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
          :active="sideUIType === SideUIType.RESEARCH"
        />
        <HorizontalSelector
          v-model:value="sideUIType"
          class="no-horizontal-swipe"
          :items="[
            { label: t.record, value: SideUIType.RECORD },
            { label: t.research, value: SideUIType.RESEARCH },
          ]"
          :height="selectorHeight"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
enum BottomUIType {
  RECORD = "record",
  COMMENT = "comment",
  RESEARCH = "research",
  CHART = "chart",
}
enum SideUIType {
  RECORD = "record",
  RESEARCH = "research",
}
</script>

<script setup lang="ts">
import { RectSize } from "@/common/assets/geometry";
import { BoardLayoutType, EvaluationChartType } from "@/common/settings/layout";
import { Lazy } from "@/common/helpers/lazy";
import BoardPane from "@/renderer/view/main/BoardPane.vue";
import RecordPane from "@/renderer/view/main/RecordPane.vue";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import MobileControls from "./MobileControls.vue";
import RecordComment from "@/renderer/view/tab/RecordComment.vue";
import HorizontalSelector from "@/renderer/view/primitive/HorizontalSelector.vue";
import { t } from "@/common/i18n";
import { isIOS } from "@/renderer/helpers/env";
import EvaluationChart from "@/renderer/view/tab/EvaluationChart.vue";
import { useAppSettings } from "@/renderer/store/settings";
import { useStore } from "@/renderer/store";
import { scoreToPercentage } from "@/renderer/record/score";
import { RecordCustomData } from "@/renderer/record/manager";
import MobileResearchTable from "@/renderer/view/tab/MobileResearchTable.vue";
import { AppState, ResearchState } from "@/common/control/state";

const lazyUpdateDelay = 80;
const selectorHeight = 30;
const minRecordViewWidth = 250;
const minRecordViewHeight = 130;

// iOS の多くのバージョンでは safe-area-inset-bottom が 21px になる。
// それ以外の環境もドロップシャドウの高さを考慮してマージンを持たせる。
const safeAreaMarginY = isIOS() ? 21 : 10;

const windowSize = reactive(new RectSize(window.innerWidth, window.innerHeight - safeAreaMarginY));
const bottomUIType = ref(BottomUIType.RECORD);
const sideUIType = ref(SideUIType.RECORD);
const appSettings = useAppSettings();
const store = useStore();

const windowLazyUpdate = new Lazy();
const updateSize = () => {
  windowLazyUpdate.after(() => {
    windowSize.width = window.innerWidth;
    windowSize.height = window.innerHeight - safeAreaMarginY;
  }, lazyUpdateDelay);
};

const showRecordViewOnBottom = computed(() => windowSize.height >= windowSize.width);
// 評価値バーは操作ボタンより薄めにし、盤面の表示領域を優先する。
const evaluationBarHeight = computed(() => controlPaneHeight.value * (2 / 3));
const controlPaneBaseHeight = computed(() =>
  Math.min(windowSize.height * 0.08, windowSize.width * 0.12),
);
const controlPaneHeight = computed(() => Math.max(36, controlPaneBaseHeight.value * 0.64));

// 現局面で利用可能な評価値を優先順で取り出す。
const evalInCurrentPosition = computed(() => {
  const data = store.record.current.customData as RecordCustomData | undefined;
  const info = data?.researchInfo || data?.playerSearchInfo || data?.opponentSearchInfo;
  return {
    score: info?.score,
    mate: info?.mate,
  };
});

const senteWinRate = computed(() => {
  const mate = evalInCurrentPosition.value.mate;
  const score = evalInCurrentPosition.value.score;
  if (mate !== undefined) {
    return mate > 0 ? 100 : 0;
  }
  if (score === undefined) {
    return 50;
  }
  return Math.round(scoreToPercentage(score, appSettings.coefficientInSigmoid));
});

const goteWinRate = computed(() => {
  return 100 - senteWinRate.value;
});

const senteDisplayText = computed(() => {
  const mate = evalInCurrentPosition.value.mate;
  if (mate !== undefined) {
    const ply = Math.abs(mate);
    return `${senteWinRate.value}%(詰${ply >= 999999 ? "" : ply})`;
  }
  const score = evalInCurrentPosition.value.score ?? 0;
  return `${senteWinRate.value}%(${score >= 0 ? "+" : ""}${score})`;
});

const goteDisplayText = computed(() => {
  const mate = evalInCurrentPosition.value.mate;
  if (mate !== undefined) {
    const ply = Math.abs(mate);
    return `(詰${ply >= 999999 ? "" : ply})${goteWinRate.value}%`;
  }
  const score = -(evalInCurrentPosition.value.score ?? 0);
  return `(${score >= 0 ? "+" : ""}${score})${goteWinRate.value}%`;
});

const evaluationBarBackground = computed(() => {
  // 先手勝率を境界に左右2色グラデーションでバーを描画する。
  const senteRatePercent = `${senteWinRate.value}%`;
  return `linear-gradient(to right, ${appSettings.mobileEvalBarSenteColor} 0 ${senteRatePercent}, ${appSettings.mobileEvalBarGoteColor} ${senteRatePercent} 100%)`;
});

const boardPaneMaxSize = computed(() => {
  // 盤面サイズ算出時は固定UI（評価値バー/操作/タブ）の占有分を先に差し引く。
  const maxSize = new RectSize(windowSize.width, windowSize.height);
  maxSize.height -= evaluationBarHeight.value;
  if (showRecordViewOnBottom.value) {
    maxSize.height -= controlPaneHeight.value + selectorHeight + minRecordViewHeight;
  } else {
    maxSize.width -= minRecordViewWidth;
  }
  return maxSize;
});
const boardLayoutType = computed(() => {
  // 縦横比に応じて、駒表示の詰まりにくいレイアウトを選ぶ。
  if (showRecordViewOnBottom.value) {
    return windowSize.width < windowSize.height * 0.57
      ? BoardLayoutType.PORTRAIT
      : BoardLayoutType.COMPACT;
  } else {
    return windowSize.width < windowSize.height * 1.77
      ? BoardLayoutType.PORTRAIT
      : BoardLayoutType.COMPACT;
  }
});

const boardPaneSize = ref(windowSize);
const onBoardPaneResize = (size: RectSize) => {
  boardPaneSize.value = size;
};

watch(
  () => store.appState,
  (state) => {
    // モーダル表示中に検討を継続すると操作競合しやすいため、通常画面以外では停止する。
    if (state !== AppState.NORMAL) {
      if (store.researchState === ResearchState.RUNNING) {
        store.stopResearch();
      }
    }
  },
);

const bottomViewSize = computed(() => {
  return new RectSize(
    windowSize.width,
    Math.max(
      0,
      windowSize.height -
        evaluationBarHeight.value -
        boardPaneSize.value.height -
        controlPaneHeight.value -
        selectorHeight,
    ),
  );
});
const sideViewSize = computed(() => {
  return new RectSize(
    Math.max(0, windowSize.width - boardPaneSize.value.width),
    Math.max(0, windowSize.height - controlPaneHeight.value - selectorHeight),
  );
});

onMounted(() => {
  window.addEventListener("resize", updateSize);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateSize);
});
</script>

<style scoped>
.mobile-layout-root,
.layout-main-row {
  overflow-x: hidden;
}

.no-horizontal-swipe {
  overflow-x: hidden;
  overscroll-behavior-x: none;
  touch-action: pan-y;
}

.bottom-tab-selector {
  display: block;
  margin: 0 auto;
}

.evaluation-rate-bar {
  display: flex;
  align-items: center;
}

.evaluation-rate-bar .bar {
  position: relative;
  width: 100%;
  height: 100%;
  border-top: 1px solid rgba(255, 255, 255, 0.35);
  border-bottom: 1px solid rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.evaluation-rate-bar .sente-text,
.evaluation-rate-bar .gote-text {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--main-color);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
}

.evaluation-rate-bar .sente-text {
  left: 8px;
}

.evaluation-rate-bar .gote-text {
  right: 8px;
}

.controls button {
  font-size: 100%;
  width: 100%;
  height: 100%;
}
.controls button .icon {
  height: 68%;
}
</style>
