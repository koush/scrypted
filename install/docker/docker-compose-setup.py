import os
from ruamel.yaml import YAML

# Define the devices to check for
devices_to_check = [
    "/dev/dri",
    "/dev/accel",
    "/dev/apex_0",
    "/dev/apex_1",
    "/dev/kfd",
    "/dev/bus/usb"
]

# Use ruamel.yaml with better formatting preservation
yaml = YAML()
yaml.preserve_quotes = True
# Explicitly set roundtrip mode for comment preservation
yaml.typ = 'rt'
# Match the original formatting - 4 space indentation
yaml.indent = 4
# No special block sequence indentation
yaml.block_seq_indent = 0
# Don't wrap lines
yaml.width = None
# Preserve unicode
yaml.allow_unicode = True

# Read the docker-compose.yml file
with open('docker-compose.yml', 'r') as file:
    compose_data = yaml.load(file)

# Get a direct reference to the devices key
scrypted_service = compose_data['services']['scrypted']
devices = scrypted_service.setdefault('devices', [])

# Check for devices and add them if they exist
for device_path in devices_to_check:
    if os.path.exists(device_path):
        device_mapping = f"{device_path}:{device_path}"
        if device_mapping not in devices:
            devices.append(device_mapping)

# Write the modified docker-compose.yml file (preserving comments and formatting)
with open('docker-compose.yml', 'w') as file:
    yaml.dump(compose_data, file)
