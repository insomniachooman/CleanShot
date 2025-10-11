
# IPC API contracts

Invoke channels
- capture:request -> CaptureResult
- overlay:freezeFrame -> { dataUrl: string, width: number, height: number, scale: number }
- settings:get -> Settings
- settings:set -> Settings
- pin:create -> { id: string }
- system:hideDesktopIcons -> { hidden: boolean }
- system:setCleanWallpaper -> { applied: boolean }

Events
- capture:progress { kind, progress }
- upload:progress { providerId, progress }
- app:notify { message, kind }

Validation
- All incoming payloads validated with TypeScript types at compile time and runtime guards in main
    