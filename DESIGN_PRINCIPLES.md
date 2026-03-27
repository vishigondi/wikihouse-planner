# Zero-Waste Architectural Design Principles
## For Parametric Modular Panel-Based Home Generation

This document codifies architectural principles from seven traditions into concrete, encodable constraints for a parametric floor plan generator targeting modular panel-based homes (WikiHouse/Heavy Mass style) with open-plan living, large great rooms, and tall roofs.

---

## 1. Christopher Alexander's "A Pattern Language"

Alexander's 1977 work contains 253 interconnected patterns for architecture at every scale. His core thesis for efficiency: *"Every building is better when all the patterns it needs are compressed as far as possible. The building will be cheaper; and the meanings in it will be denser."*

### Relevant Patterns for Open-Plan Residential

**Pattern 107: Wings of Light**
- *What it is:* Buildings should be organized as narrow wings (max ~7.5m / 25ft deep) so that every room can have natural light on at least two sides.
- *How it prevents waste:* A narrow-wing plan eliminates deep, dark interior zones that become dead space requiring artificial lighting and ventilation. Every square meter is usable.
- *Encodable constraint:* `building_depth <= 7.5m (25ft)` for any wing. No room center point may be more than 3.75m from an exterior wall.

**Pattern 109: Long Thin House**
- *What it is:* The most efficient residential form is a long, thin rectangle oriented along the east-west axis to maximize southern exposure.
- *How it prevents waste:* Eliminates interior rooms that lack daylight. Maximizes passive solar gain. Every room touches an exterior wall.
- *Encodable constraint:* `aspect_ratio >= 2:1` (length:depth). Primary axis oriented within 15 degrees of east-west.

**Pattern 127: Intimacy Gradient**
- *What it is:* Spaces should progress from public (entrance) to private (bedrooms) in a clear gradient, with no backtracking.
- *How it prevents waste:* Eliminates corridor space needed to route around "misplaced" rooms. Circulation becomes linear rather than branching.
- *Encodable constraint:* Each room has a `privacy_level` (1-5). For any path from entrance to a room, privacy levels must be monotonically non-decreasing. No room with `privacy >= 4` may be directly adjacent to the entrance zone.

**Pattern 129: Common Areas at the Heart**
- *What it is:* A single large shared space (great room / farmhouse kitchen) at the center of the plan, which all circulation passes through or alongside.
- *How it prevents waste:* The common area IS the circulation. No separate hallway needed when all paths converge through the great room.
- *Encodable constraint:* `great_room.adjacency_count >= (total_rooms - 1) * 0.6`. The great room must be directly adjacent to at least 60% of all other rooms.

**Pattern 131: The Flow Through Rooms**
- *What it is:* Movement through a building should flow through rooms themselves rather than through dedicated corridors.
- *How it prevents waste:* Eliminates hallways entirely. Each room serves double duty as both destination and passage.
- *Encodable constraint:* `dedicated_circulation_area / total_floor_area <= 0.05` (5% max). Rooms with `area >= 12sqm` must have at least 2 doorways.

**Pattern 139: Farmhouse Kitchen**
- *What it is:* The kitchen should be integrated into the largest shared room, not isolated. Big enough for a large table, long counters, and family activity.
- *How it prevents waste:* Eliminates the separate dining room AND the separate kitchen, merging three rooms (kitchen + dining + family) into one great room.
- *Encodable constraint:* `kitchen_zone` must be within `great_room` footprint. `great_room.area >= 30sqm` when kitchen is integrated.

**Pattern 159: Light on Two Sides of Every Room**
- *What it is:* Every habitable room needs windows on at least two walls for cross-ventilation and balanced daylight.
- *How it prevents waste:* Forces rooms to be at building perimeter, preventing interior "dead zones." Rooms that touch two exterior walls are inherently space-efficient.
- *Encodable constraint:* Every room with `area >= 8sqm` must have `exterior_wall_count >= 2`. Rooms touching only 1 exterior wall must have `depth <= width`.

