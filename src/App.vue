<script setup lang="ts">
import { onMounted, provide } from "vue";
import { useAgentState } from "@/composables/useAgentState";

const state = useAgentState();
provide("agentState", state);

onMounted(() => {
  state.initialize();
});
</script>

<template>
  <router-view />
</template>
