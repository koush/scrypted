<template>
  <span>
    <font-awesome-icon
      class="mr-1 mr-1"
      size="sm"
      icon="thermometer-three-quarters"
      color="#a9afbb"
    />
    <span class="caption mr-1">{{ Math.round(lazyValue.temperature) }}°</span>
  </span>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
};
</script>
