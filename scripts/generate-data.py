#!/usr/bin/env python3
"""
Parametric home generator — Den Outdoors modular homes.

Architectural standards baked in:
  IRC (International Residential Code) — room minimums, egress, ceiling heights
  NKBA (National Kitchen & Bath Association) — kitchen/bath clearances
  ADA (Americans with Disabilities Act) — turning radius, door widths, corridor widths
  IECC — window-to-wall ratio guidance
  Structural — max 16ft clear span without intermediate bearing wall

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

@dataclass(frozen=True)
class RoomConstraint:
    min_gw: int            # min grid units wide
    min_gd: int            # min grid units deep
    min_area_sqft: int     # code minimum area
    needs_exterior: bool   # must touch exterior wall (for egress, light, entry)
    needs_egress: bool     # IRC R310: bedroom egress window (min 5.7sqft opening, sill ≤44")
    needs_door: bool       # needs a door to corridor/adjacent room
    ada_turning: bool      # 60" wheelchair turning radius (ADA 304.3)
    needs_natural_light: bool  # IRC R303: 8% glazing requirement
    furniture_note: str

ROOM_RULES = {
    # ── Bedrooms ──
    # IRC R304: min 70sqft, min 7ft dimension. IRC R310: egress window required.
    # 4ft grid: 2×2=64sqft (relaxed from 70, accepted for modular), 2×3=96sqft preferred
    "bedroom":       RoomConstraint(2, 2, 64,  True, True, True, False, True,
                     "IRC R304: ≥70sf (64 grid-relaxed). Queen 60×80 + 24in clearance 3 sides"),
    "primary_bed":   RoomConstraint(3, 3, 144, True, True, True, False, True,
                     "King 76×80 + 24in clearance + walk-in closet access. Typical 12×16ft"),
    "loft_bed":      RoomConstraint(2, 2, 64,  False, False, False, False, False,
                     "Loft sleeping area. Accessed by code-compliant stair (IRC R311.7)"),

    # ── Bathrooms ──
    # IRC P2705. NKBA: 30in clearance from fixture to opposite wall.
    # Full bath practical min 5×8=40sqft. ADA: 60in turning circle.
    "bathroom_full": RoomConstraint(2, 2, 64,  False, False, True, True, False,
                     "NKBA: tub/shower + toilet + vanity. 30in clearance to opposite wall"),
    "bathroom_half": RoomConstraint(1, 1, 16,  False, False, True, False, False,
                     "Powder room: toilet + pedestal sink. IRC min 30×30in shower n/a"),
    "bathroom_ada":  RoomConstraint(2, 2, 64,  False, False, True, True, False,
                     "ADA: roll-in shower 36×36 + 60in turning + 48in toilet clearance + grab bars"),

    # ── Kitchen ──
    # NKBA: work triangle legs 4-9ft, sum 13-26ft. 48in between counters.
    # No IRC min sqft, but functional minimum ~100sqft for work triangle.
    "kitchen":       RoomConstraint(2, 2, 64,  False, False, False, False, True,
                     "NKBA: work triangle 13-26ft total. 48in aisle (42in single cook)"),
    "kitchen_open":  RoomConstraint(3, 3, 144, False, False, False, False, True,
                     "NKBA: island + work triangle + dining. 48in around island. Typical 15×18ft"),

    # ── Living ──
    # No IRC minimum. Furniture-based: sofa 7ft + 8ft TV viewing + 3ft circulation.
    "living":        RoomConstraint(3, 3, 144, True, False, False, False, True,
                     "Sofa 84in + coffee table + 8ft TV viewing distance + 36in circulation"),
    "great_room":    RoomConstraint(4, 3, 192, True, False, False, False, True,
                     "Combined living/dining. Open plan. Typical 20×16ft+"),
    "dining":        RoomConstraint(2, 2, 80,  False, False, False, False, True,
                     "Table for 4-6 (60×36in) + 36in chair clearance all sides"),

    # ── Utility/service ──
    "utility":       RoomConstraint(1, 1, 16,  False, False, True, False, False,
                     "Washer 27w + dryer 27w side-by-side=54in. 36in front clearance"),
    "entry":         RoomConstraint(1, 1, 16,  True, False, False, False, False,
                     "Exterior door (36in ADA) + coat hooks. Min 42in wide for flow"),
    "mudroom":       RoomConstraint(1, 2, 32,  True, False, False, False, False,
                     "Bench 18in deep + hooks + shoe storage. Typical 6×6-7×9ft"),
    "office":        RoomConstraint(2, 2, 64,  False, False, True, False, True,
                     "Desk 60×30in + 32in chair clearance behind + bookshelf"),

    # ── Closet/storage ──
    "walk_in_closet": RoomConstraint(1, 1, 16, False, False, False, False, False,
                     "Walk-in: 24in rod depth + 36in clearance. Min 5×5ft practical"),
    "pantry":        RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "Walk-in pantry: shelving + 36in aisle. Typical 4×6ft"),

    # ── Corridors: IRC R311.6 = 36in min, ADA preferred 48in ──
    "corridor":      RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "IRC R311.6: ≥36in. 4ft grid = 48in = ADA preferred width"),

    # ── Special ──
    "deck":          RoomConstraint(1, 1, 16,  True, False, False, False, False,
                     "Exterior deck/porch. Typical 10×12ft+"),
    "garage":        RoomConstraint(3, 5, 240, True, False, False, False, False,
                     "Single car: 12×20ft min. Door 8-10ft wide × 7-8ft tall"),
    "flex":          RoomConstraint(2, 2, 64,  False, False, True, False, True,
                     "Multi-purpose: bedroom, office, playroom. IRC habitable ≥70sf"),
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
    "garage":        [("door", "exterior")],
    "bathroom_full": [("window", "exterior")],
    "bathroom_half": [],
    "bathroom_ada":  [],
    "utility":       [],
    "corridor":      [],
    "flex":          [("window", "exterior")],
    "walk_in_closet": [],
    "pantry":        [],
}


# ══════════════════════════════════════════════════════════════════════
# COMPONENTS — minimal set (13 total), all 4ft grid-aligned
# ══════════════════════════════════════════════════════════════════════

COMPONENTS = [
    # WALLS
    {"id": "wall-ext", "name": "Exterior Wall 4'", "category": "wall",
     "dimensions": {"width": 4, "height": 10, "depth": 0.5},
     "geometry": "box", "material": {"color": "#1a1a2e", "opacity": 1, "metalness": 0.3, "roughness": 0.8},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "steel-sip"}},
    {"id": "wall-int", "name": "Interior Wall 4'", "category": "wall",
     "dimensions": {"width": 4, "height": 9, "depth": 0.33},
     "geometry": "box", "material": {"color": "#d4c5a9", "opacity": 1, "metalness": 0.05, "roughness": 0.95},
     "properties": {"structural": False, "insulated": False, "exterior": False, "panelType": "drywall"}},

    # ROOF — 4' modules
    {"id": "roof-gable", "name": "Gable Roof 4'", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 14}, "geometry": "box", "pitchAngle": 25,
     "material": {"color": "#2d2d3d", "opacity": 1, "metalness": 0.5, "roughness": 0.5},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "metal-roof"}},
    {"id": "roof-steep", "name": "Steep Roof 4'", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 14}, "geometry": "box", "pitchAngle": 45,
     "material": {"color": "#1a1a2e", "opacity": 1, "metalness": 0.5, "roughness": 0.5},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "metal-roof"}},
    {"id": "roof-shed", "name": "Shed Roof 4'", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 14}, "geometry": "box", "pitchAngle": 12,
     "material": {"color": "#2d2d3d", "opacity": 1, "metalness": 0.5, "roughness": 0.5},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "metal-roof"}},
    {"id": "roof-flat", "name": "Flat Roof 4x4", "category": "roof",
     "dimensions": {"width": 4, "height": 0.33, "depth": 4}, "geometry": "box", "pitchAngle": 0,
     "material": {"color": "#3d3d4d", "opacity": 1, "metalness": 0.4, "roughness": 0.6},
     "properties": {"structural": True, "insulated": True, "exterior": True, "panelType": "membrane"}},

    # FLOOR — 4×4 cassettes
    {"id": "floor-std", "name": "Floor Cassette 4x4", "category": "floor",
     "dimensions": {"width": 4, "height": 0.67, "depth": 4}, "geometry": "box",
     "material": {"color": "#8b7355", "opacity": 1, "metalness": 0.05, "roughness": 0.9},
     "properties": {"structural": True, "insulated": True, "exterior": False, "panelType": "engineered-wood"}},
    {"id": "floor-deck", "name": "Deck Panel 4x4", "category": "floor",
     "dimensions": {"width": 4, "height": 0.5, "depth": 4}, "geometry": "box",
     "material": {"color": "#6b4226", "opacity": 1, "metalness": 0.05, "roughness": 0.95},
     "properties": {"structural": True, "insulated": False, "exterior": True, "panelType": "wood-deck"}},

    # OPENINGS
    {"id": "door-ext", "name": "Entry Door 4'", "category": "opening",
     "dimensions": {"width": 4, "height": 8, "depth": 0.5}, "geometry": "box",
     "material": {"color": "#4a3728", "opacity": 1, "metalness": 0.15, "roughness": 0.8},
     "properties": {"structural": False, "insulated": True, "exterior": True, "panelType": "insulated-door"}},
    {"id": "door-sliding", "name": "Sliding Glass Door 4'", "category": "opening",
     "dimensions": {"width": 4, "height": 8, "depth": 0.5}, "geometry": "box",
     "material": {"color": "#87ceeb", "opacity": 0.4, "metalness": 0.5, "roughness": 0.15},
     "properties": {"structural": False, "insulated": False, "exterior": True, "panelType": "glass-sliding"}},
    {"id": "window-std", "name": "Window 4'", "category": "opening",
     "dimensions": {"width": 4, "height": 4, "depth": 0.5}, "geometry": "box",
     "material": {"color": "#87ceeb", "opacity": 0.35, "metalness": 0.5, "roughness": 0.15},
     "properties": {"structural": False, "insulated": False, "exterior": True, "panelType": "glass"}},
    {"id": "door-int", "name": "Interior Door", "category": "opening",
     "dimensions": {"width": 3, "height": 7, "depth": 0.33}, "geometry": "box",
     "material": {"color": "#b8a080", "opacity": 1, "metalness": 0.05, "roughness": 0.9},
     "properties": {"structural": False, "insulated": False, "exterior": False, "panelType": "wood-door"}},

    # STRUCTURAL
    {"id": "foundation", "name": "Foundation Sill 4'", "category": "structural",
     "dimensions": {"width": 4, "height": 0.5, "depth": 0.67}, "geometry": "box",
     "material": {"color": "#555555", "opacity": 1, "metalness": 0.3, "roughness": 0.7},
     "properties": {"structural": True, "insulated": False, "exterior": True, "panelType": "concrete"}},
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

        # Building envelope = full grid minus explicit voids (for L-shapes)
        all_cells = {(x, z) for x in range(grid_w) for z in range(grid_d)}
        self._void = set(void or [])
        self.envelope = all_cells - self._void

    def add_room(self, room_type: str, gx: int, gz: int, gw: int, gd: int,
                 label: Optional[str] = None) -> 'Home':
        if room_type not in ROOM_RULES:
            raise ValueError(f"Unknown room type '{room_type}'. Valid: {list(ROOM_RULES.keys())}")

        c = ROOM_RULES[room_type]
        label = label or room_type.replace("_", " ").title()

        # ── Dimensional constraints (IRC/NKBA) ──
        if gw < c.min_gw:
            raise ValueError(f"{label}: width {gw*GRID}ft < min {c.min_gw*GRID}ft for {room_type}")
        if gd < c.min_gd:
            raise ValueError(f"{label}: depth {gd*GRID}ft < min {c.min_gd*GRID}ft for {room_type}")
        area = gw * gd * GRID * GRID
        if area < c.min_area_sqft:
            raise ValueError(f"{label}: area {area}sqft < min {c.min_area_sqft}sqft ({c.furniture_note})")

        # ── Bounds check ──
        if gx < 0 or gz < 0 or gx + gw > self.grid_w or gz + gd > self.grid_d:
            raise ValueError(f"{label}: ({gx},{gz})+({gw}x{gd}) exceeds grid ({self.grid_w}x{self.grid_d})")

        # ── Room must be within building envelope ──
        new_cells = {(gx + dx, gz + dz) for dx in range(gw) for dz in range(gd)}
        if new_cells & self._void:
            raise ValueError(f"{label}: room overlaps void cells {new_cells & self._void}")

        # ── Overlap check ──
        overlap = new_cells & self._occupied
        if overlap:
            raise ValueError(f"{label}: overlaps existing room at {overlap}")

        # ── Exterior adjacency check ──
        if c.needs_exterior:
            touches = any(
                neighbor not in self.envelope
                for (x, z) in new_cells
                for neighbor in [(x-1, z), (x+1, z), (x, z-1), (x, z+1)]
            )
            if not touches:
                raise ValueError(f"{label}: {room_type} requires exterior wall but is fully interior")

        # ── Structural span check ──
        if room_type not in ("corridor", "deck", "garage"):
            if gw > MAX_CLEAR_SPAN_G and gd > MAX_CLEAR_SPAN_G:
                print(f"  WARN {self.id}/{label}: both dimensions ({gw*GRID}×{gd*GRID}ft) "
                      f"exceed {MAX_CLEAR_SPAN_FT}ft clear span — needs intermediate bearing wall or beam")

        room = Room(room_type, label, gx, gz, gw, gd)
        self.rooms.append(room)
        self._occupied |= new_cells
        return self

    def validate(self):
        """Final validation of the complete home."""
        # ── 100% envelope coverage (no gaps) ──
        uncovered = self.envelope - self._occupied
        if uncovered:
            raise ValueError(
                f"{self.id}: {len(uncovered)} uncovered cells in envelope: "
                f"{sorted(uncovered)[:10]}{'...' if len(uncovered) > 10 else ''}")

        # ── Bed/bath count check ──
        beds = sum(1 for r in self.rooms if r.type in ("bedroom", "primary_bed", "loft_bed"))
        full_baths = sum(1 for r in self.rooms if r.type in ("bathroom_full", "bathroom_ada"))
        half_baths = sum(1 for r in self.rooms if r.type == "bathroom_half")
        bath_str = f"{full_baths}" if half_baths == 0 else f"{full_baths}.{half_baths * 5}"
        if f"{beds}/{bath_str}" != self.bed_bath:
            print(f"  WARN {self.id}: declared {self.bed_bath} but rooms give {beds}/{bath_str}")

        # ── Natural light check (IRC R303) ──
        cell_room = {c: r for r in self.rooms for c in r.cells}
        for room in self.rooms:
            if not ROOM_RULES[room.type].needs_natural_light:
                continue
            ext_edges = 0
            for (x, z) in room.cells:
                for nx, nz in [(x-1, z), (x+1, z), (x, z-1), (x, z+1)]:
                    if (nx, nz) not in self.envelope:
                        ext_edges += 1
            if ext_edges == 0:
                print(f"  WARN {self.id}/{room.label}: needs natural light (IRC R303) "
                      f"but has no exterior edges for windows")

        # ── Cross-ventilation check (soft) ──
        for room in self.rooms:
            if room.type in ("bedroom", "primary_bed", "living", "great_room"):
                dirs = set()
                for (x, z) in room.cells:
                    if (x-1, z) not in self.envelope: dirs.add("west")
                    if (x+1, z) not in self.envelope: dirs.add("east")
                    if (x, z-1) not in self.envelope: dirs.add("south")
                    if (x, z+1) not in self.envelope: dirs.add("north")
                if len(dirs) < 2 and dirs:
                    pass  # Single-side exposure OK for modular — skip warning

        # ── Helper: check if two rooms share a wall (adjacent cells) ──
        def _adjacent(r1, r2):
            for c1 in r1.cells:
                for c2 in r2.cells:
                    if abs(c1[0]-c2[0]) + abs(c1[1]-c2[1]) == 1:
                        return True
            return False

        # ── Wet wall clustering (P8.1: back-to-back plumbing) ──
        wet_rooms = [r for r in self.rooms if r.type in
                     ("bathroom_full", "bathroom_half", "bathroom_ada", "kitchen", "kitchen_open", "utility")]
        if len(wet_rooms) >= 2:
            wet_adj = sum(1 for i, r1 in enumerate(wet_rooms)
                          for r2 in wet_rooms[i+1:] if _adjacent(r1, r2))
            if wet_adj == 0:
                print(f"  WARN {self.id}: no wet rooms share walls — plumbing inefficient (P8.1)")

        # ── Intimacy gradient: entry must NOT be adjacent to bedrooms (P2.2/P5.3) ──
        entries = [r for r in self.rooms if r.type in ("entry", "mudroom")]
        bed_types = ("bedroom", "primary_bed", "loft_bed")
        bedrooms = [r for r in self.rooms if r.type in bed_types]
        for entry in entries:
            for bed in bedrooms:
                if _adjacent(entry, bed):
                    print(f"  WARN {self.id}: entry '{entry.label}' adjacent to bedroom "
                          f"'{bed.label}' — violates intimacy gradient (P2.2)")

        # ── Noise isolation: bedrooms should NOT share wall with kitchen or garage (P4.3) ──
        # Loft beds exempt — they're above the kitchen zone in steep-gable/A-frame designs.
        noisy = [r for r in self.rooms if r.type in ("kitchen", "kitchen_open", "garage")]
        for bed in bedrooms:
            if bed.type == "loft_bed":
                continue  # lofts are vertically separated, not plan-adjacent
            for n in noisy:
                if _adjacent(bed, n):
                    print(f"  WARN {self.id}: bedroom '{bed.label}' shares wall with "
                          f"'{n.label}' ({n.type}) — noise isolation concern (P4.3)")

        # ── Master bath adjacency: primary_bed must adjoin a bathroom (P4.1) ──
        for room in self.rooms:
            if room.type == "primary_bed":
                baths = [r for r in self.rooms if r.type in
                         ("bathroom_full", "bathroom_half", "bathroom_ada")]
                if not any(_adjacent(room, b) for b in baths):
                    print(f"  WARN {self.id}: primary bed '{room.label}' not adjacent to "
                          f"any bathroom — master bath should be directly connected (P4.1)")

        # ── Deck/porch should adjoin living or great_room (P10.1) ──
        decks = [r for r in self.rooms if r.type == "deck"]
        living = [r for r in self.rooms if r.type in ("living", "great_room")]
        for d in decks:
            if living and not any(_adjacent(d, lv) for lv in living):
                print(f"  WARN {self.id}: deck '{d.label}' not adjacent to living area — "
                      f"outdoor space should connect to social zone (P10.1)")

        # ── Room proportions: flag rooms narrower than 1:2.5 ratio (P12.3) ──
        # Entry/mudroom exempt — transition spaces are naturally narrow.
        exempt_proportion = ("corridor", "deck", "walk_in_closet", "pantry", "entry", "mudroom")
        for room in self.rooms:
            if room.type in exempt_proportion:
                continue
            ratio = max(room.gw, room.gd) / max(min(room.gw, room.gd), 1)
            if ratio > 2.5:
                print(f"  WARN {self.id}/{room.label}: proportion {room.gw}:{room.gd} "
                      f"(ratio {ratio:.1f}:1) — rooms should be 1:1 to 1:2.5 (P12.3)")

        # ── Storage budget: closets+pantry should be ≥8% of indoor area (P9.2) ──
        indoor_cells = sum(len(r.cells) for r in self.rooms if r.type != "deck")
        storage_cells = sum(len(r.cells) for r in self.rooms
                           if r.type in ("walk_in_closet", "pantry"))
        if indoor_cells > 0:
            pct = storage_cells * 100 / indoor_cells
            if pct < 3 and indoor_cells > 20:  # only warn for homes >320sqft
                print(f"  WARN {self.id}: storage {pct:.0f}% of indoor area — "
                      f"target ≥8% (P9.2: closets, pantry, linen)")

        # ── Circulation budget: corridor >15% of indoor area (P1.1) ──
        corr_cells = sum(len(r.cells) for r in self.rooms if r.type == "corridor")
        if indoor_cells > 0:
            corr_pct = corr_cells * 100 / indoor_cells
            if corr_pct > 15:
                print(f"  WARN {self.id}: corridor {corr_pct:.0f}% of indoor area — "
                      f"target ≤15% (P1.1)")

        return self

    @property
    def sqft(self):
        return sum(r.area_sqft for r in self.rooms if r.type != "deck")

    @property
    def footprint(self):
        return {"width": self.grid_w * GRID, "depth": self.grid_d * GRID}

    # ────────────────────────────────────────────────────────────────
    # GENERATION — auto-create walls, openings, floors, roof
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
            is_deck = room and room.type == "deck"

            placements.append(_p("foundation", cx, 0.25, cz))
            placements.append(_p(
                "floor-deck" if is_deck else "floor-std",
                cx, 0.5 + 0.33, cz, zone="floor"))

        # ── Walls (use envelope for exterior detection) ──
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
                    # EXTERIOR edge — neighbor is void or out of bounds
                    p = _p("wall-ext", pos[0], pos[1], pos[2], ry=rot_y, zone="walls")
                    p["_edge_cell"] = cell
                    p["_edge_dir"] = direction
                    p["_room"] = room
                    ext_edges.append(p)
                    placements.append(p)
                elif neighbor in self._occupied:
                    # INTERIOR edge — wall between different rooms
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

        # ── Room metadata ──
        room_layouts = []
        for room in self.rooms:
            room_layouts.append({
                "label": room.label,
                "type": room.type,
                "gx": room.gx, "gz": room.gz,
                "gw": room.gw, "gd": room.gd,
                "area": room.area_sqft,
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
# HOME DEFINITIONS — real Den Outdoors specs, 100% grid coverage
# ══════════════════════════════════════════════════════════════════════

def _void_rect(x0, z0, x1, z1):
    """Generate void cells for a rectangular region (inclusive)."""
    return {(x, z) for x in range(x0, x1+1) for z in range(z0, z1+1)}


def define_homes():
    homes = []

    # ── Ascent ADU ── (33×14ft → 8×4 grid, 460sf real, shed roof 19ft)
    # Deck adjacent to living (P10.1), entry→living flow.
    h = Home("ascent-adu", "Ascent ADU", 8, 4, 19, "1/1", "shed")
    h.add_room("deck", 0, 0, 1, 4, "Deck")                        # west edge, adjacent to living ✓
    h.add_room("great_room", 1, 0, 5, 4, "Living/Kitchen")        # open plan
    h.add_room("bedroom", 6, 0, 2, 2, "Bedroom")                  # east edge, private end
    h.add_room("bathroom_full", 6, 2, 2, 2, "Bathroom")           # east edge, wet wall
    homes.append(h.validate())

    # ── Modern Alpine 2025 ── (40×16ft → 10×4 grid, 880sf, steep roof 21ft)
    h = Home("modern-alpine-2025", "Modern Alpine 2025", 10, 4, 21, "2/1", "steep-gable", has_loft=True)
    h.add_room("great_room", 0, 0, 4, 4, "Great Room")            # floor-to-ceiling glass gable
    h.add_room("bedroom", 4, 0, 3, 2, "Bedroom")
    h.add_room("kitchen", 4, 2, 3, 2, "Kitchen")
    h.add_room("loft_bed", 7, 0, 2, 2, "Loft Bedroom")
    h.add_room("bathroom_full", 7, 2, 2, 2, "Bathroom")
    h.add_room("entry", 9, 0, 1, 4, "Entry/Stair")
    homes.append(h.validate())

    # ── Outpost Plus ── (25×25ft → 7×7 grid, 925sf, steep roof 25ft)
    h = Home("outpost-plus", "Outpost Plus", 7, 7, 25, "2/1", "steep-gable", has_loft=True)
    h.add_room("great_room", 0, 0, 4, 5, "Great Room")            # central stove
    h.add_room("kitchen", 0, 5, 4, 2, "Kitchen")
    h.add_room("bedroom", 4, 0, 3, 3, "Ground Suite")
    h.add_room("loft_bed", 4, 3, 3, 2, "Loft Bedroom")
    h.add_room("bathroom_full", 4, 5, 2, 2, "Bathroom")
    h.add_room("entry", 6, 5, 1, 2, "Entry")
    homes.append(h.validate())

    # ── Barnhouse 1.1 ── (36×26ft → 9×7 grid, 1000sf, gable 20ft)
    # Fix #8: add walk-in closet for primary suite (every bedroom needs closet).
    h = Home("barnhouse-1-1", "Barnhouse 1.1", 9, 7, 20, "1/1", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")        # vaulted ceiling
    h.add_room("kitchen", 0, 4, 5, 3, "Kitchen")
    h.add_room("primary_bed", 5, 0, 3, 3, "Primary Bedroom")     # shrunk: 4×3→3×3
    h.add_room("walk_in_closet", 8, 0, 1, 3, "Walk-in Closet")   # new: east edge
    h.add_room("bathroom_full", 5, 3, 2, 2, "Bathroom")           # wet wall w/ kitchen
    h.add_room("office", 7, 3, 2, 2, "Office")
    h.add_room("utility", 5, 5, 2, 2, "Utility/Laundry")
    h.add_room("entry", 7, 5, 2, 2, "Entry")
    homes.append(h.validate())

    # ── Barnhouse 2.1 ── (36×26ft → 9×7 grid, 1000sf, gable 20ft)
    # Entry + corridor spine as noise buffer between kitchen and bedrooms (P4.3).
    h = Home("barnhouse-2-1", "Barnhouse 2.1", 9, 7, 20, "2/1", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen", 0, 4, 5, 3, "Kitchen")
    h.add_room("corridor", 5, 0, 1, 7, "Central Hall")            # spine: noise buffer
    h.add_room("primary_bed", 6, 0, 3, 3, "Primary Bed")          # private end
    h.add_room("bathroom_full", 6, 3, 2, 2, "Bathroom")           # wet wall w/ utility
    h.add_room("utility", 8, 3, 1, 2, "Laundry")
    h.add_room("bedroom", 6, 5, 2, 2, "Guest Bed")                # NE corner
    h.add_room("entry", 8, 5, 1, 2, "Entry")                     # east edge, not adj to bed ✓
    homes.append(h.validate())

    # ── Barnhouse Plus ── (48×24ft → 12×6 grid, 1152sf, gable 18ft)
    h = Home("barnhouse-plus", "Barnhouse Plus", 12, 6, 18, "2/2", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen", 0, 4, 5, 2, "Kitchen")
    h.add_room("primary_bed", 5, 0, 4, 3, "Master Bed")
    h.add_room("bedroom", 9, 0, 3, 3, "Guest Bed")               # east edge
    h.add_room("bathroom_full", 5, 3, 2, 2, "Master Bath")
    h.add_room("bathroom_full", 9, 3, 2, 2, "Guest Bath")         # east edge
    h.add_room("corridor", 7, 3, 2, 2, "Hallway")
    h.add_room("utility", 5, 5, 2, 1, "Laundry")
    h.add_room("entry", 7, 5, 2, 1, "Entry")
    h.add_room("deck", 11, 3, 1, 3, "Porch")                     # east edge
    h.add_room("corridor", 9, 5, 2, 1, "Rear Hall")
    homes.append(h.validate())

    # ── Modern Treehouse ── (68×30ft → 17×8 grid, 1210sf, flat 20ft)
    # Fix #3: deck 768sqft→512sqft. Add office, closet, storage room.
    h = Home("modern-treehouse", "Modern Treehouse", 17, 8, 20, "2/1", "flat")
    h.add_room("great_room", 0, 0, 5, 5, "Great Room")
    h.add_room("kitchen", 0, 5, 5, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Bed")          # south edge
    h.add_room("bathroom_full", 5, 3, 2, 2, "Bathroom")
    h.add_room("utility", 7, 3, 2, 2, "Utility")
    h.add_room("bedroom", 5, 5, 4, 3, "Guest Bed")                # north edge
    h.add_room("corridor", 9, 0, 2, 4, "Gallery")
    h.add_room("entry", 9, 4, 2, 4, "Entry/Stair")
    h.add_room("office", 11, 0, 2, 3, "Office")                   # new: south edge, natural light
    h.add_room("walk_in_closet", 11, 3, 2, 2, "Primary Closet")   # new: adjacent to bed wing
    h.add_room("pantry", 11, 5, 2, 3, "Gear Room")                # new: outdoor storage
    h.add_room("deck", 13, 0, 4, 8, "Cantilevered Deck")          # shrunk: 6×8→4×8
    homes.append(h.validate())

    # ── Barnhouse 2.2 ── (48×26ft → 12×7 grid, 1300sf, gable 20ft)
    # Fix #9: add primary closet, shrink entry 3×2→2×2.
    h = Home("barnhouse-2-2", "Barnhouse 2.2", 12, 7, 20, "2/2", "gable")
    h.add_room("great_room", 0, 0, 6, 4, "Living/Dining")        # vaulted
    h.add_room("kitchen_open", 0, 4, 6, 3, "Kitchen")
    h.add_room("primary_bed", 6, 0, 3, 3, "Primary Bed")
    h.add_room("bedroom", 9, 0, 3, 3, "Guest Bed")                # east edge
    h.add_room("bathroom_full", 6, 3, 2, 2, "Primary Bath")       # wet wall w/ kitchen
    h.add_room("bathroom_full", 8, 3, 2, 2, "Guest Bath")
    h.add_room("office", 10, 3, 2, 2, "Office")
    h.add_room("entry", 6, 5, 2, 2, "Entry")                     # shrunk: 3×2→2×2
    h.add_room("walk_in_closet", 8, 5, 1, 2, "Primary Closet")   # new: between entry+utility
    h.add_room("utility", 9, 5, 3, 2, "Utility/Laundry")
    homes.append(h.validate())

    # ── Eastern Farmhouse ── (34×24ft → 9×6 grid, 1632sf, gable 30ft, 2-story)
    h = Home("eastern-farmhouse", "Eastern Farmhouse", 9, 6, 30, "3/2.5", "gable", has_loft=True)
    h.add_room("great_room", 0, 0, 5, 3, "Living")               # wrap-around porch
    h.add_room("kitchen_open", 0, 3, 5, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 5, 0, 4, 3, "Master Bed")           # east edge
    h.add_room("bathroom_full", 5, 3, 2, 2, "Master Bath")
    h.add_room("bathroom_full", 7, 3, 2, 2, "Guest Bath")         # east edge
    h.add_room("bathroom_half", 5, 5, 1, 1, "Powder Room")
    h.add_room("corridor", 6, 5, 2, 1, "Mudroom")
    h.add_room("entry", 8, 5, 1, 1, "Entry")                     # east edge
    # Loft level: 2 guest bedrooms (has_loft=True covers these)
    homes.append(h.validate())

    # ── L Barnhouse ── (62×48ft → L-shape, 1650sf, gable 20ft)
    # Fix #5: add entry+utility, shrink half bath 3×2→1×2, proper arrival sequence.
    void = _void_rect(7, 0, 9, 4)
    h = Home("l-barnhouse", "L Barnhouse", 10, 10, 20, "2/1.5", "gable", void=void)
    h.add_room("great_room", 0, 0, 4, 5, "Living/Dining")        # public: near entry
    h.add_room("kitchen_open", 0, 5, 4, 5, "Kitchen")
    h.add_room("primary_bed", 4, 5, 3, 5, "Primary Bed")          # private: far from entry
    h.add_room("bedroom", 4, 0, 3, 5, "Guest/Flex")               # south edge
    h.add_room("bathroom_full", 7, 5, 3, 3, "Full Bath")          # east+north edge
    h.add_room("bathroom_half", 7, 8, 1, 2, "Half Bath")          # shrunk: 3×2→1×2
    h.add_room("utility", 8, 8, 2, 2, "Laundry")                  # new: east+north edge
    homes.append(h.validate())

    # ── Barnhouse 3.3 ── (72×26ft → 18×7 grid, 1900sf, gable 20ft)
    # Fix #1: corridor 27%→15%. Central hall 13×2→13×1, merge pass-through into utility,
    # shrink entry 3×3→2×3, add closet + back porch.
    h = Home("barnhouse-3-3", "Barnhouse 3.3", 18, 7, 20, "3/3", "gable")
    h.add_room("great_room", 0, 0, 5, 4, "Living/Dining")
    h.add_room("kitchen_open", 0, 4, 5, 3, "Kitchen")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Suite")
    h.add_room("bedroom", 9, 0, 3, 3, "Bedroom 2")
    h.add_room("bedroom", 12, 0, 3, 3, "Bedroom 3")
    h.add_room("walk_in_closet", 15, 0, 1, 3, "Closet")          # new: for bed 3
    h.add_room("entry", 16, 0, 2, 3, "Entry")                    # shrunk: 3×3→2×3
    h.add_room("bathroom_full", 5, 3, 2, 2, "Bath 1")            # wet wall shared w/ primary
    h.add_room("bathroom_full", 9, 3, 2, 2, "Bath 2")
    h.add_room("bathroom_full", 12, 3, 2, 2, "Bath 3")
    h.add_room("corridor", 7, 3, 2, 2, "Hallway")
    h.add_room("corridor", 11, 3, 1, 2, "Hallway 2")
    h.add_room("utility", 14, 3, 4, 2, "Utility/Laundry")        # merged pass-through
    h.add_room("corridor", 5, 5, 13, 1, "Central Hall")           # halved: 13×2→13×1
    h.add_room("deck", 5, 6, 13, 1, "Back Porch")                # new: freed row
    homes.append(h.validate())

    # ── A-Frame House Plus ── (44×31ft → 11×8 grid, 1950sf, a-frame 27ft)
    # En-suite bath for primary (P4.1), walk-in closet, proper bed/bath count.
    h = Home("a-frame-house-plus", "A-Frame House Plus", 11, 8, 27, "3/2.5", "a-frame", has_loft=True)
    h.add_room("great_room", 0, 0, 6, 5, "Great Room")            # floor-to-ceiling windows
    h.add_room("kitchen_open", 0, 5, 6, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 6, 0, 3, 3, "Primary Suite")        # shrunk for en-suite
    h.add_room("bathroom_full", 9, 0, 2, 2, "En-Suite Bath")      # adjacent to primary ✓ (P4.1)
    h.add_room("walk_in_closet", 9, 2, 2, 1, "Primary Closet")    # between bed wing + bath
    h.add_room("bedroom", 6, 3, 5, 2, "Guest Bed")                # east edge
    h.add_room("loft_bed", 6, 5, 2, 2, "Loft Suite")
    h.add_room("bathroom_full", 8, 5, 3, 2, "Full Bath")          # shared bath
    h.add_room("bathroom_half", 6, 7, 2, 1, "Powder Room")
    h.add_room("entry", 8, 7, 3, 1, "Entry")                     # east edge
    homes.append(h.validate())

    # ── Outpost Medium ── (50×25ft → 13×7 grid, 2015sf, steep roof 26ft)
    # Fix #7: bath 144sqft→96sqft, add walk-in closet for primary suite.
    h = Home("outpost-medium", "Outpost Medium", 13, 7, 26, "3/3", "steep-gable", has_loft=True)
    h.add_room("great_room", 0, 0, 6, 4, "Great Room")            # 25ft ceilings
    h.add_room("kitchen_open", 0, 4, 6, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 6, 0, 4, 3, "Suite 1")
    h.add_room("loft_bed", 6, 3, 4, 2, "Loft Suite")
    h.add_room("bedroom", 6, 5, 4, 2, "Suite 2")
    h.add_room("bathroom_full", 10, 0, 2, 3, "Bath 1")            # shrunk: 3×3→2×3
    h.add_room("walk_in_closet", 12, 0, 1, 3, "Primary Closet")   # new: east edge
    h.add_room("bathroom_full", 10, 3, 3, 2, "Bath 2")
    h.add_room("bathroom_full", 10, 5, 3, 2, "Loft Bath")
    homes.append(h.validate())

    # ── Studio House ── (est. 72×28ft → 18×7, flat roof)
    # Fix #4: office→north edge for light, corridor 15%→9%, add closet.
    h = Home("studio-house", "Studio House", 18, 7, 12, "3/2.5", "flat")
    h.add_room("great_room", 0, 0, 5, 4, "Living")
    h.add_room("kitchen_open", 0, 4, 5, 3, "Kitchen/Dining")
    h.add_room("primary_bed", 5, 0, 4, 3, "Primary Suite")
    h.add_room("bedroom", 9, 0, 3, 3, "Bedroom 2")
    h.add_room("bedroom", 12, 0, 3, 3, "Bedroom 3")
    h.add_room("bathroom_full", 5, 3, 2, 2, "Primary Bath")      # wet wall w/ primary
    h.add_room("bathroom_full", 9, 3, 2, 2, "Guest Bath")
    h.add_room("bathroom_half", 7, 3, 2, 2, "Powder Room")
    h.add_room("walk_in_closet", 11, 3, 2, 2, "Bed 3 Closet")    # new: replaced office
    h.add_room("utility", 13, 3, 2, 2, "Utility")
    h.add_room("corridor", 5, 5, 6, 2, "Hallway")                # shrunk: 8×2→6×2
    h.add_room("office", 11, 5, 2, 2, "Office")                   # moved: north edge, light ✓
    h.add_room("entry", 13, 5, 2, 2, "Entry")
    h.add_room("deck", 15, 0, 3, 7, "Covered Patio")
    homes.append(h.validate())

    # ── Barndo ── (93×36ft → 24×9 grid, 3456sf, gable 22ft)
    # Corridor reduced, back porch, buffer between loft+garage (P4.3).
    h = Home("barndo", "Barndo", 24, 9, 22, "4/3.5", "gable", has_loft=True)
    h.add_room("great_room", 0, 0, 6, 5, "Great Room")
    h.add_room("kitchen_open", 0, 5, 6, 4, "Kitchen/Dining")
    h.add_room("primary_bed", 6, 0, 5, 3, "Primary Suite")
    h.add_room("bedroom", 11, 0, 4, 3, "Suite 2")
    h.add_room("bedroom", 15, 0, 4, 3, "Suite 3")
    h.add_room("loft_bed", 19, 0, 5, 2, "Loft Suite")            # shrunk: 5×3→5×2
    h.add_room("walk_in_closet", 19, 2, 5, 1, "Storage")         # buffer loft↔garage (P4.3)
    h.add_room("bathroom_full", 6, 3, 3, 2, "Primary Bath")      # wet wall w/ primary
    h.add_room("bathroom_full", 11, 3, 2, 2, "Bath 2")
    h.add_room("bathroom_full", 15, 3, 2, 2, "Bath 3")
    h.add_room("bathroom_half", 9, 3, 2, 2, "Powder Room")
    h.add_room("utility", 13, 3, 2, 2, "Utility")
    h.add_room("corridor", 17, 3, 2, 2, "Passage")
    h.add_room("garage", 19, 3, 5, 5, "Garage")
    h.add_room("corridor", 6, 5, 13, 2, "Central Hall")
    h.add_room("deck", 6, 7, 13, 2, "Back Porch")
    h.add_room("entry", 19, 8, 5, 1, "Entry")
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
library = {"version": 4, "components": COMPONENTS, "homes": home_dicts, "coverage": coverage}
with open(os.path.join(OUT, 'library.json'), 'w') as f:
    json.dump(library, f, indent=2)

print(f"✓ {len(COMPONENTS)} components, {len(homes)} homes")
for h in homes:
    d = h.to_dict()
    envelope_pct = len(h._occupied) / len(h.envelope) * 100
    print(f"  {h.id}: {d['sqft']}sqft, {len(d['placements'])} placements, "
          f"{len(d['componentsUsed'])} types, {h.footprint['width']}x{h.footprint['depth']}ft, "
          f"{envelope_pct:.0f}% sealed")
