import { alertRecommendedPlugins } from "@scrypted/common/src/alert-recommended-plugins";

export async function recommendRebroadcast() {
    alertRecommendedPlugins({
        '@scrypted/prebuffer-mixin': 'Rebroadcast',
    });
}