**Pattern 190: Ceiling Height Variety**
- *What it is:* Ceiling heights should vary with room function -- tall for gathering spaces, lower for intimate rooms.
- *How it prevents waste:* Volume is deployed where it matters (great room, cathedral ceiling) rather than uniformly. Low ceilings in service areas reduce material and heating load.
- *Encodable constraint:* `great_room.ceiling_height >= 3.6m`. `bedroom.ceiling_height = 2.4m-2.7m`. `bathroom.ceiling_height = 2.4m`. Volume must correlate with room public-ness.

---

## 2. Japanese Spatial Concepts

### Ma (Negative Space)
- *What it is:* Ma (between-ness) is the purposeful use of emptiness -- every void serves a function (visual breathing room, transition, framing). The character combines "gate" and "sun": light shining through an opening.
- *How it prevents waste:* No space is "leftover." Every gap, setback, or void is intentionally designed to serve a spatial, visual, or functional purpose. If a space has no purpose, it should not exist.
- *Encodable constraint:* Every area in the floor plan must be assigned a `purpose` tag (living, sleeping, cooking, bathing, storage, circulation, visual_buffer). `unassigned_area == 0`. Any space > 0.5sqm must have an explicit function.

### Tatami Module (910mm x 1820mm)
- *What it is:* The tatami mat (approximately 3ft x 6ft / 910mm x 1820mm) is the fundamental unit of Japanese spatial design. Rooms are sized as whole multiples of tatami mats, creating a universal grid.
- *How it prevents waste:* When all rooms are integer multiples of the module, walls align perfectly, material cuts are minimized, and no fractional dead zones appear between rooms.
- *Encodable constraint:* All room dimensions must be integer multiples of `module_unit` (600mm for WikiHouse, 1220mm/4ft for imperial). `room.width % module == 0 AND room.length % module == 0`.

### Ken Grid System (1 Ken = 1.82m / ~6ft)
- *What it is:* The structural bay spacing of traditional Japanese architecture. Column centers are placed on a regular Ken grid, and all spatial subdivision happens within this grid.
- *How it prevents waste:* A universal structural grid means every panel, beam, and floor section is identical or from a small set of variants. No custom cuts. Assembly is combinatorial, not bespoke.
- *Encodable constraint:* `structural_bay_spacing` must be a constant (e.g., 1.2m or 2.4m). All load-bearing walls and columns must fall on grid intersections. `wall.position.x % bay_spacing == 0 AND wall.position.y % bay_spacing == 0`.

### Dual-Purpose Spaces (Washitsu Flexibility)
- *What it is:* Traditional Japanese rooms (washitsu) serve multiple functions through the day -- sleeping, eating, working -- by using portable furniture (futons, low tables) rather than fixed layouts.
- *How it prevents waste:* A 6-tatami room (9.9sqm) replaces both a bedroom AND a study. Reduces total room count and overall footprint.
- *Encodable constraint:* At least one room must be tagged `multipurpose` with `area >= 9sqm`. Total unique room count should be minimized: `unique_rooms <= floor_area_sqm / 15`.

---

## 3. Modular Coordination Standards

### ISO 1006 / ISO 2848 Basic Module
- *What it is:* The international standard defines 100mm (metric) or 4 inches (imperial) as the basic module (M) for building coordination. Preferred multimodules are 3M (300mm), 6M (600mm), 12M (1200mm), and 24M (2400mm). These numbers were chosen because 300 and 600 have the most divisors.
- *How it prevents waste:* When all dimensions are multiples of 300mm or 600mm, sheet goods (1200x2400mm plywood) divide perfectly with zero waste. Wall panels, floor cassettes, and roof panels all share dimensional DNA.
- *Encodable constraint:* `ALL dimensions % 300mm == 0` (strict) or `ALL dimensions % 600mm == 0` (structural). No custom intermediate dimensions allowed.

