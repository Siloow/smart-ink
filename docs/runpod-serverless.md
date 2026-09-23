# Smart Ink RunPod worker

This packages the existing Blender renderer as a RunPod queue worker. The local
HTTP renderer and browser continue to work as before. The Supabase job proxy and
browser polling integration are a separate follow-up; never put a RunPod API key
in a `VITE_` variable.

## Build and publish

`.github/workflows/render-image.yml` tests and builds on relevant pull requests.
On a relevant push to `beta`, `main`, or the initial `codex/runpod-worker` branch,
or a manual workflow dispatch, it also
publishes `ghcr.io/smartink-app/smart-ink-render:<full-commit-sha>` using GitHub's
built-in token. The worker branch builds the first image before merging.
It does not change any live RunPod endpoint automatically.

The workflow requires Actions and package-write permission in the organization.
For a private GHCR package, configure a RunPod registry credential with permission
to pull it. Do not change the package's visibility just to make deployment work.

Local equivalent (requires Docker):

```sh
docker build --platform linux/amd64 -f server/runpod/Dockerfile \
  -t ghcr.io/smartink-app/smart-ink-render:<commit-sha> .
```

The image pins Blender 5.2.1 with its official SHA-256 checksum and RunPod SDK
1.10.1. It contains both body meshes, the skin material library and the six baked
skin maps in `server/runpod/textures/`, copied from the existing local derived
assets. These maps are packaged outside `public/` to avoid increasing the website
download. The Docker context allowlist excludes environment files and unrelated
project data. Runtime startup requires a working OptiX GPU; it fails rather than
silently spending time rendering on CPU.

## First endpoint

After the image build succeeds, create a **queue-based GPU Serverless** endpoint
using the exact image SHA tag (or image digest) and the registry credential:

- One GPU per worker; select an available Blackwell GPU after checking live pricing.
- Minimum workers **0**, maximum workers **1**, idle timeout **5 seconds**.
- Container disk **20 GB**, no network volume (all render assets are in the image).
- Set endpoint execution timeout to **660 seconds**; Blender's own timeout is 600.
- Keep the SDK's default of one job per worker.

Zero minimum workers lets the endpoint scale to zero. Startup, active work and
idle timeout still incur usage charges; do not treat the earlier per-render cost
estimate as verified. Increase maximum workers only after testing memory and cost.

## Request and result

Generate a small valid smoke-test request:

```sh
python tools/runpod-smoke.py --write-input /tmp/smartink-job.json
```

Submit its JSON to the endpoint's returned `run` URL through the authenticated
RunPod connection. The shape is:

```json
{"input":{"contract":{"schemaVersion":1},"ink_base64":"<PNG base64>"}}
```

The abbreviated contract above is illustrative; use the generated file or the
full existing scene contract. The handler reuses the HTTP renderer's validation,
rejects malformed PNGs and unsafe texture paths, and isolates every job's files.
Ink input is limited to 6 MiB; final PNG output to 5 MiB; previews over 512 KiB
are omitted. Larger results will need private object storage, not larger JSON.

While running, read `/stream` for `progress`, `preview`, and `final` events. Sample
updates are throttled to once per second, with completed samples always emitted.
RunPod's completed `/status` response also contains the aggregated event list;
the final event contains a base64 PNG up to 512 KiB. Larger images are sent as
ordered `image_chunk` events, each containing separately base64-encoded bytes and
an `index` and `total`; the final event then contains `chunkCount` and `bytes`.
Decode each chunk separately and concatenate its bytes in index order. This keeps
each streamed message below RunPod's 1 MB limit. Queue status comes from RunPod. The worker
does not claim to know a job's position in the queue.

Cancel through RunPod's cancellation operation. The async handler cancels its
render task; the shared renderer terminates Blender's process group and removes
job files. Errors fail the job, rather than returning a successful error image.
Account-level cancellation delivery still needs verification on the live endpoint.

## Local verification

```sh
python -m venv /tmp/smartink-worker-env
/tmp/smartink-worker-env/bin/pip install -r server/runpod/requirements.txt
/tmp/smartink-worker-env/bin/python tools/runpod-worker.test.py
/tmp/smartink-worker-env/bin/python tools/render-server.test.py
# Uses installed Blender and current local assets. CPU is useful on a laptop:
SMARTINK_RENDER_DEVICE=CPU /tmp/smartink-worker-env/bin/python tools/runpod-smoke.py
```

The smoke test passes events through the installed RunPod SDK, validates a real
256×256 PNG, and writes `/tmp/smartink-smoke.png`. The SDK's basic `--test_input`
runner does not consume this async generator; use this script for local renders.

Before declaring deployment ready, submit a real cloud job, verify its preview
and final image, test cancellation, and confirm workers return to zero. A local
render or successful image build alone does not prove the GPU endpoint works.

## Connecting to Supabase next

The authenticated Edge Function should enforce active beta access, create an
owner-scoped job row before submission, and bind the resulting RunPod job ID to
that user. Status, stream and cancellation must verify that same ownership.
It should keep the RunPod credential in secrets, enforce per-user limits, and
persist final images in the private renders bucket before temporary RunPod
results expire. Then the browser can submit and poll through the Edge Function.
