\# Project: Spatial Glass UI (WebXR)



\## Goal

Create a futuristic spatial UI inspired by Apple Vision Pro.

The interface should feel like floating glass panels in space,

with subtle motion, depth, and spatial interaction.



\---



\## Tech Stack

\- Three.js

\- WebXR (immersive-vr)

\- JavaScript (no framework for now)



\---



\## Core Features



\### 1. Glass Panel UI

\- Floating panel in front of camera

\- Semi-transparent (opacity \~0.15)

\- Uses MeshPhysicalMaterial

\- Has soft lighting and subtle reflection



\---



\### 2. Parallax Motion (IMPORTANT)

\- Panel moves slightly based on camera/head movement

\- Smooth damping (lerp)

\- Motion should be subtle (not distracting)



\---



\### 3. Depth Layers

\- Main panel (content)

\- Background ambient layer (particles or glow)

\- Layers move at different speeds



\---



\### 4. Idle Animation

\- Panel has subtle “breathing” motion

\- Scale oscillates slightly over time



\---



\### 5. Interaction (basic)

\- Mouse or gaze hover

\- On hover:

&#x20; - panel becomes slightly more opaque

&#x20; - scale increases slightly



\---



\## Constraints

\- Minimal UI (no heavy dashboard)

\- Clean, futuristic, Apple-like aesthetic

\- Focus on spatial feeling, not complexity



\---



\## Output

\- A working Three.js scene

\- Runs in browser

\- Optional: WebXR support



\---



\## Style Reference

\- Apple Vision Pro UI

\- Glassmorphism

\- Minimal, soft motion





\---



\## Extension: Camera + Object Interaction Layer



\### 6. Camera Input System

\- Integrate live camera feed using getUserMedia

\- Display camera as background or texture

\- Architecture should allow future replacement with RTMP stream



\---



\### 7. Object Detection Layer

\- Integrate basic object detection (TensorFlow.js or MediaPipe)

\- Detect objects and return bounding box coordinates

\- Continuously update detection in real-time



\---



\### 8. Focus Logic

\- Define a "focus object" based on:

&#x20; - center of screen (gaze simulation)

&#x20; - OR mouse hover

\- Only one object is "active" at a time



\---



\### 9. Spatial Highlight System (IMPORTANT)

\- When object is focused:

&#x20; - render a soft, glowing outline

&#x20; - avoid hard bounding boxes

&#x20; - use smooth animation (pulse / fade)



\---



\### 10. Popup Interaction UI

\- Show a floating popup near the focused object

\- Popup should:

&#x20; - be slightly offset in space

&#x20; - use glass-style UI (consistent with existing UI system)

&#x20; - appear with fade + scale animation

\- Popup follows object position with damping



\---



\### 11. Interaction Behavior

\- Hover over popup options:

&#x20; - highlight option

&#x20; - allow selection

\- Interaction should feel:

&#x20; - soft

&#x20; - responsive

&#x20; - spatial



\---



\### Integration Notes

\- Camera + detection layer should integrate with existing spatial UI system

\- Highlight and popup must follow spatial motion rules:

&#x20; - parallax

&#x20; - depth layering

&#x20; - smooth damping

