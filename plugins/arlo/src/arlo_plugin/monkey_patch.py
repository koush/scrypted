# Python Scrypted SDK is missing certain functions. This module
# helps monkey-patch necessary functions onto the SDK objects.

import scrypted_sdk

deviceManager = scrypted_sdk.deviceManager
systemManager = scrypted_sdk.systemManager

def bind(instance, func, as_name=None):
    """
    Bind the function *func* to *instance*, with either provided name *as_name*
    or the existing name of *func*. The provided *func* should accept the 
    instance as the first argument, i.e. "self".
    https://stackoverflow.com/a/1015405
    """
    if as_name is None:
        as_name = func.__name__
    bound_method = func.__get__(instance, instance.__class__)
    setattr(instance, as_name, bound_method)
    return bound_method

async def deviceManagerOnDeviceDiscovered(self, device):
    return await systemManager.api.onDeviceDiscovered(device)
bind(deviceManager, deviceManagerOnDeviceDiscovered, 'onDeviceDiscovered')