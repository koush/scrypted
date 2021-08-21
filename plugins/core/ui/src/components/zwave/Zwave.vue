<template>
  <router-view></router-view>
</template>
<script>
import ZwaveComponent from "./ZwaveComponent.vue";
import Nodes from "./Nodes.vue";
import Node from "./Node.vue";

export default {
  childRoutes: [
    {
      path: ":homeId",
      component: Nodes
    },
    {
      path: ":homeId/:nodeId",
      component: Node
    },
    {
      path: "",
      component: ZwaveComponent
    }
  ]
};
</script>