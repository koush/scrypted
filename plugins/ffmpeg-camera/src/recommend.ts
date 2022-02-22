import { alertRecommendedPlugins } from "@scrypted/common/src/alert-recommended-plugins";

export async function recommendRebroadcast() {
    alertRecommendedPlugins({
        '@scrypted/prebuffer-mixin': 'Rebroadcast',
    });
}

export async function recommendDumbPlugins() {
    alertRecommendedPlugins({
        '@scrypted/snapshot': 'Snapshot Plugin',
        '@scrypted/opencv': 'OpenCV Motion Detection',
    });
}
