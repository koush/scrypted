<template>
  <v-system-bar
    :color="color || ($vuetify.theme.dark ? undefined : 'white')"
    ><v-icon x-small v-if="icon">{{ icon }}</v-icon
    ><span class="caption" style="text-transform: uppercase; font-weight: bold">
      <slot></slot>
    </span>
  </v-system-bar>
</template>
<script>
import colors from "vuetify/es5/util/colors";

export default {
  props: ["color", "icon"],

  data() {
    return {
      colors,
    };
  },
};
</script>
