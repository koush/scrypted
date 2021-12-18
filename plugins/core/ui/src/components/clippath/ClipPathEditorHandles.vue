<template>
  <div class="handles">
    <div
      v-for="(coord, i) in dragCoords || lazyValue"
      :style="handleStyle(coord)"
      :key="i"
      :data-handle="i"
      class="handle"
      ref="handleRefs"
      @mousedown="mousedown"
      @mouseup="mouseup"
    >
      <div class="delete-point"></div>
    </div>
  </div>
</template>

<script type="text/babel">
import Draggabilly from "draggabilly";
import CustomValue from "../../common/CustomValue.vue";
import { cloneDeep } from "lodash";
import Vue from 'vue';

export default {
  props: ["customizing"],
  mixins: [CustomValue],

  data() {
    return {
      draggies: [],
      dragCoords: null,
    };
  },

  mounted() {
    Vue.nextTick(() => this.resetHandles());
  },

  destroyed() {
    this.clearDraggies();
  },

  watch: {
    value() {
      if (this.customizing) {
        Vue.nextTick(() => this.resetHandles());
      }
    },

    customizing() {
        Vue.nextTick(() => this.resetHandles());
    },
  },

  methods: {
    handleStyle(coord) {
      return {
        left: coord[0] + "%",
        top: coord[1] + "%",
      };
    },

    handleAdded(payload) {},

    resetHandles() {
      let handles = document.querySelectorAll(".handle");

      this.clearDraggies();

      this.$refs.handleRefs.forEach((handle) => {
        Object.assign(handle.style, this.handleStyle(this.lazyValue[handle.dataset.handle]));
        this.makeDraggable(handle);
      });
    },

    clearDraggies() {
      this.draggies.forEach((draggie) => draggie.destroy());
      this.draggies = [];
    },

    makeDraggable(handle) {
      let self = this;
      let i = handle.dataset.handle;

      handle.classList.add("draggable");

      let moved = false;
      let draggie = new Draggabilly(handle, {
        containment: true,
        grid: [0, 0],
      })
        .on("pointerDown", function () {
          moved = false;
          self.dragCoords = cloneDeep(self.lazyValue);
          document
            .querySelectorAll('[data-point="' + i + '"]')[0]
            ?.classList.add("changing");
        })
        .on("dragMove", function () {
          moved = true;
          let x = this.position.x;
          let y = this.position.y;
          self.$emit("updateHandle", { x, y, i });
        })
        .on("pointerUp", function () {
          document
            .querySelectorAll(".point")
            .forEach((point) => point.classList.remove("changing"));
          self.dragCoords = null;

          if (this.element.classList.contains("show-delete")) {
            self.$emit("removeHandle", i);

            document
              .querySelectorAll(".handle")
              .forEach((handle) => handle.classList.remove("show-delete"));

            return;
          }

          if (!moved) {
            document
              .querySelectorAll(".handle")
              .forEach((handle) => handle.classList.remove("show-delete"));

            if (self.lazyValue.length > 3) {
              this.element.classList.add("show-delete");

              setTimeout(() => {
                this.element.classList.remove("show-delete");
              }, 2500);
            }
          }
        });

      this.draggies.push(draggie);
    },

    mousedown(e) {
      console.log("mousedown");
      document
        .querySelectorAll(".handle")
        .forEach((handle) => handle.classList.remove("show-delete"));

      if (e.srcElement.classList.contains("delete-point")) {
        this.$emit(
          "removeHandle",
          parseInt(e.srcElement.parentElement.dataset.handle)
        );
      }

      if (this.lazyValue.length > 3) {
        e.target.classList.add("show-delete");
      }
    },

    mouseup(e) {
      setTimeout(() => {
        e.target.classList.remove("show-delete");
      }, 2500);
    },
  },
};
</script>

<style lang="scss">
.handles {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;

  .delete-point,
  .handle {
    position: absolute;
    width: 20px;
    height: 20px;
  }

  .handle {
    border-radius: 50%;
    box-shadow: inset 0 0 0 10px;
    opacity: 0.8;
    transition: opacity 0.25s;
    margin-top: -10px;
    margin-left: -10px;

    &.is-dragging,
    &.is-pointer-down {
      // better than using :hover/:active for touch
      z-index: 100;
      box-shadow: inset 0 0 0 3px;
      cursor: none;
      transition: box-shadow 0s;
    }

    &.draggable {
      cursor: grab;
    }

    &.show-delete {
      .delete-point {
        transform: scale3d(0.9, 0.9, 0.9);
        transition: transform 0.25s cubic-bezier(0.15, 1, 0.3, 1.1),
          opacity 0.25s;
        opacity: 1;
      }
    }

    &:after {
      display: block;
      content: "";
      position: absolute;
      top: -8px;
      left: -8px;
      right: -8px;
      bottom: -8px;
    }

    .delete-point {
      position: absolute;
      left: 22px;
      top: 0;
      width: 25px;
      padding-left: 5px;
      border-radius: 3px;
      background: #d3d0c9;
      transform: scale3d(0, 0, 0);
      transform-origin: left center;
      cursor: pointer;
      opacity: 0.75;
      clip-path: polygon(25% 0, 100% 1%, 100% 100%, 25% 100%, 0 50%);
      transition: transform 0.25s, opacity 0.25s;

      &:after {
        display: block;
        content: "";
        position: absolute;
        top: 4px;
        left: 9px;
        right: 4px;
        bottom: 4px;
        background: #100a09;
        clip-path: polygon(
          20% 10%,
          10% 20%,
          40% 50%,
          10% 80%,
          20% 90%,
          50% 60%,
          80% 90%,
          90% 80%,
          60% 50%,
          90% 20%,
          80% 10%,
          50% 40%
        );
      }
    }
  }
}

.playground:hover {
  .handle {
    opacity: 1;
  }
}

.playground.customizing .handle {
  pointer-events: none;
}
</style>
