<script>
import cloneDeep from "lodash/cloneDeep";

export default {
  props: ["value"],
  data() {
    return {
      lazyValue: this.createLazyValue()
    };
  },
  methods: {
    createLazyValue() {
      return cloneDeep(this.value);
    },
    createInputValue() {
      return this.lazyValue;
    },
    onInput() {
      this.$emit("input", this.createInputValue());
    }
  },
  watch: {
    value() {
      this.lazyValue = this.createLazyValue();
    }
  }
};
</script>