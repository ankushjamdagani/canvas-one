# React Flow editor

The root exports a neutral EditorAdapter implementation backed by explicit host
bridges for camera, coordinates, selection, projection, geometry and overlays.
Missing bridges report unsupported capabilities. The host supplies renderers and
semantic operations; intents never contain React Flow types.

The `/react` entry supplies transitional engine-specific presentation bindings
used by the current CanvasView, including guarded selection filtering. These
bindings deliberately expose React Flow UI types; they are not headless contracts.
CanvasView now consumes this package and uses its neutral coordinate bridge.
Semantic projection belongs to system-design and exposes neutral geometry/data.
Its optional UI accepts host rendering slots. The full app can select a different
canvas host through composition; replacement still requires suitable gesture
bindings and renderers. Engine-specific types stay in this package's UI entry.