### 4ft (1220mm) Grid vs. 600mm Grid
- *What it is:* The 4ft grid derives from the standard 4x8ft (1220x2440mm) plywood/OSB sheet. The 600mm grid is its metric near-equivalent (half of 1200mm, fitting standard European sheets).
- *How it prevents waste:* A building on a 1200mm grid means every wall panel, floor panel, and roof panel is a whole sheet or exact half-sheet. Cut waste approaches zero. A 4ft grid achieves the same for imperial sheet goods.
- *Encodable constraint:* `planning_grid = 600mm` (metric) or `planning_grid = 1220mm` (imperial). All wall lengths must be `n * grid_unit` where n is a positive integer. Room widths must be `>= 2 * grid_unit`.

### WikiHouse Skylark Grid (600mm)
- *What it is:* WikiHouse Skylark uses a 600x600mm planning grid. Wall blocks are 600mm increments. Heights increase in 300mm increments. All components are CNC-cut from standard 1220x2440mm plywood sheets.
- *How it prevents waste:* The 600mm grid means every plywood sheet yields exactly 2x4 grid units with no waste. The entire building is assembled from a library of ~20 unique panel shapes.
- *Encodable constraint:* `wall_length % 600mm == 0`. `wall_height % 300mm == 0`. `min_solid_wall_run >= 1800mm per 6000mm of wall` (3 continuous blocks per 10 blocks for structural bracing). `max_unique_panel_types <= 25`.

---

## 4. Passive House / Performance Principles

### Form Factor Ratio (HLFF)
- *What it is:* The Heat Loss Form Factor is `envelope_surface_area / treated_floor_area`. A cube has a form factor near 1.0. A spread-out bungalow might be 4.0+. Passive House targets HLFF <= 3.0. Detached homes should aim for <= 0.8 if possible.
- *How it prevents waste:* A lower form factor means less envelope material (insulation, cladding, air barrier) per unit of livable floor area. Halving the form factor halves the insulation needed. Simpler shapes = less material = less cost = less thermal bridging.
- *Encodable constraint:* `envelope_area / floor_area <= 3.0`. For single-story: prefer `perimeter / floor_area` ratio minimization. Penalize L-shapes, T-shapes, and bump-outs. A rectangle scores better than an L with the same floor area.

### Compact Form (Surface-to-Volume Ratio)
- *What it is:* The most energy-efficient shape encloses the maximum volume with minimum surface area. A sphere is ideal; a compact rectangle is the practical optimum.
- *How it prevents waste:* Every corner adds a thermal bridge. A rectangle has 4 corners; an L-shape has 6; a U-shape has 8. Each corner is a material junction, a labor cost, and a thermal weakness.
- *Encodable constraint:* `corner_count <= 4` for the building footprint (prefer simple rectangles). `perimeter^2 / (4 * pi * floor_area) <= 1.3` (compactness index, where 1.0 = circle, 1.27 = square).

### Continuous Insulation Envelope ("Pencil Rule")
- *What it is:* You should be able to trace a continuous line of minimum insulation thickness (200mm for Passive House) around the entire building envelope without any breaks. This is the "pencil test."
- *How it prevents waste:* Eliminates thermal bridges at design level. No complex junction details needed. Simple, continuous insulation = less labor, fewer defects, better performance.
- *Encodable constraint:* The building envelope must be a single continuous polygon with no re-entrant angles sharper than 90 degrees. `min_insulation_thickness >= 200mm` continuous around entire perimeter. No structural members may penetrate the insulation plane.

### Airtightness Through Simplicity
- *What it is:* Airtightness is easier to achieve with fewer joints and penetrations. Every corner, junction, and service penetration is a potential air leak.
- *How it prevents waste:* Simple forms have fewer joints = fewer potential failures = less remedial sealing material and labor.
- *Encodable constraint:* `total_envelope_joints = f(perimeter, corner_count)`. Minimize joint count. Prefer 4-sided footprints. All service penetrations must be grouped into max 2 "service zones."

---

## 5. Kit-of-Parts / WikiHouse Principles

