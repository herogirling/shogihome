<template>
  <div class="full root">
    <div class="list-area" :style="{ height: `${size.height}px` }">
      <div class="status-overlay">{{ researchSummary }}</div>
      <table class="list">
        <colgroup>
          <col class="col-rank" />
          <col class="col-candidate" />
          <col class="col-evaluation" />
          <col class="col-pv" />
        </colgroup>
        <thead>
          <tr class="list-header">
            <td class="rank">順位</td>
            <td class="candidate">候補手</td>
            <td class="evaluation">評価</td>
            <td class="pv">読み筋</td>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="list-item"
            :class="{ actionable: !!row.usi }"
            @click="onTapRow(row)"
          >
            <td class="rank">{{ row.rank }}</td>
            <td class="candidate">{{ row.candidate }}</td>
            <td class="evaluation">{{ row.evaluation }}</td>
            <td class="pv">{{ row.pv }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RectSize } from "@/common/assets/geometry";
import { scoreToPercentage } from "@/renderer/record/score";
import { useStore } from "@/renderer/store";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  size: { type: RectSize, required: true },
  coefficientInSigmoid: { type: Number, required: true },
  active: { type: Boolean, required: false, default: true },
});

const store = useStore();
const nowMs = ref(Date.now());
const latestBestTimeMs = ref(0);
const latestBestUpdatedAtMs = ref(Date.now());
let timerId: ReturnType<typeof setInterval> | undefined;

type Row = {
  id: number;
  rank: string;
  candidate: string;
  evaluation: string;
  pv: string;
  usi?: string;
};

const formatMateText = (mate: number): string => {
  const ply = Math.abs(mate);
  return ply >= 999999 ? "詰" : `詰${ply}`;
};

const splitCandidateAndPV = (text: string): { candidate: string; pv: string } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { candidate: "---", pv: "" };
  }

  const first = trimmed[0];
  if (first === "☗") {
    const idx = trimmed.indexOf("☖", 1);
    if (idx >= 0) {
      return {
        candidate: trimmed.slice(0, idx).trim() || "---",
        pv: trimmed.slice(idx).trim(),
      };
    }
  } else if (first === "☖") {
    const idx = trimmed.indexOf("☗", 1);
    if (idx >= 0) {
      return {
        candidate: trimmed.slice(0, idx).trim() || "---",
        pv: trimmed.slice(idx).trim(),
      };
    }
  }

  return { candidate: trimmed, pv: "" };
};

const rows = computed<Row[]>(() => {
  const monitor = store.usiMonitors.find((m) => store.isResearchEngineSessionID(m.sessionID));
  const infos = (monitor?.latestInfo || []).filter((info) => {
    return info.position === store.record.position.sfen;
  });
  if (infos.length === 0) {
    return [];
  }
  return infos.map((info, index) => {
    const { candidate, pv } = splitCandidateAndPV(info.text || "");

    let evaluationText = "50%";

    if (info.scoreMate !== undefined) {
      evaluationText = formatMateText(info.scoreMate);
    } else if (info.score !== undefined) {
      const sideToMoveWinRate = scoreToPercentage(info.score, props.coefficientInSigmoid);
      const sideWinRate = Math.round(sideToMoveWinRate);
      evaluationText = `${sideWinRate}%`;
    }

    const rank = info.multiPV || index + 1;
    const rankText = rank === 1 ? "最善手" : rank === 2 ? "次善手" : `${rank}`;

    return {
      id: info.id,
      rank: rankText,
      candidate,
      evaluation: evaluationText,
      pv,
      usi: info.pv?.[0],
    };
  });
});

watch(
  () => {
    const monitor = store.usiMonitors.find((m) => store.isResearchEngineSessionID(m.sessionID));
    const infos = (monitor?.latestInfo || []).filter((info) => {
      return info.position === store.record.position.sfen;
    });
    const best = infos.find((info) => (info.multiPV || 1) === 1) || infos[0];
    return best?.timeMs;
  },
  (timeMs) => {
    if (timeMs === undefined) {
      return;
    }
    latestBestTimeMs.value = Math.max(0, timeMs);
    latestBestUpdatedAtMs.value = Date.now();
  },
  { immediate: true },
);

