#!/usr/bin/env python3
"""
Parametric home generator — Heavy Mass pattern book homes.

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
import json, math, os, sys, importlib
from dataclasses import dataclass, field
from typing import Optional

# Import algorithm.py from autoresearch for optimized layouts
_ALGO_DIR = os.path.expanduser('~/.openclaw/autoresearch/plan-fidelity')
if _ALGO_DIR not in sys.path:
    sys.path.insert(0, _ALGO_DIR)
import algorithm as _algorithm
importlib.reload(_algorithm)

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
CIRCULATION_MAX_PCT = 0   # NO corridors allowed (Great Room Core principle)
LDK_MIN_PCT = 35          # living/dining/kitchen ≥35% of habitable area (Great Room dominance)
LDK_MAX_PCT = 50          # cap at 50% — leave room for private zones
MAX_ROOM_RATIO = 2.0      # silver ratio cap: no room wider than 1:2

# ══════════════════════════════════════════════════════════════════════
# "DEN GREAT ROOM CORE" — Design Language
# ══════════════════════════════════════════════════════════════════════
# Derived from Heavy Mass floor plans (Barnhouse 2.2, L Barnhouse,
# Outpost Medium, A-Frame House Plus, Barnhouse 1.1, Alpine Family).
#
# Principles:
#   1. GREAT ROOM DOMINANCE — open LDK is 35-50% of indoor area,
#      always one contiguous space (living + dining + kitchen)
#   2. TWO-ZONE COMPOSITION — PUBLIC (great room + deck) on one end,
#      PRIVATE (bedrooms + service) on the other
#   3. ENTRY AS THRESHOLD — entry sits at boundary between zones
#   4. SERVICE SPINE — wet rooms cluster on shared plumbing wall
#      between public and private zones
#   5. NO CORRIDORS — rooms flow directly into each other or
#      open onto the great room
#   6. PERIMETER BEDROOMS — all sleeping rooms on exterior walls
#   7. DECK EXTENDS LIVING — covered outdoor at the public zone end
#   8. TALL ROOFS — gable, steep-gable, or a-frame preferred
#
# Layout template (along building LONG axis):
#   [Deck] → [Great Room/Kitchen] → [Entry + Service] → [Bedrooms + Baths]
# ══════════════════════════════════════════════════════════════════════
GREAT_ROOM_CORE = False   # disabled — algorithm.py uses corridor-based layouts optimized by autoresearch

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
    "kitchen_open":  RoomConstraint(2, 2, 64, False, False, False, False, True,
                     "NKBA: island + work triangle + dining. 48in around island"),

    # ── Living ──
    "living":        RoomConstraint(2, 2, 64, True, False, False, False, True,
                     "Sofa + coffee table + 8ft TV viewing + 36in circulation"),
    "great_room":    RoomConstraint(2, 2, 64, True, False, False, False, True,
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
    "gallery":       RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "Traversable bridge between zones. Interior circulation"),

    "stairs":        RoomConstraint(1, 1, 16,  False, False, False, False, False,
                     "Staircase connecting ground floor to loft/upper level"),

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
# ROOM ADJACENCY GRAPH — Connection types between rooms
# ══════════════════════════════════════════════════════════════════════
#
# Every pair of adjacent rooms gets a connection type:
#   "open"    — no wall, free flow (open-plan LDK, entry to great room)
#   "door"    — interior door in shared wall (bedrooms, bathrooms, closets)
#   "sliding" — sliding door in shared wall (deck to living, pocket doors)
#   "wall"    — solid wall, no passage (bedroom-to-bedroom, noise isolation)
#
# Connection types are auto-inferred from room type pairs using
# architectural conventions. Explicit h.connect() calls override.
#
# Circulation is validated via BFS from entry — every room must be
# reachable through open/door/sliding connections.
# ══════════════════════════════════════════════════════════════════════

OPEN_PLAN_TYPES = frozenset({"great_room", "living", "kitchen", "kitchen_open", "dining"})
PRIVATE_TYPES = frozenset({"bedroom", "primary_bed"})
WET_TYPES = frozenset({"bathroom_full", "bathroom_half", "bathroom_ada"})
STORAGE_TYPES = frozenset({"walk_in_closet", "pantry", "nook"})
SERVICE_TYPES = frozenset({"utility", "mudroom"})
ENTRY_TYPES = frozenset({"entry"})
OUTDOOR_TYPES = frozenset({"deck", "engawa"})
LOFT_TYPES = frozenset({"loft_bed"})

# Privacy levels (0=public → 3=intimate) for gradient validation
PRIVACY_LEVEL = {
    "deck": 0, "engawa": 0,
    "entry": 0, "mudroom": 0,
    "great_room": 0, "living": 0, "dining": 0,
    "kitchen": 1, "kitchen_open": 1,
    "corridor": 1, "garage": 1,
    "office": 2, "flex": 2, "meditation": 2, "nook": 2,
    "utility": 2, "pantry": 2,
    "bathroom_half": 2,
    "bathroom_full": 3, "bathroom_ada": 3,
    "bedroom": 3, "primary_bed": 3, "loft_bed": 3,
    "walk_in_closet": 3,
}

# Priority-ordered connection rules: first match wins.
# (type_set_a, type_set_b, connection_type)
# None = matches any type.
_CONNECTION_RULES = [
    # Open-plan ↔ open-plan → open (LDK flows freely)
    (OPEN_PLAN_TYPES, OPEN_PLAN_TYPES, "open"),
    # Entry ↔ open-plan → open (threshold opens to great room)
    (ENTRY_TYPES, OPEN_PLAN_TYPES, "open"),
    # Bedroom ↔ bedroom → wall (no door between bedrooms)
    (PRIVATE_TYPES, PRIVATE_TYPES, "wall"),
    # Bathroom ↔ bathroom → wall (separate access)
    (WET_TYPES, WET_TYPES, "wall"),
    # Outdoor ↔ open-plan → sliding (nature connection)
    (OUTDOOR_TYPES, OPEN_PLAN_TYPES, "sliding"),
    # Outdoor ↔ entry → door (step out to deck)
    (OUTDOOR_TYPES, ENTRY_TYPES, "door"),
    # Outdoor ↔ anything else → wall
    (OUTDOOR_TYPES, None, "wall"),
    # Loft ↔ anything → wall (access via stairs, not door on same level)
    (LOFT_TYPES, None, "wall"),
    # Bedroom → open-plan → door (access from great room)
    (PRIVATE_TYPES, OPEN_PLAN_TYPES, "door"),
    # Bedroom → bathroom → door (en-suite)
    (PRIVATE_TYPES, WET_TYPES, "door"),
    # Bedroom → storage → door (closet)
    (PRIVATE_TYPES, STORAGE_TYPES, "door"),
    # Bedroom → entry → door
    (PRIVATE_TYPES, ENTRY_TYPES, "door"),
    # Bedroom → service → wall (noise: no door between bedroom and utility)
    (PRIVATE_TYPES, SERVICE_TYPES, "wall"),
    # Entry → anything → door
    (ENTRY_TYPES, None, "door"),
    # Open-plan → storage/service → door
    (OPEN_PLAN_TYPES, STORAGE_TYPES, "door"),
    (OPEN_PLAN_TYPES, SERVICE_TYPES, "door"),
    # Open-plan → bathroom → door (powder room off great room)
    (OPEN_PLAN_TYPES, WET_TYPES, "door"),
    # Open-plan → anything else → door
    (OPEN_PLAN_TYPES, None, "door"),
    # Storage ↔ storage → open (walk between closets)
    (STORAGE_TYPES, STORAGE_TYPES, "open"),
    # Service → wet → door (utility next to bathroom)
    (SERVICE_TYPES, WET_TYPES, "door"),
    # Service → storage → door
    (SERVICE_TYPES, STORAGE_TYPES, "door"),
    # Wet → storage → door (linen closet off bathroom)
    (WET_TYPES, STORAGE_TYPES, "door"),
    # Fallback → door (if adjacent and not handled above, assume access needed)
    (None, None, "door"),
]


def _infer_connection(type1: str, type2: str) -> str:
    """Infer default connection type between two adjacent room types."""
    for set_a, set_b, conn in _CONNECTION_RULES:
        if set_a is None and set_b is None:
            return conn
        if set_a is None:
            if type1 in set_b or type2 in set_b:
                return conn
        elif set_b is None:
            if type1 in set_a or type2 in set_a:
                return conn
        else:
            if (type1 in set_a and type2 in set_b) or (type1 in set_b and type2 in set_a):
                return conn
    return "wall"


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
    floor: int = 0  # 0=ground, 1=loft level

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
        # Room adjacency graph: {(label_a, label_b): "open"|"door"|"sliding"|"wall"}
        self._connections: dict[tuple[str, str], str] = {}
        self._explicit_connections: set[tuple[str, str]] = set()

        all_cells = {(x, z) for x in range(grid_w) for z in range(grid_d)}
        self._void = set(void or [])
        self.envelope = all_cells - self._void

    def add_room(self, room_type: str, gx: int, gz: int, gw: int, gd: int,
                 label: Optional[str] = None, floor: int = 0) -> 'Home':
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
        if overlap and floor == 0:
            raise ValueError(f"{label}: overlaps existing room at {overlap}")

        if c.needs_exterior:
            touches = any(
                neighbor not in self.envelope
                for (x, z) in new_cells
                for neighbor in [(x-1, z), (x+1, z), (x, z-1), (x, z+1)]
            )
            if not touches:
                print(f"  WARN {self.id}/{label}: {room_type} should have exterior wall but is interior")

        if room_type not in ("corridor", "deck", "engawa", "garage"):
            if gw > MAX_CLEAR_SPAN_G and gd > MAX_CLEAR_SPAN_G:
                print(f"  WARN {self.id}/{label}: both dimensions ({gw*GRID}×{gd*GRID}ft) "
                      f"exceed {MAX_CLEAR_SPAN_FT}ft clear span")

        room = Room(room_type, label, gx, gz, gw, gd, floor=floor)
        self.rooms.append(room)
        self._occupied |= new_cells
        return self

    def connect(self, label1: str, label2: str, conn_type: str) -> 'Home':
        """Explicitly set connection type between two rooms (overrides auto-infer)."""
        key = tuple(sorted([label1, label2]))
        self._connections[key] = conn_type
        self._explicit_connections.add(key)
        return self

    def _auto_connect(self):
        """Build connection graph for all adjacent room pairs.

        Uses _infer_connection() to determine the default type based on
        room type pairs. Explicit connect() calls are preserved.
        Then validates circulation: BFS from entry must reach all rooms.
        Unreachable rooms get a forced 'door' to the nearest reachable room.
        """
        # Build room label → Room lookup
        room_by_label = {r.label: r for r in self.rooms}

        # Build cell → room lookup
        cell_room = {}
        for room in self.rooms:
            for cell in room.cells:
                cell_room[cell] = room

        # Find all adjacent room pairs (rooms sharing at least one cell edge)
        adjacent_pairs = set()
        for cell in self._occupied:
            gx, gz = cell
            room = cell_room.get(cell)
            if not room:
                continue
            for nx, nz in [(gx-1, gz), (gx+1, gz), (gx, gz-1), (gx, gz+1)]:
                neighbor = cell_room.get((nx, nz))
                if neighbor and neighbor.label != room.label:
                    pair = tuple(sorted([room.label, neighbor.label]))
                    adjacent_pairs.add(pair)

        # Infer connections for pairs without explicit overrides
        for pair in adjacent_pairs:
            if pair in self._explicit_connections:
                continue
            r1 = room_by_label[pair[0]]
            r2 = room_by_label[pair[1]]
            self._connections[pair] = _infer_connection(r1.type, r2.type)

        # Validate circulation: BFS from entry through open/door/sliding
        self._validate_circulation(room_by_label, adjacent_pairs)

    def _validate_circulation(self, room_by_label, adjacent_pairs):
        """BFS from entry — every indoor room must be reachable.

        If unreachable rooms exist, force 'door' connections to fix.
        Loft rooms are exempt (accessed by stairs).
        """
        # Build access graph: edges with type != "wall"
        access_graph = {}  # label → set of neighbor labels
        for room in self.rooms:
            access_graph[room.label] = set()

        for pair, conn_type in self._connections.items():
            if conn_type != "wall":
                access_graph.setdefault(pair[0], set()).add(pair[1])
                access_graph.setdefault(pair[1], set()).add(pair[0])

        # Find entry room (start of BFS)
        entries = [r for r in self.rooms if r.type in ENTRY_TYPES]
        if not entries:
            # No entry room — use the first open-plan room as start
            entries = [r for r in self.rooms if r.type in OPEN_PLAN_TYPES]
        if not entries:
            print(f"  WARN {self.id}: no entry or living room found for circulation check")
            return

        # BFS
        start = entries[0].label
        visited = {start}
        frontier = [start]
        while frontier:
            current = frontier.pop(0)
            for neighbor in access_graph.get(current, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    frontier.append(neighbor)

        # Check which rooms are unreachable (exclude lofts and outdoor)
        indoor_rooms = [r for r in self.rooms
                        if r.type not in LOFT_TYPES and r.type not in OUTDOOR_TYPES]
        unreachable = [r for r in indoor_rooms if r.label not in visited]

        # Force door connections for unreachable rooms
        for room in unreachable:
            # Find any adjacent reachable room to connect to
            best = None
            for pair in adjacent_pairs:
                if room.label in pair:
                    other_label = pair[0] if pair[1] == room.label else pair[1]
                    if other_label in visited:
                        best = (pair, other_label)
                        break

            if best:
                pair, other_label = best
                old_type = self._connections.get(pair, "wall")
                self._connections[pair] = "door"
                visited.add(room.label)
                # Re-add to frontier so rooms behind this one are found
                frontier = [room.label]
                while frontier:
                    current = frontier.pop(0)
                    for p, ct in self._connections.items():
                        if ct == "wall":
                            continue
                        if current in p:
                            other = p[0] if p[1] == current else p[1]
                            if other not in visited:
                                visited.add(other)
                                frontier.append(other)
                print(f"  FIX {self.id}: forced '{room.label}' → '{other_label}' "
                      f"from '{old_type}' to 'door' (was unreachable)")
            else:
                print(f"  FAIL {self.id}: '{room.label}' is unreachable — "
                      f"no adjacent reachable room found")

        # ══════════════════════════════════════════════════════════════
        # SPACE SYNTAX ANALYSIS (Hillier & Hanson, 1984)
        # ══════════════════════════════════════════════════════════════
        #
        # Justified Permeability Graph (JPG) rooted at entry.
        # Metrics:
        #   Depth        — rooms traversed from entry to each room
        #   Mean Depth   — average depth across all rooms
        #   Rel. Asymmetry (RA) — 0=integrated, 1=segregated
        #   Integration  — 1/RA (higher=more accessible)
        #   Ring check   — alternative paths exist (avoids dead-end layouts)
        #
        # Path quality uses "clean path" check: for each bedroom, does
        # there exist ANY path from entry that avoids passing through
        # other bedrooms, bathrooms, or closets? (Not just the BFS-first
        # path, which depends on arbitrary visit order.)
        # ══════════════════════════════════════════════════════════════

        PASSTHROUGH_BAD = PRIVATE_TYPES | WET_TYPES | STORAGE_TYPES

        room_by_label = {r.label: r for r in self.rooms}

        # Build access graph (non-wall connections)
        access_graph = {}
        for room in self.rooms:
            access_graph[room.label] = set()
        for pair, conn_type in self._connections.items():
            if conn_type != "wall":
                access_graph.setdefault(pair[0], set()).add(pair[1])
                access_graph.setdefault(pair[1], set()).add(pair[0])

        # ── Depth from entry (BFS) ──
        depth = {start: 0}
        bfs_q = [start]
        while bfs_q:
            current = bfs_q.pop(0)
            for neighbor in access_graph.get(current, []):
                if neighbor not in depth:
                    depth[neighbor] = depth[current] + 1
                    bfs_q.append(neighbor)

        # ── Mean Depth & Relative Asymmetry ──
        indoor_rooms = [r for r in self.rooms
                        if r.type not in OUTDOOR_TYPES and r.type not in LOFT_TYPES]
        indoor_labels = {r.label for r in indoor_rooms}
        depths = [depth.get(r.label, 999) for r in indoor_rooms if r.label in depth]
        k = len(indoor_labels)
        mean_depth = sum(depths) / len(depths) if depths else 0
        # RA = 2(MD - 1) / (k - 2), for k >= 3
        ra = 2 * (mean_depth - 1) / (k - 2) if k >= 3 else 0
        integration = 1 / ra if ra > 0 else float('inf')

        # ── Ring check (are there alternative paths?) ──
        # A tree has exactly k-1 edges. More edges = rings.
        edge_count = sum(1 for v in self._connections.values() if v != "wall")
        has_rings = edge_count > (k - 1)

        # ── Clean path check for bedrooms (Space Syntax: depth + type filter) ──
        # For each bedroom: build a restricted graph that excludes all
        # PASSTHROUGH_BAD nodes (except the target bedroom itself).
        # If entry can still reach the bedroom → clean path exists.
        bedrooms = [r for r in self.rooms if r.type in PRIVATE_TYPES]
        path_issues = []
        for bed in bedrooms:
            # Build restricted graph: remove all private/wet/storage nodes
            # except the target bedroom
            restricted_nodes = set()
            for label, room in room_by_label.items():
                if room.type in PASSTHROUGH_BAD and label != bed.label:
                    continue  # exclude this node
                restricted_nodes.add(label)

            # BFS in restricted graph
            r_visited = {start}
            r_queue = [start]
            while r_queue:
                current = r_queue.pop(0)
                for neighbor in access_graph.get(current, []):
                    if neighbor in restricted_nodes and neighbor not in r_visited:
                        r_visited.add(neighbor)
                        r_queue.append(neighbor)

            if bed.label not in r_visited:
                # No clean path exists — find what's blocking
                bed_depth = depth.get(bed.label, -1)
                path_issues.append(
                    f"  FAIL {self.id}: '{bed.label}' has no clean path from entry "
                    f"(depth={bed_depth}, only reachable through private rooms)")

        for issue in path_issues:
            print(issue)

        # ── Report ──
        access_rooms = [r for r in self.rooms if r.type not in OUTDOOR_TYPES]
        reachable_count = sum(1 for r in access_rooms if r.label in depth)
        total = len(access_rooms)
        doors = sum(1 for v in self._connections.values() if v == "door")
        opens = sum(1 for v in self._connections.values() if v == "open")
        slidings = sum(1 for v in self._connections.values() if v == "sliding")
        walls = sum(1 for v in self._connections.values() if v == "wall")
        ok = "✓" if not path_issues else "✗"
        ring_s = "ring" if has_rings else "tree"
        print(f"  {ok} {self.id}: {reachable_count}/{total} reachable | "
              f"MD={mean_depth:.1f} RA={ra:.2f} int={integration:.1f} ({ring_s}) | "
              f"{opens} open, {doors} door, {slidings} sliding, {walls} wall"
              f"{' | ' + str(len(path_issues)) + ' BROKEN' if path_issues else ''}")

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

        ldk_types = ("living", "great_room", "kitchen", "kitchen_open", "dining")

        # ── NO CORRIDORS (Great Room Core) ──
        corr_rooms = [r for r in self.rooms if r.type == "corridor"]
        if corr_rooms and GREAT_ROOM_CORE:
            print(f"  FAIL {self.id}: Great Room Core forbids corridors — "
                  f"found {len(corr_rooms)} corridor rooms")

        # ── Great Room contiguity — LDK rooms must be adjacent ──
        if GREAT_ROOM_CORE:
            ldk_rooms = [r for r in self.rooms if r.type in ldk_types]
            if len(ldk_rooms) >= 2:
                # BFS from first LDK room — all others must be reachable
                visited = {ldk_rooms[0].label}
                frontier = [ldk_rooms[0]]
                while frontier:
                    current = frontier.pop()
                    for other in ldk_rooms:
                        if other.label not in visited and _adjacent(current, other):
                            visited.add(other.label)
                            frontier.append(other)
                disconnected = [r.label for r in ldk_rooms if r.label not in visited]
                if disconnected:
                    print(f"  WARN {self.id}: LDK rooms not contiguous — "
                          f"{disconnected} disconnected from main LDK group")

        # ── Deck should adjoin LDK zone ──
        if GREAT_ROOM_CORE:
            ldk_rooms_list = [r for r in self.rooms if r.type in ldk_types]
            for d in outdoor:
                if ldk_rooms_list and not any(_adjacent(d, lv) for lv in ldk_rooms_list):
                    if not any(_adjacent(d, lv) for lv in living):
                        print(f"  WARN {self.id}: '{d.label}' not adjacent to LDK zone")

        # ── LDK heart ≥35% of habitable ──
        ldk_cells = sum(len(r.cells) for r in self.rooms if r.type in ldk_types)
        if indoor_cells > 0:
            ldk_pct = ldk_cells * 100 / indoor_cells
            if ldk_pct < LDK_MIN_PCT and indoor_cells > 20:
                print(f"  WARN {self.id}: LDK {ldk_pct:.0f}% — target ≥{LDK_MIN_PCT}%")

        # ── Build room adjacency graph + validate circulation ──
        self._auto_connect()

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

        # ── Walls (connection-graph-aware) ──
        # "open" connections → no wall between rooms
        # "door"/"sliding" connections → wall with one opening
        # "wall" connections → solid wall (no passage)
        ext_edges = []
        int_edges_by_pair = {}  # {(label_a, label_b): [edge_dicts]}

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
                    # Exterior wall
                    p = _p("wall-ext", pos[0], pos[1], pos[2], ry=rot_y, zone="walls")
                    p["_edge_cell"] = cell
                    p["_edge_dir"] = direction
                    p["_room"] = room
                    ext_edges.append(p)
                    placements.append(p)
                elif neighbor in self._occupied:
                    neighbor_room = cell_room.get(neighbor)
                    if room and neighbor_room and room.label != neighbor_room.label:
                        if cell < neighbor:  # avoid duplicates
                            pair = tuple(sorted([room.label, neighbor_room.label]))
                            conn_type = self._connections.get(pair, "wall")

                            if conn_type == "open":
                                # No wall — open flow between rooms
                                pass
                            else:
                                # Wall segment (may get a door placed later)
                                p = _p("wall-int", pos[0], pos[1], pos[2],
                                       ry=rot_y, zone="interior")
                                p["_room"] = room
                                p["_neighbor_room"] = neighbor_room
                                p["_pair"] = pair
                                int_edges_by_pair.setdefault(pair, []).append(p)
                                placements.append(p)

        # ── Openings (exterior from OPENING_RULES + interior from connection graph) ──
        self._place_openings(placements, ext_edges, int_edges_by_pair, cell_room, w, d, wall_h)

        # ── Roof ──
        self._place_roof(placements, w, d, wall_h)

        # ── Room metadata (with colors for visualization) ──
        # Import fixture placement from autoresearch
        try:
            _fix_dir = os.path.expanduser('~/.openclaw/autoresearch/plan-fidelity')
            if _fix_dir not in sys.path:
                sys.path.insert(0, _fix_dir)
            from fixtures import place_all_fixtures
            raw_rooms = [{"type": r.type, "label": r.label,
                         "gx": r.gx, "gz": r.gz, "gw": r.gw, "gd": r.gd}
                        for r in self.rooms]
            all_fixtures = place_all_fixtures(raw_rooms)
        except Exception:
            all_fixtures = {}

        room_layouts = []
        for room in self.rooms:
            rd = {
                "label": room.label,
                "type": room.type,
                "gx": room.gx, "gz": room.gz,
                "gw": room.gw, "gd": room.gd,
                "area": room.area_sqft,
                "color": ROOM_COLORS.get(room.type, "#94a3b8"),
                "constraints": ROOM_RULES[room.type].furniture_note,
            }
            if room.floor > 0:
                rd["floor"] = room.floor
            # Add fixtures (counters, tubs, beds, windows, doors)
            room_fix = all_fixtures.get(room.label, [])
            if room_fix:
                rd["fixtures"] = room_fix
            room_layouts.append(rd)

        # Clean internal keys
        for p in placements:
            for k in list(p.keys()):
                if k.startswith("_"):
                    del p[k]

        return placements, room_layouts

    def _place_openings(self, placements, ext_edges, int_edges_by_pair, cell_room, w, d, wall_h):
        """Place openings using connection graph.

        Exterior openings: driven by OPENING_RULES (windows, doors, sliding glass).
        Interior openings: driven by self._connections graph.
          - "door" connections → pick one shared wall segment, place interior door
          - "sliding" connections → pick one shared wall segment, place sliding door
          - "open" connections → already handled (no walls generated)
          - "wall" connections → solid wall (no opening)

        Door position: corner-positioned (Alexander Pattern 196) — pick the
        edge at the END of the shared wall run to preserve usable wall area.
        """
        # ── 1. Exterior openings (from OPENING_RULES) ──
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

                try:
                    idx = placements.index(edge)
                except ValueError:
                    continue  # edge already replaced by prior opening

                if opening_type == "door":
                    placements[idx] = _p("door-ext", pos["x"], 4.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="openings")
                    placements.append(_p("wall-ext", pos["x"], 9.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.2))

                elif opening_type == "sliding":
                    placements[idx] = _p("door-sliding", pos["x"], 4.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="openings")
                    placements.append(_p("wall-ext", pos["x"], 9.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.2))

                elif opening_type == "window":
                    placements[idx] = _p("wall-ext", pos["x"], 2, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.3)
                    placements.append(_p("window-std", pos["x"], 5.5, pos["z"],
                                         ry=edge["rotation"]["y"], zone="openings"))
                    placements.append(_p("wall-ext", pos["x"], 9, pos["z"],
                                         ry=edge["rotation"]["y"], zone="walls", sy=0.3))

        # ── 2. Interior openings (from connection graph) ──
        for pair, conn_type in self._connections.items():
            if conn_type not in ("door", "sliding"):
                continue

            edges = int_edges_by_pair.get(pair, [])
            if not edges:
                continue

            # Alexander Pattern 196: corner-position the door.
            # Pick the edge at the END of the shared wall run (lowest coord).
            # This preserves the most usable wall area on both sides.
            edge = self._pick_corner_edge(edges)
            pos = edge["position"]
            ry = edge["rotation"]["y"]

            if conn_type == "door":
                # Replace wall segment with interior door + transom above
                idx = placements.index(edge)
                placements[idx] = _p("door-int", pos["x"], 3.5, pos["z"],
                                     ry=ry, zone="openings")
                # Transom wall above door
                placements.append(_p("wall-int", pos["x"], 8.5, pos["z"],
                                     ry=ry, zone="interior", sy=0.3))
            elif conn_type == "sliding":
                # Interior sliding door (wider, glass)
                idx = placements.index(edge)
                placements[idx] = _p("door-sliding", pos["x"], 4.5, pos["z"],
                                     ry=ry, zone="openings")
                placements.append(_p("wall-int", pos["x"], 9.5, pos["z"],
                                     ry=ry, zone="interior", sy=0.2))

    def _pick_corner_edge(self, edges):
        """Pick the wall edge closest to a room corner (Alexander Pattern 196).

        For a run of shared wall segments, prefer the first or last one
        (at the ends of the shared wall), not the middle.
        """
        if len(edges) <= 1:
            return edges[0]

        # Sort by position to find ends of the wall run
        def edge_pos(e):
            p = e["position"]
            return (p["x"], p["z"])
        edges_sorted = sorted(edges, key=edge_pos)

        # Pick the first edge (corner-adjacent end of the wall run)
        return edges_sorted[0]

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

        # Serialize connection graph
        connections = []
        for (label_a, label_b), conn_type in sorted(self._connections.items()):
            connections.append({
                "from": label_a,
                "to": label_b,
                "type": conn_type,
            })

        # Compute loft height: if any room has floor=1, loftHeight = wall height
        loft_rooms = [r for r in self.rooms if r.floor == 1]
        loft_height = None
        if loft_rooms or self.has_loft:
            # Loft floor sits at the wall height (typically 8ft for living space below)
            if self.roof_style == 'a-frame':
                loft_height = 8  # A-frame loft at 8ft
            elif self.roof_style in ('steep-gable', 'gable'):
                loft_height = 8  # Standard loft height
            else:
                loft_height = 9  # Flat/shed roofs, slightly higher

        result = {
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
            "connections": connections,
        }
        if loft_height is not None:
            result["loftHeight"] = loft_height
        return result


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
# PLAN SPECS — matching evaluate.py's TEST_SPECS (source of truth)
# ══════════════════════════════════════════════════════════════════════

PLAN_SPECS = [
    {"id": "outpost", "name": "The Outpost", "beds": 0, "baths": 1, "sqft_target": 320, "roof_style": "a-frame", "has_loft": False},
    {"id": "essential-retreat", "name": "Essential Retreat", "beds": 1, "baths": 1, "sqft_target": 560, "roof_style": "gable", "has_loft": False},
    {"id": "a-frame-weekender", "name": "A-Frame Weekender", "beds": 1, "baths": 1, "sqft_target": 448, "roof_style": "a-frame", "has_loft": True},
    {"id": "barnhouse-retreat", "name": "Barnhouse Retreat", "beds": 2, "baths": 1, "sqft_target": 720, "roof_style": "gable", "has_loft": False},
    {"id": "modern-loft-barnhouse", "name": "Modern Loft Barnhouse", "beds": 2, "baths": 1, "sqft_target": 512, "roof_style": "steep-gable", "has_loft": True},
    {"id": "barnhouse-2-1", "name": "Barnhouse 2.1", "beds": 2, "baths": 1, "sqft_target": 864, "roof_style": "gable", "has_loft": False},
    {"id": "a-frame-retreat", "name": "A-Frame Retreat", "beds": 2, "baths": 1, "sqft_target": 768, "roof_style": "a-frame", "has_loft": True},
    {"id": "essential-house", "name": "Essential House", "beds": 2, "baths": 2, "sqft_target": 1008, "roof_style": "gable", "has_loft": False},
    {"id": "barnhouse-family", "name": "Barnhouse Family", "beds": 3, "baths": 2, "sqft_target": 1504, "roof_style": "gable", "has_loft": False},
    {"id": "a-frame-house-plus", "name": "A-Frame House Plus", "beds": 3, "baths": 2, "sqft_target": 1408, "roof_style": "a-frame", "has_loft": True},
    {"id": "eastern-farmhouse", "name": "Eastern Farmhouse", "beds": 3, "baths": 2, "sqft_target": 1008, "roof_style": "gable", "has_loft": False},
    {"id": "modern-treehouse", "name": "Modern Treehouse", "beds": 3, "baths": 2, "sqft_target": 1664, "roof_style": "steep-gable", "has_loft": True},
    {"id": "barndo", "name": "Barndo", "beds": 4, "baths": 3, "sqft_target": 2848, "roof_style": "gable", "has_loft": False},
    {"id": "townhome-2bed", "name": "Townhome 2-Bed", "beds": 2, "baths": 1, "sqft_target": 900, "roof_style": "gable", "has_loft": False, "party_walls": ["left"]},
    {"id": "townhome-3bed", "name": "Townhome 3-Bed", "beds": 3, "baths": 2, "sqft_target": 1100, "roof_style": "gable", "has_loft": False, "party_walls": ["left", "right"]},
]

# Viewer-specific metadata (height for roof rendering, ID overrides)
HOME_META = {
    "outpost": {"viewer_id": "the-outpost", "height": 18},
    "a-frame-weekender": {"height": 21},
    "a-frame-retreat": {"height": 27},
    "a-frame-house-plus": {"height": 27},
    "eastern-farmhouse": {"height": 30},
    "barnhouse-family": {"height": 21},
    "barndo": {"height": 22},
    "modern-treehouse": {"height": 20},
    "modern-loft-barnhouse": {"height": 18},
    "barnhouse-2-1": {"height": 20},
}


def _estimate_height(roof_style, grid_w):
    """Estimate building height from roof style and width."""
    if roof_style == "a-frame":
        return min(30, int(10 + grid_w * GRID * 0.866 / 2))
    elif roof_style == "steep-gable":
        return min(25, int(10 + grid_w * GRID * 0.5 / 2))
    elif roof_style == "gable":
        return min(20, int(10 + grid_w * GRID * 0.466 / 2))
    elif roof_style == "flat":
        return 12
    else:
        return 15


# ══════════════════════════════════════════════════════════════════════
# HOME DEFINITIONS — Generated from algorithm.py (autoresearch-optimized)
# ══════════════════════════════════════════════════════════════════════

def define_homes():
    """Generate all 15 homes using algorithm.py's optimized layouts.

    This replaces the previous hardcoded room definitions with layouts
    from the autoresearch pipeline, ensuring the viewer shows exactly
    what the evaluator scores.
    """
    homes = []

    for spec in PLAN_SPECS:
        rooms_data = _algorithm.generate_layout(spec)
        if not rooms_data:
            print(f"  SKIP {spec['id']}: algorithm returned no rooms")
            continue

        # Derive grid dimensions from generated rooms
        grid_w = max(r["gx"] + r["gw"] for r in rooms_data)
        grid_d = max(r["gz"] + r["gd"] for r in rooms_data)

        meta = HOME_META.get(spec["id"], {})
        home_id = meta.get("viewer_id", spec["id"])
        model = spec["name"]
        height = meta.get("height", _estimate_height(spec["roof_style"], grid_w))

        # Compute bed_bath from generated rooms
        beds = sum(1 for r in rooms_data if r["type"] in ("bedroom", "primary_bed", "loft_bed"))
        full_baths = sum(1 for r in rooms_data if r["type"] in ("bathroom_full", "bathroom_ada"))
        half_baths = sum(1 for r in rooms_data if r["type"] == "bathroom_half")
        bath_str = f"{full_baths}" if half_baths == 0 else f"{full_baths}.{half_baths * 5}"
        bed_bath = f"{beds}/{bath_str}"

        h = Home(
            id=home_id,
            model=model,
            grid_w=grid_w,
            grid_d=grid_d,
            height=height,
            bed_bath=bed_bath,
            roof_style=spec["roof_style"],
            has_loft=spec.get("has_loft", False),
        )

        for room in rooms_data:
            floor = room.get("floor", 1 if room["type"] == "loft_bed" else 0)
            h.add_room(
                room["type"],
                room["gx"], room["gz"],
                room["gw"], room["gd"],
                label=room["label"],
                floor=floor,
            )

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
library = {"version": 6, "components": COMPONENTS, "homes": home_dicts, "coverage": coverage}
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
    ok = "✓" if l_pct >= 25 else "✗"
    print(f"  {ok} {h.id}: {d['sqft']}sf | storage:{s_pct:.0f}% corr:{c_pct:.0f}% ldk:{l_pct:.0f}% | "
          f"{h.footprint['width']}×{h.footprint['depth']}ft | 100% sealed")
