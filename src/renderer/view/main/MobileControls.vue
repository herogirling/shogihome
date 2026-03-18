<template>
  <div>
    <div class="full row controls">
      <button @click="store.changePly(0)">
        <Icon :icon="IconType.FIRST" />
      </button>
      <button @click="store.goBack()">
        <Icon :icon="IconType.BACK" />
      </button>
      <button @click="store.goForward()">
        <Icon :icon="IconType.NEXT" />
      </button>
      <button @click="store.changePly(Number.MAX_SAFE_INTEGER)">
        <Icon :icon="IconType.LAST" />
      </button>
      <button @click="store.removeCurrentMove()"><Icon :icon="IconType.DELETE" /></button>
      <button :class="{ active: isResearchRunning }" @click="onToggleResearch">
        <Icon :icon="IconType.RESEARCH" />
      </button>
      <button @click="isMobileMenuVisible = true">Menu</button>
    </div>
    <FileMenu v-if="isMobileMenuVisible" @close="isMobileMenuVisible = false" />
  </div>
</template>

<script setup lang="ts">
import { IconType } from "@/renderer/assets/icons";
import { useStore } from "@/renderer/store";
import Icon from "@/renderer/view/primitive/Icon.vue";
import FileMenu from "@/renderer/view/menu/FileMenu.vue";
import { computed, ref } from "vue";
import api from "@/renderer/ipc/api";
import { normalizeResearchSettings, validateResearchSettings } from "@/common/settings/research";
import { useErrorStore } from "@/renderer/store/error";
import { AppState, ResearchState } from "@/common/control/state";

const store = useStore();
const isMobileMenuVisible = ref(false);
const isResearchRunning = computed(() => store.researchState === ResearchState.RUNNING);

const onToggleResearch = async () => {
  if (isResearchRunning.value) {
    store.stopResearch();
    return;
  }
  if (store.appState !== AppState.NORMAL) {
    return;
  }
  try {
    const loaded = await api.loadResearchSettings();
    const settings = normalizeResearchSettings(loaded);
    const error = validateResearchSettings(settings);
    if (error) {
      useErrorStore().add(new Error("検討エンジンが未設定です。Menuから設定してください。"));
      return;
    }
    store.startResearch(settings);
  } catch (e) {
    useErrorStore().add(e);
  }
};
</script>

<style scoped>
.controls {
  overflow: hidden;
}

.controls button {
  font-size: 100%;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.controls button.active {
  border-color: #b22222;
  background-color: #b22222;
  color: #fff;
}

.controls button .icon {
  height: 68%;
}
</style>