### Standardized Component Library
- *What it is:* The entire building is assembled from a finite set of standardized components (wall blocks, floor cassettes, roof panels, connection details). WikiHouse Skylark uses roughly 20 unique panel shapes.
- *How it prevents waste:* Mass production of identical parts. No custom cuts on site. Every offcut from CNC cutting is predictable and minimized at the nesting stage.
- *Encodable constraint:* `unique_component_types <= 25`. Every wall, floor, and roof element must be selected from a predefined catalog. `custom_components == 0`.

### Orthogonal-Only Plan Forms
- *What it is:* WikiHouse only allows straight walls at 90-degree angles because 3-axis CNC machines cut at 90 degrees. No curves, no angles other than 90.
- *How it prevents waste:* Orthogonal plans mean all panels are rectangular. Nesting on plywood sheets is trivial. No complex geometry = no complex waste patterns.
- *Encodable constraint:* `all_wall_angles ∈ {0, 90, 180, 270} degrees`. No diagonal walls. No curved walls. All rooms must be rectangular.

### Human-Portable Parts
- *What it is:* Every component must be liftable by 2 people (max ~40kg). Parts must be symmetrical or clearly handed to prevent assembly errors.
- *How it prevents waste:* Prevents over-engineering. Parts that are too heavy require cranes and increase cost. Symmetrical parts reduce wrong-way-round errors (material waste from mistakes).
- *Encodable constraint:* `max_panel_weight <= 40kg`. `max_panel_dimension <= 2440mm` (fits through doorways). Prefer symmetrical components; `asymmetric_parts / total_parts <= 0.3`.

### Structural Bracing Rules
- *What it is:* For every 6m of wall length, there must be either one continuous 1.8m solid wall section (3 blocks) or two 1.2m sections (2 blocks each) with no openings.
- *How it prevents waste:* This constraint forces designers to think about structure from the start, preventing designs that require expensive steel beams or custom headers to compensate for too many openings.
- *Encodable constraint:* `For each wall_run: solid_panel_length >= 1.8m per 6.0m` OR `solid_panel_count(1.2m) >= 2 per 6.0m`. Openings (windows, doors) must not exceed 60% of any single wall face.

---

## 6. Neufert's Architects' Data -- Key Dimensional Standards

### Minimum Room Dimensions (Residential)
- *What it is:* Ernst Neufert codified the minimum functional dimensions for every room type based on ergonomic research: furniture clearances, movement paths, and activity zones.
- *How it prevents waste:* Rooms sized to Neufert minimums are neither too small (unusable) nor too large (wasted space). Every square meter has a function.
- *Encodable constraints:*

| Room Type | Min Area | Min Width | Notes |
|-----------|----------|-----------|-------|
| Great Room (open-plan living/kitchen/dining) | 30 sqm | 4.2m | Includes kitchen zone |
| Master Bedroom | 12 sqm | 3.0m | Fits queen bed + circulation |
| Secondary Bedroom | 9 sqm | 2.7m | Fits single/double + desk |
| Bathroom (full) | 5 sqm | 1.8m | Shower/tub + toilet + sink |
| Bathroom (half) | 3 sqm | 1.2m | Toilet + sink only |
| Entry/Mudroom | 3 sqm | 1.5m | Coat storage + shoe removal |
| Utility/Laundry | 4 sqm | 1.5m | Washer + dryer + sink |
| Hallway width | -- | 1.0m min | 1.2m preferred |
| Ceiling height (habitable) | -- | 2.4m min | 2.7m preferred |

### Ergonomic Clearances
- *What it is:* Minimum clear distances between furniture, fixtures, and walls for comfortable use.
- *How it prevents waste:* Prevents oversizing (waste) and undersizing (dysfunctional space that effectively becomes waste).
- *Encodable constraints:*
  - `bed_side_clearance >= 600mm`
  - `kitchen_counter_facing_clearance >= 900mm` (1200mm if two people)
  - `toilet_side_clearance >= 200mm`
  - `door_swing_clearance >= 800mm radius`
  - `stair_width >= 800mm` (900mm preferred)

