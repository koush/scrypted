<template>
  <span>
    <font-awesome-icon class="white--text mr-2 ml-2" size="sm" icon="thermometer-three-quarters" color="#a9afbb" />
    <span class="caption mr-2">{{ Math.round(lazyValue.temperature) }}°</span>
  </span>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
};
</script>
