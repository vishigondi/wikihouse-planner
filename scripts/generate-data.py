#!/usr/bin/env python3
"""
Parametric home generator — Den Outdoors retreat homes.

Architectural standards:
  IRC (International Residential Code) — room minimums, egress, ceiling heights
  NKBA (National Kitchen & Bath Association) — kitchen/bath clearances
  ADA (Americans with Disabilities Act) — turning radius, door widths, corridor widths
  IECC — window-to-wall ratio guidance
  Structural — max 16ft clear span without intermediate bearing wall

Japandi design principles (Japanese + Scandinavian fusion):
  Silver ratio (1:√2 ≈ 1:1.414) preferred room proportions
  Ma (negative space) — furniture ≤40% of floor area
  Oku (depth) hierarchy — public→semi-public→semi-private→private gradient
  Genkan/entry threshold — deliberate transition from outside
  Engawa — covered outdoor transition (deck as engawa)
  Wet wall clustering — back-to-back plumbing for efficiency
  Storage ≥10% of indoor area — everything hidden (oshiire principle)
  LDK heart — living/dining/kitchen = 25-35% of habitable area
  Nature connection — every habitable room gets exterior wall
  Cross-ventilation — habitable rooms on 2+ exterior faces preferred
  Hyggekrog — cozy reading nooks (flex rooms serve this purpose)

Design rules:
  - 4ft grid snapping (all dimensions multiples of 4ft)
  - Building envelope must be 100% tiled by rooms (no voids)
  - Walls auto-generated from cell edges (exterior at envelope boundary, interior between rooms)
  - Openings hosted in walls per room type rules
  - Floors auto-fill room boundaries
  - Roofs follow building perimeter + pitch style
  - Invalid states raise at definition time
"""
import json, math, os, sys
from dataclasses import dataclass, field
from typing import Optional

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
GRID = 4  # feet per grid unit

# ══════════════════════════════════════════════════════════════════════
# ARCHITECTURAL CONSTRAINTS
# ══════════════════════════════════════════════════════════════════════

MAX_CLEAR_SPAN_FT = 16   # max span without load-bearing wall (engineered lumber)
MAX_CLEAR_SPAN_G = MAX_CLEAR_SPAN_FT // GRID  # 4 grid units
NATURAL_LIGHT_PCT = 0.08  # IRC R303: glazing >= 8% of floor area
MAX_WWR = 0.30            # IECC: window-to-wall ratio cap ~30%

# Japandi spatial targets
SILVER_RATIO = 1.414      # 1:√2 — preferred Japanese architectural proportion
STORAGE_TARGET_PCT = 10   # ≥10% of indoor area (oshiire principle: everything hidden)
CIRCULATION_MAX_PCT = 15  # corridors ≤15% of indoor area
LDK_MIN_PCT = 25          # living/dining/kitchen ≥25% of habitable area
LDK_MAX_PCT = 40          # cap at 40% — leave room for private zones
MAX_ROOM_RATIO = 2.0      # silver ratio cap: no room wider than 1:2

# Room type color mapping for 3D visualization (hex)
ROOM_COLORS = {
    "bedroom":       "#6366f1",  # indigo
    "primary_bed":   "#818cf8",  # lighter indigo
    "loft_bed":      "#a5b4fc",  # pale indigo
    "bathroom_full": "#06b6d4",  # cyan
    "bathroom_half": "#22d3ee",  # light cyan
    "bathroom_ada":  "#67e8f9",  # pale cyan
    "kitchen":       "#f59e0b",  # amber
    "kitchen_open":  "#fbbf24",  # yellow
    "living":        "#22c55e",  # green
    "great_room":    "#4ade80",  # light green
    "dining":        "#a3e635",  # lime
    "utility":       "#94a3b8",  # slate
    "entry":         "#e879f9",  # fuchsia
    "mudroom":       "#c084fc",  # purple
    "office":        "#fb923c",  # orange
    "walk_in_closet":"#78716c",  # stone
    "pantry":        "#a8a29e",  # warm gray
    "corridor":      "#64748b",  # cool gray
    "deck":          "#a16207",  # dark amber/wood
    "garage":        "#57534e",  # warm dark gray
    "flex":          "#f472b6",  # pink
    "engawa":        "#92400e",  # deep wood
    "meditation":    "#7c3aed",  # violet
    "nook":          "#ec4899",  # hot pink
}

@dataclass(frozen=True)
class RoomConstraint:
    min_gw: int            # min grid units wide
    min_gd: int            # min grid units deep
    min_area_sqft: int     # code minimum area
    needs_exterior: bool   # must touch exterior wall (for egress, light, entry)
    needs_egress: bool     # IRC R310: bedroom egress window
    needs_door: bool       # needs a door to corridor/adjacent room
    ada_turning: bool      # 60" wheelchair turning radius (ADA 304.3)
    needs_natural_light: bool  # IRC R303: 8% glazing requirement
    furniture_note: str

