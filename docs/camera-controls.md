# Desktop camera controls (0.9.1)

The desktop HUD exposes a persistent choice of Mouse & Keyboard Mode or Trackpad
Mode. This is a user preference, not a hardware guess: trackpads commonly deliver
mouse and wheel events, and event magnitudes do not reliably identify the device.
Touchscreen controls remain independent.

## Bindings

| Action | Mouse & Keyboard | Trackpad |
| --- | --- | --- |
| Orbit | Right-drag | Two-finger scroll; each axis controls its matching angle |
| Zoom | Wheel | Pinch |
| Pan | Camera movement controls | Option/Alt + two-finger scroll |
| Fly along the table | WASD | WASD |
| Rise / descend | Space / Left Shift | Space / Left Shift |
| Turn left / right | Q / E | Q / E |
| Quick shot with table focused | Enter | Enter |

Space is reserved for camera rise. Existing pull-and-release shooting remains.
Camera shortcuts yield to text fields, focused buttons and dialogs. Enter cannot
fire a shot from an account form or HUD button. Camera movement cancels a pending
shot pull; a new shooting press is required afterward.

## Research and design choices

- [Apple Multi-Touch gestures](https://support.apple.com/en-us/102482) documents
  two-finger scrolling, pinch zoom and configurable secondary clicking. Avoid
  requiring secondary-click drags on trackpads or commandeering three/four-finger
  OS gestures.
- [Blender peripheral controls](https://docs.blender.org/manual/en/4.4/getting_started/configuration/hardware.html)
  uses two-finger orbit and modified pan. Option/Alt for pan is this game's
  deliberate adaptation: the requested Minecraft-style Left Shift means descend.
- [W3C Pointer Events](https://www.w3.org/TR/pointerevents/latest/) describes the
  pointer abstraction; browsers do not generally expose each trackpad finger as
  a touch contact. An explicit preference avoids unreliable device detection.
- [Wheel events](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event)
  expose independent axes, delta units and control-modified zoom. The handler
  must normalize units and avoid processing a gesture twice with OrbitControls.
- [WebKit release notes](https://webkit.org/blog/11736/release-notes-for-safari-technology-preview-127/)
  document control-modified wheel events for pinch zoom. Native trackpad gesture
  delivery still needs real Mac testing; Linux Chromium simulations cannot
  establish macOS Safari feel or OS navigation interception.
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
  supplies upright orbit, pan and zoom with constrained camera travel. Translate
  the camera and orbit target together when changing height to preserve angle.
- [W3C pointer gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)
  supports providing ordinary clickable controls alongside gesture interactions.

Handle wheel gestures only over the canvas, suspend cue hover aiming during the
gesture and its momentum tail, and preserve browser shortcuts outside the game.
Clear held controls on blur, hidden tabs, dialogs, profile changes and Escape.
