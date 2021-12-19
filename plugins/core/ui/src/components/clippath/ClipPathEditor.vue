<template>
  <div id="playground_container" class="playground-container flex">
    <v-btn-toggle mandatory v-model="pointMode">
      <v-btn @click="customizing = false" width="100px">
        {{ "Drag Points" }}
      </v-btn>
      <v-btn @click="customizing = true" width="100px">
        {{ "Add Points" }}
      </v-btn>
    </v-btn-toggle>
    <section
      @click="addHandle"
      class="playground"
      style="width: 100%; height: 100%"
      :class="{ customizing: customizing, start: !lazyValue.length }"
    >
      <div class="sandbox" style="width: 100%; height: 100%">
        <div class="shadowboard"></div>
        <div
          v-if="lazyValue.length >= 3"
          class="clipboard"
          :style="[
            { 'clip-path': clipCSS(lazyValue) },
            {
              '-webkit-clip-path': clipCSS(lazyValue),
            },
            {
              background: 'red',
              opacity: '.2',
            },
          ]"
        ></div>

        <ClipPathEditorHandles
          ref="handles"
          @updateHandle="updateHandle"
          @removeHandle="removeHandle"
          v-model="lazyValue"
          :customizing="customizing"
        ></ClipPathEditorHandles>
      </div>
    </section>
  </div>
</template>

<script>
import { clipCSS } from "./utilities";
import ClipPathEditorHandles from "./ClipPathEditorHandles.vue";
import CustomValue from "../../common/CustomValue.vue";

export default {
  mixins: [CustomValue],

  components: {
    ClipPathEditorHandles,
  },

  data() {
    return {
      pointMode: this.value.length < 3 ? 1 : 0,
      customizing: this.value.length < 3,
    };
  },

  mounted() {
    console.log("mounted clippatheditor");
  },

  watch: {
    lazyValue() {},
  },

  methods: {
    clipCSS,
    addHandle(e) {
      if (!this.customizing) return;

      let x = (e.offsetX / e.target.offsetWidth) * 100;
      let y = (e.offsetY / e.target.offsetHeight) * 100;

      this.lazyValue.push([x, y]);
      this.onInput();
    },

    updateHandle(payload) {
      let x = (payload.x / this.$refs.handles.$el.offsetWidth) * 100;
      let y = (payload.y / this.$refs.handles.$el.offsetHeight) * 100;

      this.$set(this.lazyValue, payload.i, [x, y]);
      this.onInput();
    },

    removeHandle(i) {
      this.lazyValue.splice(i, 1);

      // Event.$emit("handleRemoved");

      this.onInput();
    },
  },
};
</script>

<style lang="scss">
.playground-container {
  justify-content: center;
  flex: 1;
  position: relative;
  z-index: 100;
  padding-top: 0rem;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;

  @media (min-width: 800px) {
    border-radius: 0 0 0px 0px;
  }

  .playground {
    position: relative;
    padding: 0 0 1rem;

    &.customizing {
      cursor: crosshair;
    }

    &.start {
      .custom-notice {
        opacity: 1;
      }
    }

    .sandbox {
      position: relative;
      touch-action: none;

      .clipboard,
      .shadowboard {
        position: absolute;
        top: 0px;
        left: 0px;
        right: 0px;
        bottom: 0px;
        background: "transparent";
      }

      .shadowboard {
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.375s;

        &.on {
          opacity: 0.25;
        }
      }
    }
  }
}
</style>
