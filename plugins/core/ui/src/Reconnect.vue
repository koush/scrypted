<template>
    <v-dialog :value="true" persistent max-width="300px">
        <v-form>
            <v-card>
                <v-card-title style="justify-content: center;" class="headline text-uppercase">Scrypted
                </v-card-title>
                <v-card-text>Connection interrupted.</v-card-text>
                <v-card-actions>
                    <v-tooltip bottom>
                        <template v-slot:activator="{ on }">
                            <v-btn v-on="on" icon href="https://discord.gg/DcFzmBHYGq">
                                <v-icon small>fab fa-discord</v-icon>
                            </v-btn>
                        </template>
                        <span>Discord</span>
                    </v-tooltip>
                    <v-tooltip bottom>
                        <template v-slot:activator="{ on }">
                            <v-btn v-on="on" icon href="https://www.reddit.com/r/Scrypted/">
                                <v-icon small>fab fa-reddit</v-icon>
                            </v-btn>
                        </template>
                        <span>Reddit</span>
                    </v-tooltip>
                    <v-tooltip bottom>
                        <template v-slot:activator="{ on }">
                            <v-btn v-on="on" icon href="https://docs.scrypted.app">
                                <v-icon small>fa fa-file-text</v-icon>
                            </v-btn>
                        </template>
                        <span>Documentation</span>
                    </v-tooltip>
                    <v-spacer></v-spacer>
                    <v-btn text @click="reconnect">Reconnect</v-btn>
                </v-card-actions>
            </v-card>
        </v-form>
    </v-dialog>
</template>
<script>
export default {
    methods: {
        reconnect() {
            this.$connectScrypted().catch((e) => (this.loginResult = e.toString()));
        },
    }
}
</script>
