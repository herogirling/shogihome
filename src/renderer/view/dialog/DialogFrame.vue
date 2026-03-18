<template>
  <dialog ref="dialog">
    <div class="frame" :class="{ limited }">
      <slot />
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { installHotKeyForDialog, uninstallHotKeyForDialog } from "@/renderer/devices/hotkey";
import { showModalDialog } from "@/renderer/helpers/dialog";
import { onBeforeUnmount, onMounted, ref } from "vue";

const dialog = ref();

defineProps<{
  limited?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
}>();

onMounted(() => {
  showModalDialog(dialog.value, () => emit("cancel"));
  installHotKeyForDialog(dialog.value);
});

onBeforeUnmount(() => {
  uninstallHotKeyForDialog(dialog.value);
});
</script>

<style scoped>
dialog {
  width: calc(100vw - 3px - 2em);
  height: calc(100vh - 3px - 2em);
  max-width: none;
  max-height: none;
  border: none;
  box-shadow: none;
  background-color: transparent;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  scrollbar-gutter: stable;
}

.dialog-position-center dialog {
  align-items: center;
}
.dialog-position-left dialog {
  align-items: flex-start;
}
.dialog-position-right dialog {
  align-items: flex-end;
}

.frame {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background-color: var(--dialog-bg-color);
  border: 1px solid var(--dialog-border-color);
  border-radius: 10px 10px 10px 10px;
  padding: 15px;
}
.frame.limited {
  max-width: 100%;
  max-height: 100%;
}

/* モバイルではダイアログを画面全体に拡張し、内部だけスクロールさせる。 */
@media (max-width: 800px) {
  dialog {
    position: fixed;
    inset: 0;
    width: 100dvw;
    height: 100dvh;
    min-width: 100dvw;
    min-height: 100dvh;
    max-width: 100dvw;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
  }

  .frame {
    width: 100%;
    height: 100%;
    border-radius: 0;
    border: none;
    padding: 10px;
  }
}
</style>
