<script>
import BasicComponent from "../BasicComponent.vue";

export default {
  mixins: [BasicComponent],
  data() {
    var self = this;
    return {
      cards: [
        {
          body: null,
          buttons: [
            {
              method: "POST",
              path: "new",
              title: "Create Device Group",
              value: "aggregate",
              click() {
                self.newDevice('aggregate');
              }
            }
          ],
          description:
            "Combine multiple devices into a single virtual device. Commands sent to the device group will be sent to all the devices in that group.",
          title: "New Device Group"
        },
      ],
      component: {
        icon: "folder-plus",
        id: "aggregate",
        name: "Device Groups"
      }
    };
  }
};
</script>