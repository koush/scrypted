import os
from pathlib import Path


def get_scrypted_volume():
    volume_dir = os.getenv("SCRYPTED_VOLUME") or Path.home() / ".scrypted" / "volume"
    return str(volume_dir)


def get_plugins_volume():
    volume = get_scrypted_volume()
    plugins_volume = Path(volume) / "plugins"
    return str(plugins_volume)


def get_plugin_volume(plugin_id):
    volume = get_plugins_volume()
    plugin_volume = Path(volume) / plugin_id
    return str(plugin_volume)


def ensure_plugin_volume(plugin_id):
    plugin_volume = get_plugin_volume(plugin_id)
    try:
        os.makedirs(plugin_volume, exist_ok=True)
    except Exception as e:
        pass
    return plugin_volume


def create_adm_zip_hash(hash):
    extract_version = "1-"
    return extract_version + hash


def prep(plugin_volume, hash):
    hash = create_adm_zip_hash(hash)

    zip_filename = f"{hash}.zip"
    zip_dir = os.path.join(plugin_volume, "zip")
    zip_file = os.path.join(zip_dir, zip_filename)
    unzipped_path = os.path.join(zip_dir, "unzipped")
    zip_dir_tmp = zip_dir + ".tmp"

    return {
        "unzipped_path": unzipped_path,
        "zip_filename": zip_filename,
        "zip_dir": zip_dir,
        "zip_file": zip_file,
        "zip_dir_tmp": zip_dir_tmp,
    }
