from rknn import RKNNPlugin, fork as rknn_fork

def create_scrypted_plugin() -> RKNNPlugin:
    return RKNNPlugin()

fork = rknn_fork