### Maximum Room Dimensions (Anti-Waste)
- *What it is:* Beyond a certain size, additional room area provides diminishing returns on usability.
- *How it prevents waste:* Caps prevent "McMansion syndrome" where rooms are made large for status rather than function.
- *Encodable constraints:*

| Room Type | Max Area | Rationale |
|-----------|----------|-----------|
| Master Bedroom | 20 sqm | Beyond this, space is unused |
| Secondary Bedroom | 14 sqm | Enough for bed + desk + storage |
| Bathroom (full) | 9 sqm | Spa-scale beyond this |
| Entry | 6 sqm | Transition, not destination |

---

## 7. "Tight Plan" Methodology

### Architects of Reference

**MUJI House (Vertical House, Window House)**
- *What it is:* MUJI's prefab homes achieve extreme efficiency through open plans with zero interior walls, split-level zoning (using floor height changes instead of walls to define rooms), and central staircase cores. The Vertical House fits 6 distinct living zones into a 3-story footprint with no doors or partitions.
- *How it prevents waste:* Wall elimination. Floor-level changes define zones without material-consuming walls. Central stair doubles as structural core AND spatial divider.
- *Encodable constraint:* In open-plan zones: `partition_wall_length / zone_perimeter <= 0.2`. Where possible, use `floor_level_change >= 300mm` as zone boundary instead of walls.

**Go Hasegawa**
- *What it is:* Known for residences where the ground-level social space is completely open (sometimes literally to the outdoors), and private spaces are lofted above. A single shared volume does triple duty: living, dining, and circulation.
- *How it prevents waste:* Vertical stacking of private over public. The shared volume has zero dedicated circulation -- movement paths cross the living space.
- *Encodable constraint:* `private_rooms.floor_level > public_rooms.floor_level` (for multi-story). `shared_space_area >= 0.4 * total_floor_area`.

**Suppose Design Office**
- *What it is:* Masters of the "one-room house" concept where the entire ground floor is a single undivided volume, with sleeping/private areas as lofted platforms or mezzanines. Sliding doors and level changes create zones within a single structural volume.
- *How it prevents waste:* One structural volume = one roof, one foundation, minimum perimeter. Interior subdivision is non-structural (sliding panels, curtains, level changes).
- *Encodable constraint:* `structural_volumes <= 2`. Non-structural partitions should be `moveable OR removable`. `fixed_interior_walls / total_interior_wall_length <= 0.4`.

### Tight Plan Rules (Synthesis)

These architects share common principles that can be extracted as universal constraints:

**Rule: Circulation is Living**
- Dedicated circulation (hallways, corridors) must be minimized by making living spaces serve as circulation.
- *Constraint:* `dedicated_circulation_area / total_floor_area <= 0.05` (5% maximum). For open-plan homes under 150sqm, target 0% dedicated hallways.

**Rule: Every Wall Works Twice**
- Every interior wall should serve at least two purposes: spatial division + structural support, or spatial division + storage, or spatial division + services (plumbing/electrical).
- *Constraint:* `single_purpose_walls / total_walls <= 0.2`. Prefer walls that contain storage, services, or structural function.

**Rule: Shared Walls Between Rooms**
- No room should be an island. Every room must share at least one full wall with another room (no gaps, no corridors between rooms).
- *Constraint:* `every room.shared_wall_count >= 1`. `isolated_rooms == 0`. Adjacent rooms must share a wall directly (not separated by a corridor).

**Rule: Wet Core Clustering**
- All plumbing fixtures (kitchen, bathroom, laundry) should be clustered on shared wet walls to minimize pipe runs.
- *Constraint:* `max_distance_between_wet_rooms <= 3.0m`. All plumbing walls should be within `2 * grid_unit` of a single "wet core" zone. `plumbing_wall_count <= 3`.

**Rule: Service Spine**
- All MEP (mechanical, electrical, plumbing) services should run along a single spine or core, not scattered throughout the plan.
- *Constraint:* `service_penetration_zones <= 2`. Electrical panel, water heater, and HVAC unit must be within `4.0m` of each other.

