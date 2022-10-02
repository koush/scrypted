<template>
  <v-list-item-group>
    <v-list-item
      @click="
        mixin.enabled = !mixin.enabled;
        toggleMixin(mixin);
      "
      v-for="mixin in availableMixins"
      :key="mixin.id"
      inactive
    >
      <v-list-item-action>
        <v-checkbox
          dense
          @click.stop
          @change="toggleMixin(mixin)"
          v-model="mixin.enabled"
          color="primary"
        ></v-checkbox>
      </v-list-item-action>

      <v-list-item-content>
        <v-list-item-subtitle>{{ mixin.name }}</v-list-item-subtitle>
      </v-list-item-content>

      <v-list-item-action
        ><v-btn small :to="getDeviceViewPath(mixin.id)" @click.stop
          ><v-icon x-small>fa-external-link-alt</v-icon></v-btn
        ></v-list-item-action
      >
    </v-list-item>
  </v-list-item-group>
</template>
<script>
import Mixin from "./Mixin.vue";
import { getDeviceViewPath } from './helpers';

export default {
    props: ["device"],
    mixins: [
        Mixin,
    ],
    methods: {
      getDeviceViewPath,
    }
};
</script>