ROOM_RULES = {
    # ── Bedrooms ──
    "bedroom":       RoomConstraint(2, 2, 64,  True, True, True, False, True,
                     "IRC R304: ≥70sf (64 grid-relaxed). Queen 60×80 + 24in clearance"),
    "primary_bed":   RoomConstraint(3, 3, 144, True, True, True, False, True,
                     "King 76×80 + 24in clearance + walk-in closet access"),
    "loft_bed":      RoomConstraint(2, 2, 64,  False, False, False, False, False,
                     "Loft sleeping area. Code-compliant stair (IRC R311.7)"),

    # ── Bathrooms ──
    "bathroom_full": RoomConstraint(2, 2, 64,  False, False, True, True, False,
                     "NKBA: tub/shower + toilet + vanity. 30in clearance"),
    "bathroom_half": RoomConstraint(1, 1, 16,  False, False, True, False, False,
                     "Powder room: toilet + pedestal sink"),
    "bathroom_ada":  RoomConstraint(2, 2, 64,  False, False, True, True, False,
                     "ADA: roll-in shower + 60in turning + grab bars"),

    # ── Kitchen ──
    "kitchen":       RoomConstraint(2, 2, 64,  False, False, False, False, True,
                     "NKBA: work triangle 13-26ft. 48in aisle"),
    "kitchen_open":  RoomConstraint(3, 3, 144, False, False, False, False, True,
                     "NKBA: island + work triangle + dining. 48in around island"),

    # ── Living ──
    "living":        RoomConstraint(3, 3, 144, True, False, False, False, True,
                     "Sofa + coffee table + 8ft TV viewing + 36in circulation"),
    "great_room":    RoomConstraint(4, 3, 192, True, False, False, False, True,
                     "Combined living/dining. Open plan LDK heart"),
    "dining":        RoomConstraint(2, 2, 80,  False, False, False, False, True,
                     "Table for 4-6 + 36in chair clearance all sides"),

    # ── Utility/service ──
    "utility":       RoomConstraint(1, 1, 16,  False, False, True, False, False,
                     "Washer + dryer side-by-side. 36in front clearance"),
    "entry":         RoomConstraint(1, 1, 16,  True, False, False, False, False,
                     "Genkan: exterior door + shoe storage. Deliberate threshold"),
    "mudroom":       RoomConstraint(1, 2, 32,  True, False, False, False, False,
                     "Bench + hooks + shoe storage. Genkan-inspired transition"),
    "office":        RoomConstraint(2, 2, 64,  False, False, True, False, True,
                     "Desk 60×30 + chair clearance + bookshelf"),

    # ── Storage (oshiire principle: everything hidden) ──
    "walk_in_closet": RoomConstraint(1, 1, 16, False, False, False, False, False,
                     "Walk-in: 24in rod depth + 36in clearance. Oshiire: hide everything"),
    "pantry":        RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "Walk-in pantry: shelving + 36in aisle"),

    # ── Corridors ──
    "corridor":      RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "IRC R311.6: ≥36in. 4ft grid = 48in = ADA preferred"),

    # ── Special ──
    "deck":          RoomConstraint(1, 1, 16,  True, False, False, False, False,
                     "Engawa/deck: covered outdoor transition. Nature connection"),
    "garage":        RoomConstraint(3, 5, 240, True, False, False, False, False,
                     "Single car: 12×20ft min"),
    "flex":          RoomConstraint(2, 2, 64,  False, False, True, False, True,
                     "Hyggekrog/meditation/guest. Multi-purpose nook"),

    # ── Japandi-specific room types ──
    "engawa":        RoomConstraint(1, 1, 16,  True, False, False, False, False,
                     "Covered veranda/transition. 4-5ft wide. Indoor-outdoor threshold"),
    "meditation":    RoomConstraint(1, 1, 16,  False, False, False, False, True,
                     "Contemplation space. Tatami floor, minimal, garden view"),
    "nook":          RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "Hyggekrog reading nook. Cozy alcove with soft lighting"),
}

# ── Opening rules per room type ──
OPENING_RULES = {
    "bedroom":       [("window", "exterior")],
    "primary_bed":   [("window", "exterior"), ("window", "exterior")],
    "loft_bed":      [],
    "living":        [("sliding", "back"), ("window", "side")],
    "great_room":    [("sliding", "back"), ("sliding", "back"), ("window", "side")],
    "kitchen":       [("window", "exterior")],
    "kitchen_open":  [("window", "exterior")],
    "dining":        [("window", "exterior")],
    "office":        [("window", "exterior")],
    "entry":         [("door", "exterior")],
    "mudroom":       [("door", "exterior")],
    "deck":          [],
    "engawa":        [],
    "garage":        [("door", "exterior")],
    "bathroom_full": [("window", "exterior")],
    "bathroom_half": [],
    "bathroom_ada":  [],
    "utility":       [],
    "corridor":      [],
    "flex":          [("window", "exterior")],
    "walk_in_closet": [],
    "pantry":        [],
    "meditation":    [("window", "exterior")],
    "nook":          [("window", "exterior")],
}


# ══════════════════════════════════════════════════════════════════════
# COMPONENTS — Japandi material palette (timber + dark steel + glass)
# ══════════════════════════════════════════════════════════════════════

COMPONENTS = [
    # WALLS — charred timber (shou sugi ban) exterior, light timber interior
    {"id": "wall-ext", "name": "Exterior Wall 4'", "category": "wall",
     "dimensions": {"width": 4, "height": 10, "depth": 0.5},
     "geometry": "box", "material": {"color": "#2c2420", "opacity": 1, "metalness": 0.1, "roughness": 0.95},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "shou-sugi-ban"}},
    {"id": "wall-int", "name": "Interior Wall 4'", "category": "wall",
     "dimensions": {"width": 4, "height": 9, "depth": 0.33},
     "geometry": "box", "material": {"color": "#d4c5a9", "opacity": 1, "metalness": 0.02, "roughness": 0.98},
     "properties": {"structural": False, "insulated": False, "exterior": False, "panelType": "hinoki-panel"}},

    # ROOF — standing seam dark zinc
    {"id": "roof-gable", "name": "Gable Roof 4'", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 14}, "geometry": "box", "pitchAngle": 25,
     "material": {"color": "#1a1a1a", "opacity": 1, "metalness": 0.6, "roughness": 0.4},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "zinc-standing-seam"}},
    {"id": "roof-steep", "name": "Steep Roof 4'", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 14}, "geometry": "box", "pitchAngle": 45,
     "material": {"color": "#1a1a1a", "opacity": 1, "metalness": 0.6, "roughness": 0.4},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "zinc-standing-seam"}},
    {"id": "roof-shed", "name": "Shed Roof 4'", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 14}, "geometry": "box", "pitchAngle": 12,
     "material": {"color": "#1a1a1a", "opacity": 1, "metalness": 0.6, "roughness": 0.4},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "zinc-standing-seam"}},
    {"id": "roof-flat", "name": "Flat Roof 4x4", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 4}, "geometry": "box", "pitchAngle": 0,
     "material": {"color": "#262626", "opacity": 1, "metalness": 0.5, "roughness": 0.5},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "green-roof-membrane"}},

    # FLOOR — engineered hinoki (light) + cedar deck
    {"id": "floor-std", "name": "Floor Cassette 4x4", "category": "floor",
     "dimensions": {"width": 4, "height": 0.67, "depth": 4}, "geometry": "box",
     "material": {"color": "#c4a882", "opacity": 1, "metalness": 0.02, "roughness": 0.92},
     "properties": {"structural": True, "insulated": True, "exterior": False, "panelType": "engineered-hinoki"}},
    {"id": "floor-deck", "name": "Deck Panel 4x4", "category": "floor",
     "dimensions": {"width": 4, "height": 0.5, "depth": 4}, "geometry": "box",
     "material": {"color": "#8b6914", "opacity": 1, "metalness": 0.02, "roughness": 0.95},
     "properties": {"structural": True, "insulated": False, "exterior": True, "panelType": "cedar-deck"}},

    # OPENINGS — black steel frames + clear/frosted glass
    {"id": "door-ext", "name": "Entry Door 4'", "category": "opening",
     "dimensions": {"width": 4, "height": 8, "depth": 0.5}, "geometry": "box",
     "material": {"color": "#3d2b1f", "opacity": 1, "metalness": 0.1, "roughness": 0.85},
     "properties": {"structural": False, "insulated": True, "exterior": True, "panelType": "solid-timber-door"}},
    {"id": "door-sliding", "name": "Sliding Glass Door 4'", "category": "opening",
     "dimensions": {"width": 4, "height": 8, "depth": 0.5}, "geometry": "box",
     "material": {"color": "#b8d4e3", "opacity": 0.35, "metalness": 0.4, "roughness": 0.1},
     "properties": {"structural": False, "insulated": False, "exterior": True, "panelType": "shoji-glass-sliding"}},
    {"id": "window-std", "name": "Window 4'", "category": "opening",
     "dimensions": {"width": 4, "height": 4, "depth": 0.5}, "geometry": "box",
     "material": {"color": "#b8d4e3", "opacity": 0.3, "metalness": 0.4, "roughness": 0.1},
     "properties": {"structural": False, "insulated": False, "exterior": True, "panelType": "triple-glaze-timber"}},
    {"id": "door-int", "name": "Interior Door", "category": "opening",
     "dimensions": {"width": 3, "height": 7, "depth": 0.33}, "geometry": "box",
     "material": {"color": "#c4a882", "opacity": 1, "metalness": 0.02, "roughness": 0.92},
     "properties": {"structural": False, "insulated": False, "exterior": False, "panelType": "shoji-panel"}},

    # STRUCTURAL — concrete pier foundation
    {"id": "foundation", "name": "Foundation Sill 4'", "category": "structural",
     "dimensions": {"width": 4, "height": 0.5, "depth": 0.67}, "geometry": "box",
     "material": {"color": "#555555", "opacity": 1, "metalness": 0.3, "roughness": 0.7},
     "properties": {"structural": True, "insulated": False, "exterior": True, "panelType": "concrete-pier"}},
]
COMP_MAP = {c["id"]: c for c in COMPONENTS}


