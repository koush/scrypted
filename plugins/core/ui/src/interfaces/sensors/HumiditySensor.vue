<template>
  <span>
    <font-awesome-icon class="white--text mr-1 mr-1" size="sm" icon="tint" color="#a9afbb" />
    <span class="caption mr-1">{{ Math.round(lazyValue.humidity) }}%</span>
  </span>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
};
</script>
