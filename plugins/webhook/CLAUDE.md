# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- `npm run build` - Build the plugin using scrypted-webpack
- `npm run scrypted-deploy` - Deploy to Scrypted server
- `npm run scrypted-deploy-debug <IP_ADDRESS>` - Deploy to specific Scrypted server with debugging
- `npm run scrypted-vscode-launch <IP_ADDRESS>` - VS Code remote debugging deployment

## Development and Deployment

### VS Code Remote Debugging
The plugin supports remote debugging to a Scrypted server:

1. **Deploy and debug**: Use F5 or VS Code launch configuration
2. **Configure target server**: Set debug host in VS Code settings if needed
3. **Manual deployment**: `npm run scrypted-vscode-launch <IP_ADDRESS>`

## Webhook Plugin Architecture

This is a Scrypted plugin that creates HTTP endpoints for device control and state retrieval.

### Core Components

**WebhookPlugin Class (main.ts)**
- Extends `ScryptedDeviceBase` 
- Implements `Settings`, `MixinProvider`, `HttpRequestHandler`, `PushHandler`
- Main HTTP request handler that processes webhook requests
- Validates device access and token authentication

**WebhookMixin Class**
- Extends `SettingsMixinDeviceBase` from common utilities
- Provides per-device webhook configuration interface
- Generates secure tokens for webhook access
- Creates webhook URLs for device interfaces

### Plugin Configuration

**Scrypted Interfaces**
- `MixinProvider` - Provides webhook functionality to other devices
- `HttpRequestHandler` - Handles HTTP webhook requests
- `PushHandler` - Handles push notifications via webhooks

**Dependencies**
- `@scrypted/sdk` - Core Scrypted development kit
- `@types/node` - Node.js type definitions
- Uses shared utilities from `../../../common/src/settings-mixin`
- References MQTT plugin's publishable types for device filtering

### Webhook Functionality

**URL Structure**
Webhooks follow the pattern: `/endpoint/<plugin-id>/<device-id>/<token>/<method-or-property>`

**Authentication**
- Each device gets a unique randomly generated token
- Tokens are stored in device mixin storage
- Invalid tokens return 401 Unauthorized

**Supported Operations**
1. **Method Invocation** - Execute device actions (e.g., `setBrightness`, `turnOn`)
   - Supports parameters via JSON array query parameter
   - Returns method results or media objects
2. **Property Access** - Read device state (e.g., `brightness`, `on`)
   - Returns current property values

**Media Object Handling**
- Special handling for camera methods (`takePicture`, `getVideoStream`)
- Automatically converts media objects to JPEG images
- Sets appropriate Content-Type headers

**Response Formats**
- JSON responses when `Accept: application/json` header is present
- Plain text/media responses by default
- Error responses with appropriate HTTP status codes

### Device Integration

**Mixin System**
- Webhook functionality is added to devices as a mixin
- Only devices that pass `isPublishable()` check can use webhooks
- Each device gets its own webhook configuration interface

**Interface Discovery**
- Automatically discovers available device interfaces
- Generates webhook endpoints for all interface methods and properties
- Provides console output with available webhook URLs and usage examples

## Development Notes

- Plugin type is "API" with webhook-specific interfaces
- Uses Scrypted's storage system for secure token management
- Extensive error handling with appropriate HTTP status codes
- Console logging for debugging webhook requests and device access