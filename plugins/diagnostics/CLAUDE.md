# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Guidelines

### Development Rules
- **No fallback logic** - Fail fast when requirements aren't met
- **No unnecessary features** - Only implement what's explicitly needed
- **Stick to the basics** - Simple, direct solutions over complex architectures
- **Keep it simple** - Prefer straightforward implementations
- **Show changes before implementing** - Get approval before making any changes
- **Wait for approval** - Never proceed without explicit user confirmation

### Memory Safety
- **IDE crashes frequently** - Save work often
- Use TodoWrite to track progress and save work frequently for crash protection
- Commit small, working changes frequently

### Version Control
- Ask before committing when starting new tasks
- Use descriptive commit messages
- **NEVER add attribution or Co-Authored-By lines to git commits**

## Scrypted Diagnostics Plugin

This is a Scrypted plugin that provides comprehensive diagnostics for the system and connected devices.

## Build Commands

- `npm run build` - Build the plugin using scrypted-webpack
- `npm install` - Install dependencies (requires server dependencies to be installed first)
- Install server dependencies: `cd ../../server && npm install`

## Development and Deployment

### VS Code Remote Debugging
The plugin supports remote debugging to a Scrypted server:

1. **Configure target server**: Set `scrypted.debugHost` in `.vscode/settings.json` to your Scrypted server IP
2. **Deploy and debug**: Use F5 or "Scrypted Debugger" launch configuration
3. **Deploy without debugging**: `npm run scrypted-deploy-debug <IP_ADDRESS>`

### Manual Deployment
- `npm run scrypted-vscode-launch <IP_ADDRESS>` - Deploy to specific Scrypted server
- Requires building first with `npm run build`

## Plugin Architecture

### Core Components

**DiagnosticsPlugin Class**
- Extends `ScryptedDeviceBase` and implements `Settings`
- Main entry point with two primary validation functions:
  - `validateDevice()` - Validates cameras, doorbells, and notifiers
  - `validateSystem()` - Validates system configuration, network, hardware

**Settings Configuration**
Uses `StorageSettings` with three main settings:
- Device selection for validation
- Device validation button
- System validation button

**Event Monitoring**
Tracks motion and button press events from devices to validate recent activity.

### Validation Framework

**validate() Method**
Generic validation wrapper that:
- Shows "Running" status with blue text
- Executes validation logic
- Shows "OK" (green) on success or "Failed" (red) with error message
- Handles both Promise and function-based validations

**warnStep() Method**
Shows warning messages in yellow text for non-critical issues.

### Device Validation

Validates cameras/doorbells by testing:
- Device capabilities (motion sensor, doorbell button)
- Recent motion detection (within 8 hours)
- Recent button presses for doorbells (within 8 hours)
- Snapshot functionality via `takePicture()`
- Video stream configurations and quality
- Audio codec compatibility
- Stream utilization across different destinations (local, remote, recorder, low-res)

### System Validation

Comprehensive system checks including:
- Installation environment validation (Docker, LXC, Desktop app)
- Network connectivity (IPv4/IPv6 via multiple test endpoints)
- **System Time Accuracy** - Validates system clock against external time APIs
- Server address configuration
- Hardware requirements (CPU count, memory)
- GPU passthrough for hardware acceleration
- AI/ML plugin functionality (ONNX, OpenVINO)
- NVR-specific hardware decode testing
- Deprecated plugin detection

### Network Testing

Uses `httpFetch` from server utilities for external API calls with configurable timeouts. Tests multiple endpoints for redundancy.

### Hardware Detection

Detects and validates:
- GPU devices (`/dev/dri/renderD128`, `/dev/dri/renderD129`)
- AMD GPU support (`/dev/kfd`)
- CUDA availability via environment variables
- FFmpeg hardware acceleration support

## Dependencies

- **@scrypted/sdk** - Core Scrypted interfaces and utilities
- **@scrypted/common** - Shared utilities (Deferred, media helpers)
- **sharp** - Image processing for snapshot validation
- Uses server-side httpFetch utility for network requests

## Development Notes

- Plugin type is "API" with "Settings" interface
- Validation results are displayed in the Scrypted console with color-coded output
- Event listeners track device activity for recent motion/button press validation
- Extensive use of async/await patterns for validation workflows