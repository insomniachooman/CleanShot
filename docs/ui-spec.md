
# UI and UX specification

Style
- Minimal chrome, muted palette, glass like blur, light and dark aware
- Crisp typography with subtle shadows for contrast on varied backgrounds
- Beautiful selection rectangle with rounded corners and soft handles

Overlay selection
- Crosshair centered at cursor with hairlines across the screen
- Live dimension readout showing X Y W H in device pixels
- Magnifier near cursor with 8 to 16x zoom, pixel grid and HEX or RGB readout
- Resize handles on all corners and edges
- Hold Shift to lock aspect ratio
- Space to move selection while dragging
- Arrow keys to nudge by one pixel and Shift with arrows for ten pixels
- Snap to screen edges, window edges and pixel boundaries with eight pixel magnet threshold
- Freeze screen option that overlays a frozen frame to eliminate motion

HUD quick actions
- Compact toolbar near selection bottom right
- Actions: Copy, Save, Upload, Annotate, Pin, Open in
- Inline confirmation toasts like Copied to clipboard
- Keyboard shortcuts for each action with tooltips

Window capture
- Hover highlight windows with subtle glow
- On export options for drop shadow with configurable radius, offset and opacity
- Padding and background color including transparent background with PNG alpha

Full screen and display capture
- Multi monitor aware
- Correct per monitor DPI handling
- Ability to select current or specific display

Scrolling capture
- Mode selector for automatic window region and custom region
- Visual guide with step counter during capture
- Progress indicator with cancel option
- Manual fallback mode with guidance when automation fails

Preferences
- Sections: General, Capture, Shortcuts, Output, Uploads, Advanced
- All defaults sensible with discoverable tooltips

Pin to screen
- Floating image windows always on top
- Resizable with borderless chrome
- Opacity slider and click through toggle with keyboard shortcut
- Multiple pins supported

Tray menu
- New capture, window capture, screen capture, scrolling capture, last region, pin from clipboard, toggle hide icons, preferences, quit

Default shortcuts
- New Region Capture: Ctrl Shift 1
- Window Capture: Ctrl Shift 2
- Full Screen Current Display: Ctrl Shift 3
- Scrolling Capture: Ctrl Shift 4
- Toggle Pin Click Through: Ctrl Shift T
- Toggle Hide Desktop Icons: Ctrl Shift H
- Repeat Last Capture: Ctrl Shift R
- Escape: cancel selection
    