<template>
  <div>
    <dialog ref="dialog" class="menu">
      <div class="group">
        <button data-hotkey="Escape" class="close" @click="onClose">
          <Icon :icon="IconType.CLOSE" />
          <div class="label">{{ t.back }}</div>
        </button>
      </div>
      <div class="group">
        <button v-if="!playerURI" @click="selectPlayer(uri.ES_BASIC_ENGINE_STATIC_ROOK_V1)">
          <Icon :icon="IconType.ROBOT" />
          <div class="label">{{ `${t.beginner} (${t.staticRook})` }}</div>
        </button>
        <button v-if="!playerURI" @click="selectPlayer(uri.ES_BASIC_ENGINE_RANGING_ROOK_V1)">
          <Icon :icon="IconType.ROBOT" />
          <div class="label">{{ `${t.beginner} (${t.rangingRook})` }}</div>
        </button>
        <button
          v-for="engine of gameEngines"
          v-if="!playerURI"
          :key="engine.uri"
          @click="selectPlayer(engine.uri)"
        >
          <Icon :icon="IconType.ROBOT" />
          <div class="label">{{ engine.name }}</div>
        </button>
        <button v-if="playerURI" @click="selectTurn(Color.BLACK)">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.sente }}</div>
        </button>
        <button v-if="playerURI" @click="selectTurn(Color.WHITE)">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.gote }}</div>
        </button>
        <button
          v-if="playerURI"
          @click="selectTurn(Math.random() * 2 >= 1 ? Color.BLACK : Color.WHITE)"
        >
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.pieceToss }}</div>
        </button>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { t } from "@/common/i18n";
import { JishogiRule } from "@/common/settings/game";
import * as uri from "@/common/uri";
import Icon from "@/renderer/view/primitive/Icon.vue";
import { IconType } from "@/renderer/assets/icons";
import { installHotKeyForDialog, uninstallHotKeyForDialog } from "@/renderer/devices/hotkey";
import { showModalDialog } from "@/renderer/helpers/dialog";
import { useStore } from "@/renderer/store";
import { Color, InitialPositionType } from "tsshogi";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { SearchCommentFormat } from "@/common/settings/comment";
import api from "@/renderer/ipc/api";
import { getPredefinedUSIEngineTag, USIEngine, USIEngines } from "@/common/settings/usi";
import { PlayerSettings } from "@/common/settings/player";
import { useErrorStore } from "@/renderer/store/error";

const store = useStore();
const dialog = ref();
const playerURI = ref("");
const usiEngines = ref(new USIEngines());
const emit = defineEmits<{
  close: [];
}>();
const onClose = () => {
  emit("close");
};
onMounted(() => {
  showModalDialog(dialog.value, onClose);
  installHotKeyForDialog(dialog.value);
  api
    .loadUSIEngines()
    .then((engines) => {
      usiEngines.value = engines;
    })
    .catch((e) => {
      useErrorStore().add(e);
    });
});
onBeforeUnmount(() => {
  uninstallHotKeyForDialog(dialog.value);
});
const selectPlayer = (uri: string) => {
  playerURI.value = uri;
};

const gameTag = computed(() => getPredefinedUSIEngineTag("game"));

const gameEngines = computed(() => {
  // 対局用タグが付いたエンジンだけを表示して誤選択を減らす。
  return usiEngines.value.engineList
    .filter((engine) => (engine.tags || []).includes(gameTag.value))
    .map((engine) => ({
      uri: engine.uri,
      name: engine.name || engine.defaultName,
    }));
});

const buildPlayerSettings = (playerURI: string): PlayerSettings => {
  if (uri.isUSIEngine(playerURI) && usiEngines.value.hasEngine(playerURI)) {
    const engine = usiEngines.value.getEngine(playerURI) as USIEngine;
    return {
      name: engine.name,
      uri: playerURI,
      usi: engine,
    };
  }
  return {
    name: uri.isBasicEngine(playerURI) ? uri.basicEngineName(playerURI) : t.human,
    uri: playerURI,
  };
};

const selectTurn = (turn: Color) => {
  let black = buildPlayerSettings(uri.ES_HUMAN);
  let white = buildPlayerSettings(playerURI.value);
  if (turn === Color.WHITE) {
    [black, white] = [white, black];
  }
  store.startGame({
    black,
    white,
    timeLimit: {
      timeSeconds: 900,
      byoyomi: 30,
      increment: 0,
    },
    startPosition: InitialPositionType.STANDARD,
    startPositionSFEN: "",
    startPositionListFile: "",
    startPositionListOrder: "sequential",
    enableEngineTimeout: false,
    humanIsFront: true,
    enableComment: false,
    enableAutoSave: false,
    autoSaveDirectory: "",
    repeat: 1,
    parallelism: 1,
    swapPlayers: false,
    maxMoves: 1000,
    jishogiRule: JishogiRule.NONE,
    searchCommentFormat: SearchCommentFormat.SHOGIHOME,
    sprtEnabled: false,
    sprt: { elo0: 0, elo1: 3, alpha: 0.05, beta: 0.05, maxGames: 10000 },
  });
  emit("close");
};
</script>