onMounted(() => {
  timerId = setInterval(() => {
    nowMs.value = Date.now();
  }, 100);
});

onBeforeUnmount(() => {
  if (timerId) {
    clearInterval(timerId);
  }
});

const researchSummary = computed(() => {
  nowMs.value;
  const monitor = store.usiMonitors.find((m) => store.isResearchEngineSessionID(m.sessionID));
  const infos = (monitor?.latestInfo || []).filter((info) => {
    return info.position === store.record.position.sfen;
  });
  const best = infos.find((info) => (info.multiPV || 1) === 1) || infos[0];
  const baseTimeMs = best ? Math.max(0, best.timeMs || 0) : latestBestTimeMs.value;
  const elapsedMs = best ? Math.max(0, nowMs.value - latestBestUpdatedAtMs.value) : 0;
  const timeMs = baseTimeMs + elapsedMs;
  const totalSeconds = Math.floor(timeMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const hourText = hours > 0 ? `${hours}時間` : "";
  const minuteText = hours > 0 || minutes > 0 ? `${minutes}分` : "";
  const secondText = `${seconds}秒`;
  const nodes = best?.nodes || 0;
  const nodesText =
    nodes >= 100000000 ? `${Math.floor(nodes / 100000000)}億` : `${Math.floor(nodes / 10000)}万`;
  return `検討時間：${hourText}${minuteText}${secondText} (${nodesText}局面)`;
});

const onTapRow = (row: Row): void => {
  if (!row.usi) {
    return;
  }

  for (const monitor of store.usiMonitors) {
    if (store.isResearchEngineSessionID(monitor.sessionID)) {
      store.endUSIIteration(monitor.sessionID);
    }
  }

  const move = store.record.position.createMoveByUSI(row.usi);
  if (!move) {
    return;
  }

  store.doMove(move);

  // Ensure engines restart searching from the moved position after tap.
  store.ensureResearchAtCurrentPosition({ notifyOnError: true });
};

watch(
  [() => props.active, () => store.record.position.sfen],
  ([active]) => {
    if (!active) {
      return;
    }
    store.ensureResearchAtCurrentPosition();
  },
  { immediate: true },
);
</script>

<style scoped>
.root {
  color: var(--text-color);
  font-family: "Roboto Mono", "Consolas", "Menlo", "Courier New", monospace;
  background-color: var(--active-tab-bg-color);
}

.list-area {
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: none;
  touch-action: pan-y;
  background-color: var(--text-bg-color);
}

.status-overlay {
  position: sticky;
  top: 0;
  z-index: 4;
  height: 22px;
  line-height: 22px;
  font-size: 12px;
  text-align: left;
  padding: 0 8px;
  background-color: var(--text-bg-color);
  border-bottom: 1px solid var(--text-separator-color);
  pointer-events: none;
}

table.list {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

col.col-rank {
  width: 48px;
}

col.col-candidate {
  width: 96px;
}

col.col-evaluation {
  width: 36px;
}

col.col-pv {
  width: auto;
}

tr.list-header > td {
  position: sticky;
  top: 0;
  height: 0;
  line-height: 0;
  font-size: 0;
  font-weight: 400;
  color: transparent;
  background-color: var(--text-bg-color);
  border-bottom: none;
}

tr.list-item > td {
  height: 24px;
  font-size: 12px;
  border-bottom: none;
}

table.list td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
}

td.rank {
  text-align: center;
}

td.candidate {
  text-align: center;
  font-weight: 700;
}

td.evaluation {
  text-align: right;
  font-weight: 700;
}

tr.list-item > td.evaluation {
  padding-right: 7px;
}

tr.list-header > td.evaluation {
  text-align: center;
}

td.pv {
  text-align: left;
}

tr.list-item.actionable {
  cursor: pointer;
}
</style>
