import os

def getScryptedVolume():
    return os.environ.get('SCRYPTED_VOLUME', os.path.join(os.getcwd(), 'volume'))

def getPyPluginSettingsVolume():
    return os.path.join(getScryptedVolume(), 'pypluginsettings')

def ensurePyPluginSettingsVolume():
    pypluginDir = getPyPluginSettingsVolume()
    if not os.path.exists(pypluginDir):
        os.makedirs(pypluginDir)

def getPyPluginSettingsFile(pluginId):
    return os.path.join(getPyPluginSettingsVolume(), f'{pluginId}.json')

def ensurePyPluginSettingsFile(pluginId):
    file = getPyPluginSettingsFile(pluginId)
    if not os.path.exists(file):
        parent = os.path.dirname(file)
        if not os.path.exists(parent):
            os.makedirs(parent)

        with open(file, 'w') as settingsFile:
            settingsFile.write('{}')

def getPluginInstallDirectory():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))), "unzipped")

ensurePyPluginSettingsVolume()