
# Architecture

Date: Saturday, October 11, 2025 UTC

Goals
- Pixel-precise selection and capture
- Multi-monitor and per-monitor DPI awareness v2
- CleanShot X style UX with post capture quick actions
- Modular native capture with Windows Graphics Capture and DXGI duplication fallback
- Robust packaging and updates with code signing readiness

Target platform and stack
- OS: Windows 10 1903 and Windows 11 with per-monitor DPI awareness v2
- Shell: Electron main for orchestration, transparent overlay renderer for selection UI
- Language: TypeScript for main and renderer, C++ for native addon via N-API
- Native capture: Preferred Windows Graphics Capture, fallback DXGI Desktop Duplication
- Image processing: GPU backed when possible, CPU fallback
- Packaging: electron-builder with NSIS
- Crash reporting: pluggable, integrate later
- State: electron-store for lightweight persisted settings
- IPC: Typed channels with validation and strict input contracts

High level components
- Main process
  - WindowManager: overlay windows per display, annotation editor window, pin windows, preferences
  - CaptureOrchestrator: high level capture requests routing to native addon or Electron desktopCapturer for development fallback
  - HotkeysManager: register and manage global shortcuts
  - TrayManager: tray icon and menu commands
  - SettingsManager: load and persist settings and secrets
  - Updater and crash reporter stubs
- Renderer processes
  - Overlay UI: selection mask, crosshair, magnifier, HUD quick actions
  - Annotation editor (separate window, deferred milestone)
  - Preferences UI
  - Pin window UI
- Native module
  - WGC path using C++ and Direct3D 11
  - DXGI duplication fallback
  - Cursor capture path and composition into frame
  - Optional SIMD seam detection utility for scrolling capture
  - Desktop icons hide and clean wallpaper manipulation
- Services
  - Upload provider SDK and sample providers
  - Image pipeline for drop shadow, padding, background compositing
  - Scrolling controller for automated scroll and stitching
- Storage
  - Temp cache for freeze frames and stitching segments
  - Optional local library metadata

DPI and coordinate transforms
- Centralized utility converts logical coordinates to device pixels per display
- All capture region math performed in device pixels
- Cursor hotspot and scale applied after transform
- Overlay uses screen bounds from Electron screen module with per display scale factor

Reliability and fallbacks
- Feature detection for WGC availability
- DXGI duplication fallback for unsupported devices
- Electron desktopCapturer for development mode
- Graceful errors for blocked protected content and full screen exclusive apps
- RDP and HDR awareness with best effort color management

Security and privacy
- No telemetry by default
- Opt in telemetry toggle with clearly documented data points
- Sandboxed renderer with context isolation
- No elevation needed
- Code signing supported in packaging pipeline

Packaging and updates
- electron-builder NSIS target for Windows
- Differential updates configured via generic provider URL
- Auto update integration planned at milestone M5

Milestones
- M0: Architecture, UI specs, native module spike
- M1: Region, window, display capture with overlay and quick actions Copy and Save
- M2: Annotation editor, Pin to Screen, preferences, hotkeys
- M3: Scrolling capture with web first and manual fallback
- M4: Hide desktop icons, clean wallpaper, upload SDK and at least one provider
- M5: Packaging polish, code signing, telemetry opt in, beta hardening

Process model
- Main creates overlay windows lazily per command
- Overlay handles selection and sends finalized region to main via typed IPC
- Main requests native capture for requested target and returns a buffer or file path
- Post capture HUD triggers quick actions via IPC to main
    