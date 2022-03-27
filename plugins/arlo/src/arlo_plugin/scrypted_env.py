import os

def get_scrypted_volume():
    return os.environ.get('SCRYPTED_VOLUME', os.path.join(os.getcwd(), 'volume'))

def get_pyplugin_settings_volume():
    return os.path.join(get_scrypted_volume(), 'pypluginsettings')

def ensure_pyplugin_settings_volume():
    pyplugin_dir = get_pyplugin_settings_volume()
    if not os.path.exists(pyplugin_dir):
        os.makedirs(pyplugin_dir)

def get_pyplugin_settings_file(pluginId):
    return os.path.join(get_pyplugin_settings_volume(), f'{pluginId}.json')

def ensure_pyplugin_settings_file(pluginId):
    file = get_pyplugin_settings_file(pluginId)
    if not os.path.exists(file):
        parent = os.path.dirname(file)
        if not os.path.exists(parent):
            os.makedirs(parent)

        with open(file, 'w') as settings_file:
            settings_file.write('{}')


ensure_pyplugin_settings_volume()