# ══════════════════════════════════════════════════════════════════════
# PARAMETRIC HOME ENGINE
# ══════════════════════════════════════════════════════════════════════

@dataclass
class Room:
    type: str
    label: str
    gx: int
    gz: int
    gw: int
    gd: int

    @property
    def area_sqft(self):
        return self.gw * self.gd * GRID * GRID

    @property
    def cells(self):
        return {(self.gx + dx, self.gz + dz)
                for dx in range(self.gw) for dz in range(self.gd)}

    @property
    def width_ft(self):
        return self.gw * GRID

    @property
    def depth_ft(self):
        return self.gd * GRID


class Home:
    """Parametric home. Envelope must be 100% tiled. Invalid states raise immediately."""

    def __init__(self, id: str, model: str, grid_w: int, grid_d: int,
                 height: int, bed_bath: str, roof_style: str,
                 has_loft: bool = False, void: set = None):
        self.id = id
        self.model = model
        self.grid_w = grid_w
        self.grid_d = grid_d
        self.height = height
        self.bed_bath = bed_bath
        self.roof_style = roof_style
        self.has_loft = has_loft
        self.rooms: list[Room] = []
        self._occupied: set[tuple[int, int]] = set()

        all_cells = {(x, z) for x in range(grid_w) for z in range(grid_d)}
        self._void = set(void or [])
        self.envelope = all_cells - self._void

    def add_room(self, room_type: str, gx: int, gz: int, gw: int, gd: int,
                 label: Optional[str] = None) -> 'Home':
        if room_type not in ROOM_RULES:
            raise ValueError(f"Unknown room type '{room_type}'. Valid: {list(ROOM_RULES.keys())}")

        c = ROOM_RULES[room_type]
        label = label or room_type.replace("_", " ").title()

        if gw < c.min_gw:
            raise ValueError(f"{label}: width {gw*GRID}ft < min {c.min_gw*GRID}ft for {room_type}")
        if gd < c.min_gd:
            raise ValueError(f"{label}: depth {gd*GRID}ft < min {c.min_gd*GRID}ft for {room_type}")
        area = gw * gd * GRID * GRID
        if area < c.min_area_sqft:
            raise ValueError(f"{label}: area {area}sqft < min {c.min_area_sqft}sqft ({c.furniture_note})")

        if gx < 0 or gz < 0 or gx + gw > self.grid_w or gz + gd > self.grid_d:
            raise ValueError(f"{label}: ({gx},{gz})+({gw}x{gd}) exceeds grid ({self.grid_w}x{self.grid_d})")

        new_cells = {(gx + dx, gz + dz) for dx in range(gw) for dz in range(gd)}
        if new_cells & self._void:
            raise ValueError(f"{label}: room overlaps void cells {new_cells & self._void}")

        overlap = new_cells & self._occupied
        if overlap:
            raise ValueError(f"{label}: overlaps existing room at {overlap}")

        if c.needs_exterior:
            touches = any(
                neighbor not in self.envelope
                for (x, z) in new_cells
                for neighbor in [(x-1, z), (x+1, z), (x, z-1), (x, z+1)]
            )
            if not touches:
                raise ValueError(f"{label}: {room_type} requires exterior wall but is fully interior")

        if room_type not in ("corridor", "deck", "engawa", "garage"):
            if gw > MAX_CLEAR_SPAN_G and gd > MAX_CLEAR_SPAN_G:
                print(f"  WARN {self.id}/{label}: both dimensions ({gw*GRID}×{gd*GRID}ft) "
                      f"exceed {MAX_CLEAR_SPAN_FT}ft clear span")

        room = Room(room_type, label, gx, gz, gw, gd)
        self.rooms.append(room)
        self._occupied |= new_cells
        return self

    def validate(self):
        """Final validation — IRC + Japandi principles."""
        # ── 100% envelope coverage ──
        uncovered = self.envelope - self._occupied
        if uncovered:
            raise ValueError(
                f"{self.id}: {len(uncovered)} uncovered cells: "
                f"{sorted(uncovered)[:10]}{'...' if len(uncovered) > 10 else ''}")

        # ── Bed/bath count ──
        beds = sum(1 for r in self.rooms if r.type in ("bedroom", "primary_bed", "loft_bed"))
        full_baths = sum(1 for r in self.rooms if r.type in ("bathroom_full", "bathroom_ada"))
        half_baths = sum(1 for r in self.rooms if r.type == "bathroom_half")
        bath_str = f"{full_baths}" if half_baths == 0 else f"{full_baths}.{half_baths * 5}"
        if f"{beds}/{bath_str}" != self.bed_bath:
            print(f"  WARN {self.id}: declared {self.bed_bath} but rooms give {beds}/{bath_str}")

        # ── Natural light (IRC R303) ──
        for room in self.rooms:
            if not ROOM_RULES[room.type].needs_natural_light:
                continue
            ext_edges = 0
            for (x, z) in room.cells:
                for nx, nz in [(x-1, z), (x+1, z), (x, z-1), (x, z+1)]:
                    if (nx, nz) not in self.envelope:
                        ext_edges += 1
            if ext_edges == 0:
                print(f"  WARN {self.id}/{room.label}: needs natural light but no exterior edges")

        # ── Helper ──
        def _adjacent(r1, r2):
            for c1 in r1.cells:
                for c2 in r2.cells:
                    if abs(c1[0]-c2[0]) + abs(c1[1]-c2[1]) == 1:
                        return True
            return False

        # ── Wet wall clustering (Japandi: efficient, minimal plumbing runs) ──
        wet_rooms = [r for r in self.rooms if r.type in
                     ("bathroom_full", "bathroom_half", "bathroom_ada", "kitchen", "kitchen_open", "utility")]
        if len(wet_rooms) >= 2:
            wet_adj = sum(1 for i, r1 in enumerate(wet_rooms)
                          for r2 in wet_rooms[i+1:] if _adjacent(r1, r2))
            if wet_adj == 0:
                print(f"  WARN {self.id}: no wet rooms share walls — plumbing inefficient")

        # ── Oku gradient: entry NOT adjacent to bedrooms ──
        entries = [r for r in self.rooms if r.type in ("entry", "mudroom")]
        bedrooms = [r for r in self.rooms if r.type in ("bedroom", "primary_bed", "loft_bed")]
        for entry in entries:
            for bed in bedrooms:
                if bed.type == "loft_bed":
                    continue
                if _adjacent(entry, bed):
                    print(f"  WARN {self.id}: entry '{entry.label}' adjacent to bedroom "
                          f"'{bed.label}' — violates oku gradient")

        # ── Noise isolation: bedrooms NOT adjacent to kitchen/garage ──
        noisy = [r for r in self.rooms if r.type in ("kitchen", "kitchen_open", "garage")]
        for bed in bedrooms:
            if bed.type == "loft_bed":
                continue
            for n in noisy:
                if _adjacent(bed, n):
                    print(f"  WARN {self.id}: bedroom '{bed.label}' shares wall with "
                          f"'{n.label}' — noise concern")

        # ── Primary bed must adjoin bathroom ──
        for room in self.rooms:
            if room.type == "primary_bed":
                baths = [r for r in self.rooms if r.type in
                         ("bathroom_full", "bathroom_half", "bathroom_ada")]
                if not any(_adjacent(room, b) for b in baths):
                    print(f"  WARN {self.id}: primary bed not adjacent to bathroom")

        # ── Deck/engawa should adjoin living or great_room ──
        outdoor = [r for r in self.rooms if r.type in ("deck", "engawa")]
        living = [r for r in self.rooms if r.type in ("living", "great_room")]
        for d in outdoor:
            if living and not any(_adjacent(d, lv) for lv in living):
                print(f"  WARN {self.id}: '{d.label}' not adjacent to living area")

        # ── Room proportions: silver ratio cap at 1:2 ──
        exempt = ("corridor", "deck", "engawa", "walk_in_closet", "pantry", "entry", "mudroom", "nook")
        for room in self.rooms:
            if room.type in exempt:
                continue
            ratio = max(room.gw, room.gd) / max(min(room.gw, room.gd), 1)
            if ratio > MAX_ROOM_RATIO:
                print(f"  WARN {self.id}/{room.label}: ratio {room.gw}:{room.gd} = {ratio:.1f}:1 "
                      f"(target ≤{MAX_ROOM_RATIO}:1 silver ratio)")

        # ── Storage ≥10% (oshiire principle) ──
        indoor_cells = sum(len(r.cells) for r in self.rooms
                          if r.type not in ("deck", "engawa"))
        storage_cells = sum(len(r.cells) for r in self.rooms
                           if r.type in ("walk_in_closet", "pantry"))
        if indoor_cells > 0:
            pct = storage_cells * 100 / indoor_cells
            if pct < 5 and indoor_cells > 20:
                print(f"  WARN {self.id}: storage {pct:.0f}% — target ≥{STORAGE_TARGET_PCT}%")

        # ── Circulation ≤15% ──
        corr_cells = sum(len(r.cells) for r in self.rooms if r.type == "corridor")
        if indoor_cells > 0:
            corr_pct = corr_cells * 100 / indoor_cells
            if corr_pct > CIRCULATION_MAX_PCT:
                print(f"  WARN {self.id}: corridor {corr_pct:.0f}% — target ≤{CIRCULATION_MAX_PCT}%")

        # ── LDK heart ≥25% of habitable ──
        ldk_types = ("living", "great_room", "kitchen", "kitchen_open", "dining")
        ldk_cells = sum(len(r.cells) for r in self.rooms if r.type in ldk_types)
        if indoor_cells > 0:
            ldk_pct = ldk_cells * 100 / indoor_cells
            if ldk_pct < LDK_MIN_PCT and indoor_cells > 20:
                print(f"  WARN {self.id}: LDK {ldk_pct:.0f}% — target ≥{LDK_MIN_PCT}%")

        return self

    @property
    def sqft(self):
        return sum(r.area_sqft for r in self.rooms if r.type not in ("deck", "engawa"))

    @property
    def footprint(self):
        return {"width": self.grid_w * GRID, "depth": self.grid_d * GRID}

    # ────────────────────────────────────────────────────────────────
    # GENERATION
    # ────────────────────────────────────────────────────────────────

    def generate(self):
        w = self.grid_w * GRID
        d = self.grid_d * GRID
        wall_h = 10
        placements = []

        cell_room = {}
        for room in self.rooms:
            for cell in room.cells:
                cell_room[cell] = room

        # ── Foundation + Floor ──
        for cell in sorted(self._occupied):
            gx, gz = cell
            cx = (gx + 0.5) * GRID - w / 2
            cz = (gz + 0.5) * GRID - d / 2
            room = cell_room.get(cell)
            is_outdoor = room and room.type in ("deck", "engawa")

            placements.append(_p("foundation", cx, 0.25, cz))
            placements.append(_p(
                "floor-deck" if is_outdoor else "floor-std",
                cx, 0.5 + 0.33, cz, zone="floor"))

        # ── Walls ──
        ext_edges = []
        int_edges = []

        for cell in sorted(self._occupied):
            gx, gz = cell
            cx = (gx + 0.5) * GRID - w / 2
            cz = (gz + 0.5) * GRID - d / 2
            room = cell_room.get(cell)

            for direction, neighbor, pos, rot_y in [
                ("south", (gx, gz - 1), (cx, wall_h / 2 + 0.5, cz - GRID / 2), 0),
                ("north", (gx, gz + 1), (cx, wall_h / 2 + 0.5, cz + GRID / 2), 0),
                ("west",  (gx - 1, gz), (cx - GRID / 2, wall_h / 2 + 0.5, cz), 90),
                ("east",  (gx + 1, gz), (cx + GRID / 2, wall_h / 2 + 0.5, cz), 90),
            ]:
                if neighbor not in self.envelope:
                    p = _p("wall-ext", pos[0], pos[1], pos[2], ry=rot_y, zone="walls")
                    p["_edge_cell"] = cell
                    p["_edge_dir"] = direction
                    p["_room"] = room
                    ext_edges.append(p)
                    placements.append(p)
                elif neighbor in self._occupied:
                    neighbor_room = cell_room.get(neighbor)
                    if room and neighbor_room and room.label != neighbor_room.label:
                        if cell < neighbor:
                            p = _p("wall-int", pos[0], pos[1], pos[2], ry=rot_y, zone="interior")
                            p["_room"] = room
                            p["_neighbor_room"] = neighbor_room
                            int_edges.append(p)
                            placements.append(p)

        # ── Openings ──
        self._place_openings(placements, ext_edges, int_edges, cell_room, w, d, wall_h)

        # ── Roof ──
        self._place_roof(placements, w, d, wall_h)

        # ── Room metadata (with colors for visualization) ──
        room_layouts = []
        for room in self.rooms:
            room_layouts.append({
                "label": room.label,
                "type": room.type,
                "gx": room.gx, "gz": room.gz,
                "gw": room.gw, "gd": room.gd,
                "area": room.area_sqft,
                "color": ROOM_COLORS.get(room.type, "#94a3b8"),
                "constraints": ROOM_RULES[room.type].furniture_note,
            })

        # Clean internal keys
        for p in placements:
            for k in list(p.keys()):
                if k.startswith("_"):
                    del p[k]

        return placements, room_layouts

    def _place_openings(self, placements, ext_edges, int_edges, cell_room, w, d, wall_h):
        room_openings = {r.label: [] for r in self.rooms}

        room_ext_edges = {}
        for edge in ext_edges:
            room = edge.get("_room")
            if room:
                room_ext_edges.setdefault(room.label, []).append(edge)

        for room in self.rooms:
            rules = OPENING_RULES.get(room.type, [])
            available = list(room_ext_edges.get(room.label, []))
            if not available:
                continue

            for opening_type, face_pref in rules:
                if not available:
                    break

                edge = self._pick_edge(available, face_pref, room, w, d)
                if not edge:
                    continue

                available.remove(edge)
                pos = edge["position"]

                if opening_type == "door":
                    idx = placements.index(edge)
                    placements[idx] = _p("door-ext", pos["x"], 4.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="openings")
                    placements.append(_p("wall-ext", pos["x"], 9.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.2))

                elif opening_type == "sliding":
                    idx = placements.index(edge)
                    placements[idx] = _p("door-sliding", pos["x"], 4.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="openings")
                    placements.append(_p("wall-ext", pos["x"], 9.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.2))

                elif opening_type == "window":
                    idx = placements.index(edge)
                    placements[idx] = _p("wall-ext", pos["x"], 2, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.3)
                    placements.append(_p("window-std", pos["x"], 5.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="openings"))
                    placements.append(_p("wall-ext", pos["x"], 9, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.3))

                room_openings[room.label].append(opening_type)

        # Interior doors
        for edge in int_edges:
            room = edge.get("_room")
            neighbor = edge.get("_neighbor_room")
            if not room or not neighbor:
                continue
            r1_needs = ROOM_RULES[room.type].needs_door
            r2_needs = ROOM_RULES[neighbor.type].needs_door
            r1_has = "int_door" in room_openings.get(room.label, [])
            r2_has = "int_door" in room_openings.get(neighbor.label, [])
            if (r1_needs and not r1_has) or (r2_needs and not r2_has):
                pos = edge["position"]
                placements.append(_p("door-int", pos["x"], 3.5, pos["z"],
                                     ry=edge["rotation"]["y"], zone="openings"))
                room_openings.setdefault(room.label, []).append("int_door")
                room_openings.setdefault(neighbor.label, []).append("int_door")

    def _pick_edge(self, available, face_pref, room, w, d):
        def score(edge):
            direction = edge.get("_edge_dir", "")
            if face_pref == "exterior":
                return 1
            elif face_pref == "back":
                if direction == "north": return 10
                elif direction in ("east", "west"): return 5
                return 1
            elif face_pref == "side":
                if direction in ("east", "west"): return 10
                return 1
            return 1
        available.sort(key=score, reverse=True)
        return available[0] if available else None

    def _place_roof(self, placements, w, d, wall_h):
        roof_y = wall_h + 0.5
        col_spans = {}
        for (gx, gz) in sorted(self._occupied):
            if gx not in col_spans:
                col_spans[gx] = (gz, gz)
            else:
                col_spans[gx] = (min(col_spans[gx][0], gz), max(col_spans[gx][1], gz))

        if self.roof_style == "gable":
            self._roof_pitched(placements, col_spans, w, d, roof_y, 25, "roof-gable")
        elif self.roof_style == "steep-gable":
            self._roof_pitched(placements, col_spans, w, d, roof_y, 45, "roof-steep")
        elif self.roof_style == "a-frame":
            self._roof_pitched(placements, col_spans, w, d, 0.5, 60, "roof-steep")
        elif self.roof_style == "shed":
            for gx, (zmin, zmax) in col_spans.items():
                x = (gx + 0.5) * GRID - w / 2
                col_cz = ((zmin + zmax + 1) / 2) * GRID - d / 2
                placements.append(_p("roof-shed", x, roof_y + 2, col_cz, rx=-12, zone="roof"))
        elif self.roof_style == "flat":
            for (gx, gz) in sorted(self._occupied):
                fx = (gx + 0.5) * GRID - w / 2
                fz = (gz + 0.5) * GRID - d / 2
                placements.append(_p("roof-flat", fx, roof_y, fz, zone="roof"))

    def _roof_pitched(self, placements, col_spans, w, d, base_y, pitch_deg, comp_id):
        pitch = math.radians(pitch_deg)
        for gx, (zmin, zmax) in col_spans.items():
            x = (gx + 0.5) * GRID - w / 2
            col_d = (zmax - zmin + 1) * GRID
            col_cz = ((zmin + zmax + 1) / 2) * GRID - d / 2
            half_cd = col_d / 2
            rise = half_cd * math.tan(pitch)
            placements.append(_p(comp_id, x, base_y + rise / 2, col_cz - half_cd / 2,
                                 rx=-pitch_deg, zone="roof"))
            placements.append(_p(comp_id, x, base_y + rise / 2, col_cz + half_cd / 2,
                                 rx=pitch_deg, zone="roof"))

    def to_dict(self):
        placements, room_layouts = self.generate()
        return {
            "id": self.id,
            "model": self.model,
            "sqft": self.sqft,
            "footprint": self.footprint,
            "height": self.height,
            "bedBath": self.bed_bath,
            "roofStyle": self.roof_style,
            "hasLoft": self.has_loft,
            "placements": placements,
            "componentsUsed": sorted(set(p["componentId"] for p in placements)),
            "rooms": room_layouts,
        }


