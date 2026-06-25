# Twelve Labs Pegasus for Scrypted

This plugin adds a [Twelve Labs](https://twelvelabs.io) Pegasus video-understanding
device to Scrypted. Pegasus is a video-native model: given a video clip and a natural
language prompt, it returns a text description of what happens in the clip.

The plugin exposes a `ChatCompletion` device, so any Scrypted flow that can call a chat
completion (NVR event pipelines, notifier automations, scripts) can turn a camera event
clip into a natural-language description — for example "a delivery person left a package
on the porch" instead of a generic "motion detected".

## Setup

1. Install the plugin.
2. Get a free API key with a generous free tier at https://twelvelabs.io.
3. Open the plugin settings and paste the **API Key**.

That's it. Nothing runs until an API key is configured, and the plugin changes no Scrypted
defaults.

## Settings

* **API Key** — your Twelve Labs API key (stored as a password).
* **Pegasus Model** — the Pegasus model used for video understanding (defaults to `pegasus1.5`).
* **API Base URL** — override only if you are self-hosting a proxy.

## Usage

Send a chat completion to the device with a video reference in the message content. The
video can be:

* an `http(s)` URL to a video file, or
* a `data:video/...;base64,...` URL carrying the clip bytes (e.g. a Scrypted event clip).

The message text becomes the prompt. If no prompt is provided, the plugin defaults to
"Describe what happens in this video."

Pegasus analyzes video, not still images, so image-only requests are rejected with a clear
error.
