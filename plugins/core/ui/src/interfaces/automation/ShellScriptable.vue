<script>
import Scriptable from './Scriptable.vue'

export default {
    mixins: [
        Scriptable,
    ],
    data() {
    return {
      scriptSource: {
        filename: "script.sh",
        script: '',
        scriptTitle: "Script",
        language: "shell",
        monacoEvalDefaults: undefined,
      },
    };
    }
}
</script>
