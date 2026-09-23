"""Executed by Blender before the worker accepts jobs."""
import bpy

preferences = bpy.context.preferences.addons["cycles"].preferences
preferences.compute_device_type = "OPTIX"
preferences.get_devices()
devices = [device.name for device in preferences.devices if device.type == "OPTIX"]
if not devices:
    raise RuntimeError("No Cycles OptiX GPU available; refusing to render on CPU")
print("SMARTINK_OPTIX_DEVICES=" + ", ".join(devices), flush=True)