---

## Composite Constraints for Parametric Generator

These are the highest-priority constraints that combine multiple traditions into a single rule set:

### Grid & Module
```
GRID_UNIT = 600mm  # WikiHouse Skylark compatible
STRUCTURAL_BAY = 2400mm  # 4 grid units = standard plywood width
ALL room.width % GRID_UNIT == 0
ALL room.length % GRID_UNIT == 0
ALL wall.position % GRID_UNIT == 0
```

### Form & Envelope
```
building.footprint.corner_count <= 6  # Rectangle or simple L max
building.depth <= 7200mm  # Wings of light (12 grid units)
building.form_factor <= 3.0  # Passive House compatible
building.compactness_index <= 1.4  # Near-square footprint preferred
```

### Plan Efficiency
```
dedicated_circulation / total_area <= 0.05  # 5% max hallways
great_room.area >= 0.30 * total_area  # Common areas at the heart
great_room.adjacency >= 0.60 * room_count  # Flow-through circulation
unassigned_area == 0  # Ma: every space has purpose
```

### Room Sizing
```
FOR room IN rooms:
    room.area >= NEUFERT_MIN[room.type]
    room.area <= NEUFERT_MAX[room.type]
    room.width >= NEUFERT_MIN_WIDTH[room.type]
    room.width % GRID_UNIT == 0
    room.length % GRID_UNIT == 0
    room.shared_wall_count >= 1
```

### Structural Integrity
```
FOR wall IN exterior_walls:
    wall.solid_run >= 1800mm PER 6000mm  # Bracing requirement
    wall.opening_ratio <= 0.60  # Max 60% windows/doors
unique_panel_types <= 25  # Kit-of-parts limit
custom_panels == 0
```

### Thermal Performance
```
insulation.continuous == True  # Pencil rule
envelope.corners <= 6
thermal_bridge_count == envelope.corners  # Only at corners
service_penetration_zones <= 2
```

### Wet Core & Services
```
plumbing_wall_count <= 3
max_distance_between_wet_rooms <= 3000mm
service_core.count == 1
kitchen_zone WITHIN great_room  # Farmhouse kitchen
```

### Privacy & Zoning
```
FOR path IN paths(entrance, room):
    privacy_levels(path) == monotonically_non_decreasing
bedroom.exterior_wall_count >= 2  # Light on two sides
bedroom.privacy_level >= 4
great_room.privacy_level <= 2
```

---

## Summary: The Seven Traditions Unified

| Tradition | Core Insight | Primary Constraint |
|-----------|-------------|-------------------|
| Alexander | Compress all patterns together; circulation through rooms | `circulation <= 5%` |
| Japanese Spatial | Every space has purpose; modular grid eliminates waste | `unassigned_area == 0` |
| ISO/Modular | Standard module = zero-cut-waste sheet goods | `dimensions % 600mm == 0` |
| Passive House | Compact form = less envelope per floor area | `form_factor <= 3.0` |
| Kit-of-Parts | Finite component library; orthogonal only | `unique_panels <= 25` |
| Neufert | Right-sized rooms: not too big, not too small | `min <= room.area <= max` |
| Tight Plan | One great room IS the circulation; walls work twice | `great_room >= 30% of plan` |

---

## Sources

