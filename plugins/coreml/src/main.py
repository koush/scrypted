from coreml import CoreMLPlugin

class Fork:
    def __init__(self):
        self.plugin = CoreMLPlugin(forked=True)

    async def getPlugin(self):
        return self.plugin
    
    async def getTextRecognition(self):
        return await self.plugin.getDevice("textrecognition")
    
    async def getFaceRecognition(self):
        return await self.plugin.getDevice("facerecognition")
    
def create_scrypted_plugin():
    return CoreMLPlugin()

async def fork():
    return Fork()
