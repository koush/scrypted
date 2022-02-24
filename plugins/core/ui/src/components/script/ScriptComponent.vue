<script>
import BasicComponent from "../BasicComponent.vue";
import { typeToIcon, getDeviceViewPath } from "../helpers";

export default {
  mixins: [BasicComponent],
  async mounted() {
    const plugins = await this.$scrypted.systemManager.getComponent("plugins");
    const scriptCoreId = await plugins.getIdForNativeId(
      "@scrypted/core",
      "scriptcore"
    );
    this.$router.replace(getDeviceViewPath(scriptCoreId));
  },
};
</script>