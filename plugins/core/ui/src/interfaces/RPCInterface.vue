<script>
import CustomValue from "../common/CustomValue.vue";

export default {
  props: {
    device: undefined,
    value: Object,
    properties: Object,
  },
  mixins: [CustomValue],
  interfaceListener: null,
  mounted() {
    // call onChange to guarantee sane values.
    if (!this.device && !this.lazyValue.rpc) {
      this.onChange();
    }
    this.watchDevice();
  },
  destroyed() {
    this.interfaceListener?.removeListener();
  },
  watch: {
    device() {
      this.watchDevice();
    },
  },
  methods: {
    watchDevice() {
      this.interfaceListener?.removeListener();
      if (this.device) {
        this.interfaceListener = this.device.listen(
          this.$options._componentTag,
          () => this.refresh()
        );
      }
    },
    refresh() {},
    rpc(options) {
      options = options || {};

      if (this.device && !options.rpc) {
        return this.device;
      }

      const { varargs, append } = options;
      var vm = this;
      return new Proxy(
        {},
        {
          get: function (target, method) {
            return function () {
              if (vm.device && !options.rpc) return;
              var parameters = Array.prototype.slice.call(arguments);
              if (append) {
                vm.lazyValue.rpc.push({
                  method,
                  parameters,
                  varargs,
                });
              } else {
                vm.lazyValue.rpc = {
                  method,
                  parameters,
                  varargs,
                };
              }
              vm.onInput();
            };
          },
        }
      );
    },
  },
};
</script>