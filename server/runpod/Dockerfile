FROM ubuntu:24.04

ARG BLENDER_VERSION=5.2.1
ARG BLENDER_SHA256=a31f524fa99a527d3d52b7f5aaa68c34e1a19d5a1c9473f79c5cc610fd5b10e9
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RUNPOD_LOG_LEVEL=INFO \
    PATH=/opt/venv/bin:/opt/blender:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics \
    SMARTINK_LIVE_DIR=/app/smartink-live \
    SMARTINK_RENDER_TIMEOUT=600 \
    SMARTINK_MAX_CONCURRENT_RENDERS=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils python3 python3-venv \
    libxrender1 libxi6 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 libgl1 libegl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --retry 3 \
       "https://download.blender.org/release/Blender5.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz \
    && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum --check - \
    && mkdir /opt/blender && tar -xJf /tmp/blender.tar.xz --strip-components=1 -C /opt/blender \
    && rm /tmp/blender.tar.xz \
    && python3 -m venv /opt/venv

WORKDIR /app
COPY server/requirements.txt /app/server/requirements.txt
COPY server/runpod/requirements.txt /app/server/runpod/requirements.txt
RUN pip install --no-cache-dir -r server/runpod/requirements.txt
COPY server/app.py /app/server/app.py
COPY server/runpod/handler.py /app/server/runpod/handler.py
COPY server/runpod/check_gpu.py /app/server/runpod/check_gpu.py
COPY smartink-live/sceneImporter.py smartink-live/body_full.blend smartink-live/body_full_female.blend /app/smartink-live/
COPY smartink-live/assets/skins.blend /app/smartink-live/assets/skins.blend
COPY server/runpod/textures/ /app/smartink-live/assets/
RUN blender --background --factory-startup --python-expr 'import bpy; print(bpy.app.version_string)'
CMD ["sh", "-c", "blender --background --factory-startup --python-exit-code 1 --python server/runpod/check_gpu.py && exec python -m server.runpod.handler"]
