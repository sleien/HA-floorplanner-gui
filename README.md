<img src="favicon.svg" width="72" align="left" alt="" hspace="6" />

# HA Floorplanner GUI

**Draw a 2D floor plan in your browser and export a ready-to-use [ha-floorplan](https://github.com/ExperienceLovelace/ha-floorplan) SVG + CSS + dashboard YAML for Home Assistant.**

### ▶️ Use it now: **https://sleien.github.io/HA-floorplanner-gui/**

No install, no account, nothing to download — it runs entirely in your browser and your
work autosaves locally.

Draw walls, rooms, doors and windows, then drop in Home Assistant controls: rooms become
clickable **lights**, plus **temperature readouts**, **spinning fans** and **clickable
device icons** (import any Material Design Icon, or upload your own). Type in your HA entity
ids and hit **Export** to get three files:

- **`<name>.svg`** — the drawing, organised into Inkscape layers with the ids ha-floorplan needs
- **`<name>.css`** — the styling (lights grey↔yellow, device icons recolour by state, fan spin)
- **`dashboard.yaml`** — a paste-ready Lovelace view

Use **Preview** to click rooms/devices and see exactly how it'll behave in HA before you deploy.

> Tip: for anything you draw, hit **Save** to keep a `.json` project you can re-open later.

## Run it locally (optional)

It's a static site — no build step, no dependencies.

```bash
git clone https://github.com/sleien/HA-floorplanner-gui.git
cd HA-floorplanner-gui
python3 -m http.server 8123   # then open http://localhost:8123
```

(Opening `index.html` directly works too, but importing a PDF or Material icon needs the
served version because of browser security around workers/CDN fetches.)

## Drawing

| Tool | Key | What it does |
|------|-----|--------------|
| **Select** | `V` | Click to select, drag to move, drag the square handles to reshape. `Del` removes. |
| **Wall** | `W` | Click to drop points. Click the first point / `Enter` / double-click to finish. `Esc` cancels. |
| **Room** | `R` | Outline a room. It becomes a lighting **area** (`area.<name>`). |
| **Door** | `D` | Click on a wall — it snaps to the wall and its angle. Set hinge/swing in the Inspector. |
| **Window** | `N` | Click on a wall to drop a window. |
| **Temp** | `T` | Place a temperature readout (`sensor.<name>`). |
| **Fan** | `F` | Place a spinning fan (`switch.<name>`). |
| **Device** | `I` | Click, then upload an icon (PC, TV…). It becomes a clickable device bound to an HA entity. |
| **Erase** | – | Click an element to delete it. |

Temperature readouts, fans and device icons **snap to the grid** when you drag them. The
grid/snap/dimension toggles are **remembered across reloads**.

### Device icons

Add a clickable device two ways (pick the **Device** tool, click a spot):

- **Material Design Icon** (recommended) — type an icon name (`television`,
  `desktop-classic`, `power`…), the same set Home Assistant uses. The dialog and Inspector
  link straight to the [icon library](https://pictogrammers.com/library/mdi/). MDI icons
  are vectors, so they **recolour** by state: grey when off, your chosen colour (with a
  glow) when on. Importing needs internet once; the path is then embedded in your SVG, so
  the export stays self-contained.
- **Upload an image** (PNG/SVG) — shown as-is; greyed/dimmed when off, full when on.

In the Inspector you set:

- **Entity / button / script** — the HA id (`switch.pc`, `media_player.tv`,
  `button.wake_on_lan_pc`, `script.movie_night`). This becomes the SVG id.
- **On tap** — *More-info*, *Toggle on/off* (`homeassistant.toggle`), *Press button*
  (`button.press`), *Run script* (`script.turn_on`) or a **custom service** you type.
- **Grey out when off / colour when on** — dims + greys the icon when the entity is off and
  shows it full (with a soft glow) when on. Turn this off for stateless buttons.

Use **Preview** to click the icon and watch it dim/brighten just like in HA.

Doors and windows are **drag-to-create**: pick the tool and drag along a wall to draw one
at that length (or just click for a default one). Once placed, select it to drag the end
handles to resize, or use the ⇄ / ⇅ handles to flip a door.

**Preview** (top bar) simulates the Home Assistant interactions without leaving the tool:
click a room to toggle its light (the coloured overlay fades out, exactly as it will in HA),
and click a fan to make it spin. Click **Exit preview** (or pick any tool) to keep editing.

Extras: mouse-wheel to zoom, hold **Space** (or middle-mouse) to pan, **Fit** to frame
everything, `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` redo, and toggles for the grid,
snapping and dimension lines. The **Text** box sets the base font size (px) for room labels
and dimensions (and the default for new temperature readouts); it's saved with the
floorplan and used in the export. Everything is drawn to scale — the grid is 1 m and
lengths are shown in metres.

## Tracing an existing plan (background image + scale)

If you already have a floor-plan image or PDF (a photo, a scan, an architect's drawing):

1. **Image / PDF** (top bar) — upload it. PDFs are rasterised (first page) and dropped in
   as a semi-transparent guide *behind* your drawing. It is only a tracing aid and is
   **never** part of the exported SVG.
2. Move it, set its **opacity**, and once positioned, tick **Lock** so you can draw over it
   without nudging it.
3. **Set the scale.** Most plans have a *scale bar* — a little marker that says
   “this length = 1 m”. Pick the **Scale** tool (ruler), drag a line exactly over that
   marker (or over any wall whose real length you know), and type the real length. The whole
   drawing (and the image) rescales so your traced walls come out at true dimensions.

Then trace your walls/rooms on top and everything is correctly sized in metres.

## Wiring up Home Assistant

Fill in the **Home Assistant entities** panel on the right (or a selected element's
Inspector):

- **Room lights** → the `light.*` entity that controls each room.
- **Temperature sensors** → the `sensor.*` entity (its id also becomes the SVG element id,
  so the two stay matched, exactly like the ha-floorplan example).
- **Fans** → the `switch.*` entity — the fan spins while it is on.

Then click **Export**. At the top of the dialog is a **Name / path** field — this is the
base name used for the filenames, the `/local/floorplan/<name>/` folder and the dashboard
view `path:`. It defaults to a slug of your title; **give each floorplan a unique one** so
you can run several side by side (e.g. `ground_floor`, `upstairs`). You get three outputs
(named after that path):

| File | Purpose |
|------|---------|
| `<name>.svg` | The drawing, with `area.*`, `sensor.*`, `switch.*` ids ha-floorplan expects. |
| `<name>.css` | The stylesheet. The spin animation is **only included when a fan exists**. |
| `dashboard.yaml` | A paste-ready Lovelace **dashboard view** (`views:` → `custom:floorplan-card`) with the room-light toggles, temperature text and fan spin already wired in. |

### Install into Home Assistant

1. Install **ha-floorplan** (via HACS) so the `custom:floorplan-card` resource exists.
2. Copy the two assets into your `config/www` folder, keeping the paths the YAML uses:

   ```
   config/www/floorplan/<name>/<name>.svg
   config/www/floorplan/<name>/<name>.css
   ```

   (`/local/...` in the YAML maps to `config/www/...`.)
3. Add it to a dashboard. A Lovelace dashboard is a list of `views:`, and each view holds
   `cards:` — the exported `dashboard.yaml` gives you a complete view. Two ways to add it:

   - **Raw editor (what the export is made for):** open the dashboard → pencil *Edit* →
     top-right ⋮ → *Raw configuration editor*. If it's a new/empty dashboard, paste the
     whole block. If it already has `views:`, paste just the `- title:` item underneath.
   - **Single card via the UI:** in edit mode, *+ Add Card* → *Manual*, and paste only the
     card part (from `type: custom:floorplan-card` down, un-indented).

That's it — clicking a room toggles its light (the coloured overlay fades out when the
light is on), the temperature sensors show live values, and the fan spins when its switch
is on.

## How the export maps to ha-floorplan

- **Lighting** — each room is `<path id="area.<slug>">`. The `Rooms` rule adds a
  `light-on`/`light-off` class and the CSS colours the room: **grey when off, yellow when
  on**. The colours are the first thing in the exported CSS (`--fp-light-on` /
  `--fp-light-off`) so they're a one-line change. The per-room colours you pick in the
  editor are just for visualising the plan — CSS (with `!important`) drives the HA look.
- **Temperature** — each readout is `<text id="sensor.<slug>"><tspan>…</tspan></text>`.
  The `Temperature` rule writes the rounded value + `°` and adds the `static-temp` class.
  The text colour (`--fp-temp`, dark by default) is set in the CSS so it stays readable on
  the floor.
- **Fan** — the fan group is `<g id="switch.<slug>">`. Its rule toggles the `spinning`
  class, and the `@keyframes spin` animation lives in the CSS.

The room `tap_action` uses `homeassistant.toggle` (works for lights, switches — anything
toggleable), not `light.toggle`.

### SVG structure

The exported SVG is organised into **Inkscape layers** (not plain groups), so it opens
tidily in Inkscape. Each layer carries an `inkscape:highlight-color` so the Objects panel
colour-codes them by kind — 🟢 Home Assistant, ⚫ structural, 🟡 annotation:

| Layer | Contents | Highlight |
|-------|----------|-----------|
| **Areas** | the room `area.*` paths (lighting) | HA (green) |
| **Walls** | the wall paths (`g#layer-walls > path.wall`) | structural (slate) |
| **Doors & Windows** | each door/window in its own `<g class="door\|window">` | structural (slate) |
| **Devices** | fans and clickable device icons | HA (green) |
| **Sensors** | the `sensor.*` temperature text | HA (green) |
| **Labels** | room names | annotation (amber) |
| **Dimensions** | the overall dimension lines | annotation (amber) |

There's no full-canvas background rectangle and no leftover wrapper groups — the only
non-layer groups are the per-door/-window groups and each fan's `<g id="…">`, which has to
wrap its shapes so ha-floorplan can spin it. The background is transparent so it sits on
your dashboard. Colours live in `js/symbols.js` (`FP.STYLE.layer*`).

Walls sit **on top** of the room areas to cover their borders, but the CSS gives only the
HA entities (`.ha-entity`) `pointer-events`; walls, doors, labels and dimensions are
`pointer-events: none`, so a tap anywhere in a room — even on a wall or the room label —
falls through to the `area.*` beneath it and toggles the light. Sensors, fans and device
icons keep their own clicks.

## Project layout

```
index.html          # app shell
css/app.css         # editor UI styling
js/geometry.js      # vector math, snapping, path helpers
js/symbols.js       # SVG fragment builders (walls/doors/windows/sensors/fan/areas/dims)
js/state.js         # document model, undo/redo, localStorage
js/export.js        # shared renderer + SVG / CSS / YAML generators
js/editor.js        # interactive canvas: tools, hit-testing, pan/zoom
js/main.js          # toolbar, inspector, HA panel, export modal
vendor/pdfjs/       # Mozilla PDF.js (bundled, loaded lazily only for PDF uploads)
```
