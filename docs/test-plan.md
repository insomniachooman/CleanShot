
# Test plan

Unit
- Geometry transforms for selection and snapping
- IPC payload validation and defaulting
- Image pipeline composition combinations for drop shadow and background

Integration
- Overlay selection interactions including drag, resize, move, keyboard nudge
- Quick actions Copy and Save after capture
- Pin window creation from saved file and clipboard image
- Settings read and write through preload

End to end
- Multi monitor selection overlay on different DPI scales
- Freeze frame magnifier and color readout stability
- Full screen capture correctness on mixed DPI
- Window capture flow when implemented in native addon
- Scrolling capture stitching success rate on standard web content

Performance
- Overlay latency under 16 ms between pointer move and UI update
- Capture request to file written under 150 ms for standard regions
- Memory usage during freeze frame and selection does not exceed safe limits

Matrix
- DPI 100, 125, 150, 200
- Orientation mixed portrait and landscape
- HDR on and off
- High refresh rate 144 Hz or higher
- RDP sessions
    