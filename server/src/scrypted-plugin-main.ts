import { startPluginRemote } from "./plugin/plugin-remote-worker";

if (process.argv[2] === 'child-thread') {

}
else {
    startPluginRemote(process.argv[3]);
}