def _p(comp_id, x, y, z, rx=0, ry=0, rz=0, zone="", sx=1, sy=1, sz=1):
    p = {
        "componentId": comp_id,
        "position": {"x": round(x, 2), "y": round(y, 2), "z": round(z, 2)},
        "rotation": {"x": rx, "y": ry, "z": rz},
        "zone": zone,
    }
    if sx != 1 or sy != 1 or sz != 1:
        p["scale"] = {"x": sx, "y": sy, "z": sz}
    return p


# ══════════════════════════════════════════════════════════════════════
# HOME DEFINITIONS — Japandi retreat homes, 100% grid coverage
# ══════════════════════════════════════════════════════════════════════

def _void_rect(x0, z0, x1, z1):
    return {(x, z) for x in range(x0, x1+1) for z in range(z0, z1+1)}


def define_homes():
    homes = []

    # ── 1. Ascent ADU ── (32×16ft → 8×4 grid, ~400sf, shed roof)
    # Compact retreat. Genkan entry → open LDK → private bedroom.
    # Oku gradient: entry(east) → living(center) → bed(west)
    h = Home("ascent-adu", "Ascent ADU", 8, 4, 19, "1/1", "shed")
    h.add_room("entry", 7, 0, 1, 2, "Genkan")
    h.add_room("great_room", 2, 0, 5, 4, "Living/Kitchen")
    h.add_room("bedroom", 0, 0, 2, 2, "Bedroom")
    h.add_room("bathroom_full", 0, 2, 2, 2, "Bathroom")
    h.add_room("walk_in_closet", 7, 2, 1, 2, "Storage")
    homes.append(h.validate())

    # ── 2. Modern Alpine 2025 ── (40×16ft → 10×4 grid, steep roof)
    # Mountain retreat. Floor-to-ceiling gable glass → loft above.
    # Oku: entry(east) → kitchen(mid) → great room(west, views)
    h = Home("modern-alpine-2025", "Modern Alpine 2025", 10, 4, 21, "2/1", "steep-gable", has_loft=True)
    h.add_room("great_room", 0, 0, 4, 4, "Great Room")
    h.add_room("kitchen", 4, 0, 3, 2, "Kitchen")
    h.add_room("bedroom", 4, 2, 3, 2, "Bedroom")
    h.add_room("loft_bed", 7, 0, 2, 2, "Loft Suite")
    h.add_room("bathroom_full", 7, 2, 2, 2, "Bathroom")
    h.add_room("entry", 9, 0, 1, 2, "Genkan")
    h.add_room("walk_in_closet", 9, 2, 1, 2, "Storage")
    homes.append(h.validate())

    # ── 3. Outpost Plus ── (28×28ft → 7×7 grid, steep roof)
    # Square cabin with central hearth. Intimate proportions.
    # Oku: entry(SE) → kitchen(NE) → great room(W, views) → bed(E, private)
    h = Home("outpost-plus", "Outpost Plus", 7, 7, 25, "2/1", "steep-gable", has_loft=True)
    h.add_room("great_room", 0, 0, 4, 5, "Great Room")
    h.add_room("kitchen", 0, 5, 4, 2, "Kitchen")
    h.add_room("bedroom", 4, 0, 3, 3, "Ground Suite")
    h.add_room("loft_bed", 4, 3, 2, 2, "Loft Nook")
    h.add_room("walk_in_closet", 6, 3, 1, 2, "Closet")
    h.add_room("bathroom_full", 4, 5, 2, 2, "Bathroom")
    h.add_room("entry", 6, 5, 1, 2, "Genkan")
    homes.append(h.validate())

    # ── 4. Barnhouse 1.1 ── (36×28ft → 9×7 grid, gable)
    # Classic barn form. Open LDK + private suite.
    # Wet wall: bathroom backs kitchen. Storage closet for primary.
    h = Home("barnhouse-1-1", "Barnhouse 1.1", 9, 7, 20, "1/1", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen", 0, 4, 5, 3, "Kitchen")
    h.add_room("primary_bed", 5, 0, 3, 3, "Primary Suite")
    h.add_room("walk_in_closet", 8, 0, 1, 3, "Walk-in Closet")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Bathroom")
    h.add_room("office", 7, 3, 2, 2, "Office/Nook")
    h.add_room("utility", 5, 5, 2, 2, "Utility")
    h.add_room("entry", 7, 5, 2, 2, "Genkan")
    homes.append(h.validate())

    # ── 5. Barnhouse 2.1 ── (36×28ft → 9×7 grid, gable)
    # 2-bed with corridor spine as sound buffer.
    # Oku: entry(E)→corridor→kitchen/living(W)→bedrooms(E, beyond corridor)
    h = Home("barnhouse-2-1", "Barnhouse 2.1", 9, 7, 20, "2/1", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen", 0, 4, 5, 3, "Kitchen")
    h.add_room("corridor", 5, 0, 1, 7, "Gallery")
    h.add_room("primary_bed", 6, 0, 3, 3, "Primary Suite")
    h.add_room("bathroom_full", 6, 3, 2, 2, "Bathroom")
    h.add_room("utility", 8, 3, 1, 2, "Utility")
    h.add_room("bedroom", 6, 5, 2, 2, "Guest Suite")
    h.add_room("entry", 8, 5, 1, 2, "Genkan")
    homes.append(h.validate())

    # ── 6. Barnhouse Plus ── (48×24ft → 12×6 grid, gable)
    # Extended barn with engawa porch along east edge.
    # Dual suites separated by central hall. Engawa = indoor-outdoor transition.
    h = Home("barnhouse-plus", "Barnhouse Plus", 12, 6, 18, "2/2", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen", 0, 4, 5, 2, "Kitchen")
    h.add_room("primary_bed", 5, 0, 3, 3, "Primary Suite")
    h.add_room("bedroom", 8, 0, 3, 3, "Guest Suite")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Primary Bath")
    h.add_room("corridor", 7, 3, 1, 2, "Hall")
    h.add_room("bathroom_full", 8, 3, 2, 2, "Guest Bath")
    h.add_room("utility", 5, 5, 2, 1, "Utility")
    h.add_room("entry", 7, 5, 2, 1, "Genkan")
    h.add_room("walk_in_closet", 9, 5, 2, 1, "Storage")
    h.add_room("engawa", 11, 0, 1, 3, "Engawa")
    h.add_room("deck", 11, 3, 1, 3, "Porch")
    h.add_room("walk_in_closet", 10, 3, 1, 2, "Linen")
    homes.append(h.validate())

    # ── 7. Modern Treehouse ── (68×32ft → 17×8 grid, flat roof)
    # Elevated retreat. Cantilevered deck. Gallery circulation.
    # Oku: entry(center)→gallery→wings. Nature wraps around.
    h = Home("modern-treehouse", "Modern Treehouse", 17, 8, 20, "2/1", "flat")
    h.add_room("great_room", 0, 0, 5, 5, "Great Room")
    h.add_room("kitchen", 0, 5, 5, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Suite")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Bathroom")
    h.add_room("utility", 7, 3, 2, 2, "Utility")
    h.add_room("bedroom", 5, 5, 4, 3, "Guest Suite")
    h.add_room("corridor", 9, 0, 2, 4, "Gallery")
    h.add_room("entry", 9, 4, 2, 4, "Entry Hall")
    h.add_room("office", 11, 0, 2, 3, "Office")
    h.add_room("walk_in_closet", 11, 3, 2, 2, "Walk-in")
    h.add_room("pantry", 11, 5, 2, 3, "Pantry/Store")
    h.add_room("deck", 13, 0, 4, 8, "Cantilevered Deck")
    homes.append(h.validate())

    # ── 8. Barnhouse 2.2 ── (48×28ft → 12×7 grid, gable)
    # Larger barn with dual suites. Open kitchen/dining anchors the plan.
    h = Home("barnhouse-2-2", "Barnhouse 2.2", 12, 7, 20, "2/2", "gable")
    h.add_room("great_room", 0, 0, 6, 4, "Living/Dining")
    h.add_room("kitchen_open", 0, 4, 6, 3, "Kitchen")
    h.add_room("primary_bed", 6, 0, 3, 3, "Primary Suite")
    h.add_room("bedroom", 9, 0, 3, 3, "Guest Suite")
    h.add_room("bathroom_full", 6, 3, 2, 2, "Primary Bath")
    h.add_room("bathroom_full", 8, 3, 2, 2, "Guest Bath")
    h.add_room("office", 10, 3, 2, 2, "Office")
    h.add_room("entry", 6, 5, 2, 2, "Genkan")
    h.add_room("walk_in_closet", 8, 5, 2, 2, "Walk-in")
    h.add_room("utility", 10, 5, 2, 2, "Utility")
    homes.append(h.validate())

    # ── 9. Eastern Farmhouse ── (36×24ft → 9×6 grid, gable, 2-story)
    # Traditional farmhouse with wrap-around character.
    # Ground floor public, loft floor private. Mudroom as genkan.
    h = Home("eastern-farmhouse", "Eastern Farmhouse", 9, 6, 30, "3/2.5", "gable", has_loft=True)
    h.add_room("great_room", 0, 0, 5, 3, "Living")
    h.add_room("kitchen_open", 0, 3, 5, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Suite")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Primary Bath")
    h.add_room("bathroom_full", 7, 3, 2, 2, "Guest Bath")
    h.add_room("bathroom_half", 5, 5, 1, 1, "Powder Room")
    h.add_room("corridor", 6, 5, 2, 1, "Hall")
    h.add_room("entry", 8, 5, 1, 1, "Genkan")
    homes.append(h.validate())

    # ── 10. L Barnhouse ── (40×40ft → L-shape 10×10, gable)
    # L-shape creates sheltered courtyard. Void = future garden.
    # Oku: public wing(W) → private wing(E). L-bend = threshold.
    void = _void_rect(7, 0, 9, 4)
    h = Home("l-barnhouse", "L Barnhouse", 10, 10, 20, "2/1.5", "gable", void=void)
    h.add_room("great_room", 0, 0, 4, 5, "Living/Dining")
    h.add_room("kitchen_open", 0, 5, 4, 5, "Kitchen")
    h.add_room("bedroom", 4, 0, 3, 5, "Guest Suite")        # touches void = exterior
    h.add_room("primary_bed", 4, 5, 3, 5, "Primary Suite")   # z=5-9, north edge (z=9→10 OOB)
    h.add_room("bathroom_full", 7, 5, 3, 3, "Full Bath")      # east+north
    h.add_room("bathroom_half", 7, 8, 1, 2, "Half Bath")
    h.add_room("utility", 8, 8, 2, 2, "Utility")
    homes.append(h.validate())

    # ── 11. Barnhouse 3.3 ── (72×28ft → 18×7 grid, gable)
    # Long barn. Three suites + central gallery spine.
    # Engawa porch along south edge. Gallery = art display corridor.
    h = Home("barnhouse-3-3", "Barnhouse 3.3", 18, 7, 20, "3/3", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen_open", 0, 4, 5, 3, "Kitchen")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Suite")
    h.add_room("bedroom", 9, 0, 3, 3, "Suite 2")
    h.add_room("bedroom", 12, 0, 3, 3, "Suite 3")
    h.add_room("walk_in_closet", 15, 0, 1, 3, "Closet")
    h.add_room("entry", 16, 0, 2, 3, "Genkan")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Bath 1")
    h.add_room("bathroom_full", 9, 3, 2, 2, "Bath 2")
    h.add_room("bathroom_full", 12, 3, 2, 2, "Bath 3")
    h.add_room("corridor", 7, 3, 2, 2, "Gallery 1")
    h.add_room("corridor", 11, 3, 1, 2, "Gallery 2")
    h.add_room("utility", 14, 3, 4, 2, "Utility/Pantry")
    h.add_room("corridor", 5, 5, 13, 1, "Central Gallery")
    h.add_room("engawa", 5, 6, 13, 1, "Engawa")
    homes.append(h.validate())

    # ── 12. A-Frame House Plus ── (44×32ft → 11×8 grid, a-frame)
    # Dramatic A-frame. Floor-to-ceiling glass gable.
    # Oku: entry(SE)→social(W)→private(NE). Loft above.
    h = Home("a-frame-house-plus", "A-Frame House Plus", 11, 8, 27, "3/2.5", "a-frame", has_loft=True)
    h.add_room("great_room", 0, 0, 6, 5, "Great Room")
    h.add_room("kitchen_open", 0, 5, 6, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 6, 0, 3, 3, "Primary Suite")
    h.add_room("bathroom_full", 9, 0, 2, 2, "En-Suite Bath")
    h.add_room("walk_in_closet", 9, 2, 2, 1, "Walk-in")
    h.add_room("bedroom", 6, 3, 5, 2, "Guest Suite")
    h.add_room("loft_bed", 6, 5, 2, 2, "Loft Suite")
    h.add_room("bathroom_full", 8, 5, 3, 2, "Full Bath")
    h.add_room("bathroom_half", 6, 7, 2, 1, "Powder Room")
    h.add_room("entry", 8, 7, 3, 1, "Genkan")
    homes.append(h.validate())

    # ── 13. Outpost Medium ── (52×28ft → 13×7 grid, steep roof)
    # Mid-size retreat. Three suites with private baths.
    # Nature-wrapped: great room gets floor-to-ceiling gable glass.
    h = Home("outpost-medium", "Outpost Medium", 13, 7, 26, "3/3", "steep-gable", has_loft=True)
    h.add_room("great_room", 0, 0, 6, 4, "Great Room")
    h.add_room("kitchen_open", 0, 4, 6, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 6, 0, 4, 3, "Primary Suite")
    h.add_room("loft_bed", 6, 3, 4, 2, "Loft Suite")
    h.add_room("bedroom", 6, 5, 4, 2, "Guest Suite")
    h.add_room("bathroom_full", 10, 0, 2, 3, "Primary Bath")
    h.add_room("walk_in_closet", 12, 0, 1, 3, "Walk-in")
    h.add_room("bathroom_full", 10, 3, 3, 2, "Loft Bath")
    h.add_room("bathroom_full", 10, 5, 3, 2, "Guest Bath")
    homes.append(h.validate())

    # ── 14. Studio House ── (72×28ft → 18×7 grid, flat roof)
    # Artist's retreat. Gallery corridor connects wings.
    # Japandi: flat roof, large covered patio, contemplative garden views.
    h = Home("studio-house", "Studio House", 18, 7, 12, "3/2.5", "flat")
    h.add_room("great_room", 0, 0, 5, 4, "Living")
    h.add_room("kitchen_open", 0, 4, 5, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Suite")
    h.add_room("bedroom", 9, 0, 3, 3, "Suite 2")
    h.add_room("bedroom", 12, 0, 3, 3, "Suite 3")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Primary Bath")
    h.add_room("bathroom_full", 9, 3, 2, 2, "Guest Bath")
    h.add_room("bathroom_half", 7, 3, 2, 2, "Powder Room")
    h.add_room("walk_in_closet", 11, 3, 2, 2, "Walk-in")
    h.add_room("utility", 13, 3, 2, 2, "Utility")
    h.add_room("corridor", 5, 5, 6, 2, "Gallery")
    h.add_room("office", 11, 5, 2, 2, "Studio/Office")
    h.add_room("entry", 13, 5, 2, 2, "Genkan")
    h.add_room("deck", 15, 0, 3, 7, "Covered Patio")
    homes.append(h.validate())

    # ── 15. Barndo ── (96×36ft → 24×9 grid, gable)
    # Grand barn. Garage wing + living wing.
    # Engawa porch along south. Central gallery as art spine.
    h = Home("barndo", "Barndo", 24, 9, 22, "4/3.5", "gable", has_loft=True)
    h.add_room("great_room", 0, 0, 6, 5, "Great Room")
    h.add_room("kitchen_open", 0, 5, 6, 4, "Kitchen/Dining")
    h.add_room("primary_bed", 6, 0, 5, 3, "Primary Suite")
    h.add_room("bedroom", 11, 0, 4, 3, "Suite 2")
    h.add_room("bedroom", 15, 0, 4, 3, "Suite 3")
    h.add_room("loft_bed", 19, 0, 5, 2, "Loft Suite")
    h.add_room("walk_in_closet", 19, 2, 5, 1, "Storage")
    h.add_room("bathroom_full", 6, 3, 3, 2, "Primary Bath")
    h.add_room("bathroom_full", 11, 3, 2, 2, "Bath 2")
    h.add_room("bathroom_full", 15, 3, 2, 2, "Bath 3")
    h.add_room("bathroom_half", 9, 3, 2, 2, "Powder Room")
    h.add_room("utility", 13, 3, 2, 2, "Utility")
    h.add_room("corridor", 17, 3, 2, 2, "Passage")
    h.add_room("garage", 19, 3, 5, 5, "Garage")
    h.add_room("corridor", 6, 5, 13, 2, "Central Gallery")
    h.add_room("engawa", 6, 7, 13, 2, "Engawa")
    h.add_room("entry", 19, 8, 5, 1, "Genkan")
    homes.append(h.validate())

    return homes


# ══════════════════════════════════════════════════════════════════════
# OUTPUT
# ══════════════════════════════════════════════════════════════════════

os.makedirs(os.path.join(OUT, 'homes'), exist_ok=True)

homes = define_homes()
home_dicts = [h.to_dict() for h in homes]

for c in COMPONENTS:
    c["usedInHomes"] = [h["id"] for h in home_dicts if c["id"] in h["componentsUsed"]]

coverage = {}
for h in home_dicts:
    coverage[h["id"]] = {c["id"]: c["id"] in h["componentsUsed"] for c in COMPONENTS}

with open(os.path.join(OUT, 'components.json'), 'w') as f:
    json.dump(COMPONENTS, f, indent=2)
for h in home_dicts:
    with open(os.path.join(OUT, 'homes', f'{h["id"]}.json'), 'w') as f:
        json.dump(h, f, indent=2)
with open(os.path.join(OUT, 'coverage.json'), 'w') as f:
    json.dump(coverage, f, indent=2)
library = {"version": 5, "components": COMPONENTS, "homes": home_dicts, "coverage": coverage}
with open(os.path.join(OUT, 'library.json'), 'w') as f:
    json.dump(library, f, indent=2)

print(f"✓ {len(COMPONENTS)} components, {len(homes)} homes")
for h in homes:
    d = h.to_dict()
    indoor = sum(len(r.cells) for r in h.rooms if r.type not in ("deck", "engawa"))
    storage = sum(len(r.cells) for r in h.rooms if r.type in ("walk_in_closet", "pantry"))
    corr = sum(len(r.cells) for r in h.rooms if r.type == "corridor")
    ldk_types = ("living", "great_room", "kitchen", "kitchen_open", "dining")
    ldk = sum(len(r.cells) for r in h.rooms if r.type in ldk_types)
    s_pct = storage * 100 / indoor if indoor else 0
    c_pct = corr * 100 / indoor if indoor else 0
    l_pct = ldk * 100 / indoor if indoor else 0
    print(f"  {h.id}: {d['sqft']}sf | storage:{s_pct:.0f}% corr:{c_pct:.0f}% ldk:{l_pct:.0f}% | "
          f"{h.footprint['width']}×{h.footprint['depth']}ft | 100% sealed")
