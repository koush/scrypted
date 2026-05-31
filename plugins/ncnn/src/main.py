from nc import NCNNPlugin
import predict

def create_scrypted_plugin():
    return NCNNPlugin()

async def fork():
    return predict.Fork(NCNNPlugin)
