from armnn import ArmNNPlugin, fork as armnn_fork

def create_scrypted_plugin():
    return ArmNNPlugin()

fork = armnn_fork