- [Christopher Alexander - A Pattern Language (Cornell PDF)](https://arl.human.cornell.edu/linked%20docs/Alexander_A_Pattern_Language.pdf)
- [A Pattern Language - Complete Pattern List](https://claytondorge.com/patterns-list)
- [Pattern 116: Cascade of Roofs](https://www.iwritewordsgood.com/apl/patterns/apl116.htm)
- [Pattern 159: Light on Two Sides](https://www.patternlanguage.com/apl/aplsample/apl159/apl159.htm)
- [Ken (unit) - Wikipedia](https://en.wikipedia.org/wiki/Ken_(unit))
- [Tatami - Wikipedia](https://en.wikipedia.org/wiki/Tatami)
- [The Ken System - Mysteries of the Carpenter](https://mysteriesofthecarpenter.ca/2023/09/11/the-ken-system/)
- [Ma: Place, Space, Void - Kyoto Journal](https://kyotojournal.org/culture-arts/ma-place-space-void/)
- [Japan House LA - Concept of Ma](https://www.japanhousela.com/articles/a-perspective-on-the-japanese-concept-of-ma/)
- [ISO 1006:1983 Basic Module](https://www.iso.org/standard/5470.html)
- [ISO 2848 - Wikipedia](https://en.wikipedia.org/wiki/ISO_2848)
- [Modular Coordination Presentation](https://www.slideshare.net/slideshow/modular-coordination-191257244/191257244)
- [Passive House Form Factor - Elrond Burrell](https://elrondburrell.com/blog/passivhaus-heatloss-formfactor/)
- [Form Factor - AC Architects](https://acarchitects.biz/self-build-blog/form-factor-eco-cat)
- [Compactness Ratio - Emu Passive](https://emupassive.com/2015/10/26/the-compactness-ratio-of-a-building/)
- [How to Calculate Form Factor - Heat Space Light](https://www.heatspaceandlight.com/work-out-passive-house-form-factor/)
- [Thermal Bridge Free Design - Passipedia](https://passipedia.org/basics/building_physics_-_basics/what_defines_thermal_bridge_free_design)
- [Form Factor Energy Reduction - Modelur](https://modelur.com/use-form-factor-to-reduce-energy-consumption-of-buildings/)
- [Passive House Shape - e-genius](https://www.e-genius.at/fileadmin/user_upload/lernfelder/energieeffiziente_gebaeudekonzepte/alt/en/web/what_shape_is_particularly_advantageous_for_a_passive_house.html)
- [WikiHouse Design Guide](https://www.wikihouse.cc/design/designing-for-wikihouse)
- [WikiHouse Structure](https://www.wikihouse.cc/design/how-the-structure-works)
- [WikiHouse Skylark Technical Spec (PDF)](https://cdn.prod.website-files.com/6118e2d27c92cc41c39747a0/6734731aafda7cecf84adcfe_WikiHouse%20Skylark%20Technical%20Specification%202025.pdf)
- [WikiHouse Manufacturing Guide](https://www.wikihouse.cc/guides/manufacturing)
- [Skylark 250 Blocks](https://www.wikihouse.cc/blocks/skylark-250)
- [Neufert Architects' Data - Bookey Summary](https://www.bookey.app/book/neufert-architects'-data,-third-edition)
- [Neufert 4th Ed - Residential (Scribd)](https://www.scribd.com/document/711732643/Neufert-4th-edition-RESIDENTIAL)
- [Neufert 4th Ed - Accommodation (Scribd)](https://www.scribd.com/document/711682919/Neufert-4th-edition-ACCOMMODATION)
- [MUJI Prefab Vertical House - ArchDaily](https://www.archdaily.com/561333/design-your-own-home-with-muji-s-prefab-vertical-house)
- [MUJI House Models - JapanANDdesign](https://japananddesign.com/muji-house-2/)
- [Go Hasegawa x MUJI - Designboom](https://www.designboom.com/architecture/muji-china-house-vision-beijing-go-hasegawa-10-03-2018/)
- [Suppose Design Office - House in Nagoya](https://www.archdaily.com/29134/house-in-nagoya-01-suppose-design-office)
- [GSA Circulation Planning Guide](https://www.gsa.gov/cdnstatic/Circulation_-_Defining_and_Planning_(May_2012).pdf)
- [Building Advisor - Circulation](https://buildingadvisor.com/design/floor-plans/circulation-key-to-a-successful-floor-plan/)
- [Generative Floor Plan Review](https://www.tandfonline.com/doi/full/10.1080/13467581.2025.2512235)
- [Floor Plan Generation - Mixed Constraint Programming](https://www.sciencedirect.com/science/article/abs/pii/S0926580520310712)
- [Heavy Mass Pattern Book](https://heavymass.com)
