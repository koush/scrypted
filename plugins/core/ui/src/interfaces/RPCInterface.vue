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
    if (this.device) {
      this.interfaceListener = this.device.listen(this.$options._componentTag, () => this.refresh());
    }
  },
  destroyed() {
    this.interfaceListener?.removeListener();
  },
  methods: {
    refresh() {

    },
    rpc(options) {
      if (this.device) {
        return this.device;
      }

      options = options || {};
      const { varargs, append } = options;
      var vm = this;
      return new Proxy(
        {},
        {
          get: function(target, method) {
            return function() {
              var parameters = Array.prototype.slice.call(arguments);
              if (!vm.device) {
                if (append) {
                  vm.lazyValue.rpc.push({
                    method,
                    parameters,
                    varargs
                  });
                } else {
                  vm.lazyValue.rpc = {
                    method,
                    parameters,
                    varargs
                  };
                }
                vm.onInput();
                return;
              }
            };
          }
        }
      );
    }
  }
};
</script>