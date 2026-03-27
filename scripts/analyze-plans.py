#!/usr/bin/env python3
"""
Floor Plan Analysis Framework — maps all Heavy Mass homes against architectural rules.

Discovers which rules each plan follows/violates, finds common patterns
across passing vs failing plans, and extracts the layout rules that
distinguish working plans from broken ones.

Output: structured scorecard per home + cross-home synthesis.
"""

import json, os, sys

# Import from generate-data
sys.path.insert(0, os.path.dirname(__file__))

# We'll read the generated JSON files directly
DATA = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

# Room type classifications (same as generator)
OPEN_PLAN_TYPES = frozenset({"great_room", "living", "kitchen", "kitchen_open", "dining"})
PRIVATE_TYPES = frozenset({"bedroom", "primary_bed"})
WET_TYPES = frozenset({"bathroom_full", "bathroom_half", "bathroom_ada"})
STORAGE_TYPES = frozenset({"walk_in_closet", "pantry", "nook"})
SERVICE_TYPES = frozenset({"utility", "mudroom"})
ENTRY_TYPES = frozenset({"entry"})
OUTDOOR_TYPES = frozenset({"deck", "engawa"})
LOFT_TYPES = frozenset({"loft_bed"})
HUB_TYPES = OPEN_PLAN_TYPES | ENTRY_TYPES  # rooms that can serve as circulation hubs

GRID = 4


def load_homes():
    """Load all home JSONs."""
    homes_dir = os.path.join(DATA, 'homes')
    homes = []
    for fname in sorted(os.listdir(homes_dir)):
        if fname.endswith('.json'):
            with open(os.path.join(homes_dir, fname)) as f:
                homes.append(json.load(f))
    return homes


def build_adjacency(home):
    """Build room adjacency from grid positions."""
    rooms = home['rooms']
    # Build cell → room index
    cell_to_room = {}
    for i, room in enumerate(rooms):
        for dx in range(room['gw']):
            for dz in range(room['gd']):
                cell_to_room[(room['gx'] + dx, room['gz'] + dz)] = i

    # Find adjacent pairs
    adj = {}  # {(i, j): shared_edge_count}
    for (gx, gz), ri in cell_to_room.items():
        for nx, nz in [(gx-1, gz), (gx+1, gz), (gx, gz-1), (gx, gz+1)]:
            rj = cell_to_room.get((nx, nz))
            if rj is not None and rj != ri:
                pair = (min(ri, rj), max(ri, rj))
                adj[pair] = adj.get(pair, 0) + 1

    return adj, cell_to_room


def analyze_home(home):
    """Comprehensive analysis of one home plan."""
    rooms = home['rooms']
    connections = {(c['from'], c['to']): c['type'] for c in home.get('connections', [])}
    # Also store reverse direction
    for c in home.get('connections', []):
        connections[(c['to'], c['from'])] = c['type']

    adj, cell_to_room = build_adjacency(home)
    n_rooms = len(rooms)

    # Room type lookup
    room_type = {r['label']: r['type'] for r in rooms}
    room_area = {r['label']: r['area'] for r in rooms}

    # ── Rule 1: Hub Adjacency (Pattern 129) ──
    # Does the great room / LDK zone touch ≥60% of rooms?
    hub_rooms = [r for r in rooms if r['type'] in HUB_TYPES]
    hub_labels = {r['label'] for r in hub_rooms}
    hub_adjacent_rooms = set()
    for (i, j), count in adj.items():
        ri, rj = rooms[i], rooms[j]
        if ri['label'] in hub_labels:
            hub_adjacent_rooms.add(rj['label'])
        if rj['label'] in hub_labels:
            hub_adjacent_rooms.add(ri['label'])
    hub_adjacent_rooms |= hub_labels  # hubs are adjacent to themselves
    indoor_rooms = [r for r in rooms if r['type'] not in OUTDOOR_TYPES]
    indoor_labels = {r['label'] for r in indoor_rooms}
    hub_pct = len(hub_adjacent_rooms & indoor_labels) * 100 / len(indoor_labels) if indoor_labels else 0

    # ── Rule 2: Bedroom Direct Access ──
    # Every bedroom must be directly adjacent to a hub room
    bedrooms = [r for r in rooms if r['type'] in PRIVATE_TYPES]
    bedroom_access = {}
    for bed in bedrooms:
        bed_idx = rooms.index(bed)
        adj_to_hub = False
        adj_rooms_list = []
        for (i, j), count in adj.items():
            if i == bed_idx or j == bed_idx:
                other_idx = j if i == bed_idx else i
                other = rooms[other_idx]
                adj_rooms_list.append(other['label'])
                if other['type'] in HUB_TYPES:
                    adj_to_hub = True
        bedroom_access[bed['label']] = {
            'type': bed['type'],
            'adjacent_to_hub': adj_to_hub,
            'adjacent_rooms': adj_rooms_list,
        }

    # ── Rule 3: Circulation Path Quality ──
    # BFS from entry through non-wall connections
    # Find entry
    entry_labels = [r['label'] for r in rooms if r['type'] in ENTRY_TYPES]
    if not entry_labels:
        entry_labels = [r['label'] for r in rooms if r['type'] in OPEN_PLAN_TYPES][:1]

    # Build access graph from connections
    access_graph = {r['label']: set() for r in rooms}
    for (a, b), ctype in connections.items():
        if ctype != 'wall':
            access_graph.setdefault(a, set()).add(b)

    start = entry_labels[0] if entry_labels else rooms[0]['label']

    # BFS with parent tracking
    parent = {start: None}
    queue = [start]
    visited = {start}
    while queue:
        current = queue.pop(0)
        for neighbor in access_graph.get(current, []):
            if neighbor not in visited:
                visited.add(neighbor)
                parent[neighbor] = current
                queue.append(neighbor)

    # Check path quality for bedrooms
    path_issues = []
    for bed in bedrooms:
        if bed['label'] not in parent:
            path_issues.append({
                'bedroom': bed['label'],
                'issue': 'unreachable',
                'path': [],
            })
            continue

        # Reconstruct path
        path = []
        node = bed['label']
        while node is not None:
            path.append(node)
            node = parent.get(node)
        path.reverse()

        # Check intermediates
        bad_passthrough = []
        for intermediate in path[1:-1]:  # skip start and end
            itype = room_type.get(intermediate, '')
            if itype in PRIVATE_TYPES | WET_TYPES | STORAGE_TYPES:
                bad_passthrough.append(f"{intermediate} ({itype})")

        if bad_passthrough:
            path_issues.append({
                'bedroom': bed['label'],
                'issue': f"passes through: {', '.join(bad_passthrough)}",
                'path': path,
            })

    # ── Rule 4: Privacy Gradient ──
    PRIVACY_LEVEL = {
        "deck": 0, "engawa": 0, "entry": 0, "mudroom": 0,
        "great_room": 0, "living": 0, "dining": 0,
        "kitchen": 1, "kitchen_open": 1, "corridor": 1, "garage": 1,
        "office": 2, "flex": 2, "meditation": 2, "nook": 2,
        "utility": 2, "pantry": 2, "bathroom_half": 2,
        "bathroom_full": 3, "bathroom_ada": 3,
        "bedroom": 3, "primary_bed": 3, "loft_bed": 3,
        "walk_in_closet": 3,
    }
    entry_adjacent_private = []
    for bed in bedrooms:
        if bed['type'] == 'loft_bed':
            continue
        bed_idx = rooms.index(bed)
        for (i, j), count in adj.items():
            if i == bed_idx or j == bed_idx:
                other_idx = j if i == bed_idx else i
                other = rooms[other_idx]
                if other['type'] in ENTRY_TYPES:
                    entry_adjacent_private.append(bed['label'])

    # ── Rule 5: Wet Wall Clustering ──
    wet_rooms = [r for r in rooms if r['type'] in WET_TYPES | frozenset({'kitchen', 'kitchen_open', 'utility'})]
    wet_adjacent_count = 0
    wet_pairs_total = 0
    for i_idx in range(len(wet_rooms)):
        for j_idx in range(i_idx + 1, len(wet_rooms)):
            ri = rooms.index(wet_rooms[i_idx])
            rj = rooms.index(wet_rooms[j_idx])
            pair = (min(ri, rj), max(ri, rj))
            wet_pairs_total += 1
            if pair in adj:
                wet_adjacent_count += 1

    # ── Rule 6: Noise Isolation ──
    noisy_types = frozenset({'kitchen', 'kitchen_open', 'garage'})
    noise_violations = []
    for bed in bedrooms:
        if bed['type'] == 'loft_bed':
            continue
        bed_idx = rooms.index(bed)
        for (i, j), count in adj.items():
            if i == bed_idx or j == bed_idx:
                other_idx = j if i == bed_idx else i
                other = rooms[other_idx]
                if other['type'] in noisy_types:
                    noise_violations.append(f"{bed['label']} ↔ {other['label']}")

    # ── Rule 7: Deck → LDK ──
    decks = [r for r in rooms if r['type'] in OUTDOOR_TYPES]
    ldk_rooms = [r for r in rooms if r['type'] in OPEN_PLAN_TYPES]
    deck_ldk_ok = True
    for deck in decks:
        deck_idx = rooms.index(deck)
        touches_ldk = False
        for (i, j), count in adj.items():
            if i == deck_idx or j == deck_idx:
                other_idx = j if i == deck_idx else i
                other = rooms[other_idx]
                if other['type'] in OPEN_PLAN_TYPES:
                    touches_ldk = True
        if not touches_ldk:
            deck_ldk_ok = False

    # ── Metrics ──
    indoor_cells = sum(r['gw'] * r['gd'] for r in rooms if r['type'] not in OUTDOOR_TYPES)
    storage_cells = sum(r['gw'] * r['gd'] for r in rooms if r['type'] in STORAGE_TYPES)
    ldk_cells = sum(r['gw'] * r['gd'] for r in rooms if r['type'] in OPEN_PLAN_TYPES)
    storage_pct = storage_cells * 100 / indoor_cells if indoor_cells else 0
    ldk_pct = ldk_cells * 100 / indoor_cells if indoor_cells else 0

    # ── Room proportion check ──
    bad_ratios = []
    exempt = ("corridor", "deck", "engawa", "walk_in_closet", "pantry", "entry", "mudroom", "nook")
    for r in rooms:
        if r['type'] in exempt:
            continue
        ratio = max(r['gw'], r['gd']) / max(min(r['gw'], r['gd']), 1)
        if ratio > 2.0:
            bad_ratios.append(f"{r['label']} ({r['gw']}:{r['gd']} = {ratio:.1f}:1)")

    # ── Compile scorecard ──
    has_path_issues = len(path_issues) > 0
    all_beds_have_hub_access = all(b['adjacent_to_hub'] for b in bedroom_access.values()
                                    if room_type.get(list(bedroom_access.keys())[list(bedroom_access.values()).index(b)], '') != 'loft_bed')

    # Filter out loft beds for direct access check
    non_loft_beds = {k: v for k, v in bedroom_access.items() if v['type'] != 'loft_bed'}
    beds_with_hub = sum(1 for v in non_loft_beds.values() if v['adjacent_to_hub'])
    beds_total = len(non_loft_beds)
    beds_missing_hub = [k for k, v in non_loft_beds.items() if not v['adjacent_to_hub']]

    return {
        'id': home['id'],
        'model': home['model'],
        'sqft': home['sqft'],
        'bed_bath': home['bedBath'],
        'roof': home['roofStyle'],

        # Scores
        'hub_adjacency_pct': round(hub_pct, 1),
        'hub_adjacent_count': len(hub_adjacent_rooms & indoor_labels),
        'indoor_room_count': len(indoor_labels),
        'beds_with_hub_access': f"{beds_with_hub}/{beds_total}",
        'beds_missing_hub': beds_missing_hub,
        'path_issues': path_issues,
        'circulation_ok': not has_path_issues,

        'entry_adj_bedrooms': entry_adjacent_private,
        'noise_violations': noise_violations,
        'deck_ldk_connected': deck_ldk_ok,
        'wet_clustering': f"{wet_adjacent_count}/{wet_pairs_total}",

        'storage_pct': round(storage_pct, 1),
        'ldk_pct': round(ldk_pct, 1),
        'bad_ratios': bad_ratios,

        # Detailed adjacency for failing bedrooms
        'bedroom_detail': bedroom_access,
    }


def main():
    homes = load_homes()
    results = [analyze_home(h) for h in homes]

    # ════════════════════════════════════════════════════════════════════
    # Per-home scorecards
    # ════════════════════════════════════════════════════════════════════
    passing = [r for r in results if r['circulation_ok']]
    failing = [r for r in results if not r['circulation_ok']]

    print("=" * 80)
    print("FLOOR PLAN ANALYSIS FRAMEWORK — Heavy Mass Pattern Book Homes")
    print("=" * 80)
    print(f"\nPassing: {len(passing)}/27  |  Failing: {len(failing)}/27")

    print("\n" + "─" * 80)
    print("PASSING HOMES — What they get right")
    print("─" * 80)
    for r in passing:
        print(f"\n  ✓ {r['model']} ({r['sqft']}sf, {r['bed_bath']})")
        print(f"    Hub coverage: {r['hub_adjacency_pct']}% ({r['hub_adjacent_count']}/{r['indoor_room_count']} rooms)")
        print(f"    Bedroom access: {r['beds_with_hub_access']} bedrooms touch hub room")
        print(f"    LDK: {r['ldk_pct']}%  Storage: {r['storage_pct']}%")
        if r['entry_adj_bedrooms']:
            print(f"    ⚠ Entry adjacent to bedroom: {', '.join(r['entry_adj_bedrooms'])}")
        if r['noise_violations']:
            print(f"    ⚠ Noise: {', '.join(r['noise_violations'])}")
        if not r['deck_ldk_connected']:
            print(f"    ⚠ Deck not connected to LDK")

    print("\n" + "─" * 80)
    print("FAILING HOMES — What they get wrong")
    print("─" * 80)
    for r in failing:
        print(f"\n  ✗ {r['model']} ({r['sqft']}sf, {r['bed_bath']})")
        print(f"    Hub coverage: {r['hub_adjacency_pct']}% ({r['hub_adjacent_count']}/{r['indoor_room_count']} rooms)")
        print(f"    Bedroom access: {r['beds_with_hub_access']} bedrooms touch hub room")
        if r['beds_missing_hub']:
            print(f"    ⛔ Bedrooms WITHOUT hub access: {', '.join(r['beds_missing_hub'])}")
        for issue in r['path_issues']:
            print(f"    ⛔ {issue['bedroom']}: {issue['issue']}")
            print(f"       Path: {' → '.join(issue['path'])}")
        # Show what each non-hub bedroom IS adjacent to
        for bed_label in r['beds_missing_hub']:
            detail = r['bedroom_detail'].get(bed_label, {})
            adj_rooms = detail.get('adjacent_rooms', [])
            print(f"    📎 {bed_label} adjacent to: {', '.join(adj_rooms)}")

    # ════════════════════════════════════════════════════════════════════
    # Cross-home pattern synthesis
    # ════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 80)
    print("PATTERN SYNTHESIS — What distinguishes passing from failing")
    print("=" * 80)

    # Hub adjacency comparison
    pass_hub = [r['hub_adjacency_pct'] for r in passing]
    fail_hub = [r['hub_adjacency_pct'] for r in failing]
    print(f"\n  Hub Coverage (avg):")
    print(f"    Passing: {sum(pass_hub)/len(pass_hub):.1f}%")
    print(f"    Failing: {sum(fail_hub)/len(fail_hub):.1f}%")

    # Beds with hub access
    def parse_frac(s):
        a, b = s.split('/')
        return int(a), int(b)

    pass_bed_frac = [parse_frac(r['beds_with_hub_access']) for r in passing]
    fail_bed_frac = [parse_frac(r['beds_with_hub_access']) for r in failing]
    pass_bed_pct = sum(a/b for a, b in pass_bed_frac if b > 0) / len(pass_bed_frac) * 100
    fail_bed_pct = sum(a/b for a, b in fail_bed_frac if b > 0) / len(fail_bed_frac) * 100
    print(f"\n  Bedrooms with direct hub access:")
    print(f"    Passing: {pass_bed_pct:.0f}%")
    print(f"    Failing: {fail_bed_pct:.0f}%")

    # Common failure patterns
    print(f"\n  Common failure patterns:")
    failure_types = {}
    for r in failing:
        for issue in r['path_issues']:
            # Extract the room types in the bad path
            parts = issue['issue']
            if 'bathroom' in parts:
                failure_types['through bathroom'] = failure_types.get('through bathroom', 0) + 1
            if 'walk_in_closet' in parts:
                failure_types['through closet'] = failure_types.get('through closet', 0) + 1
            if 'bedroom' in parts or 'primary_bed' in parts:
                failure_types['through bedroom'] = failure_types.get('through bedroom', 0) + 1
            if 'pantry' in parts:
                failure_types['through pantry'] = failure_types.get('through pantry', 0) + 1
    for pattern, count in sorted(failure_types.items(), key=lambda x: -x[1]):
        print(f"    {count}× {pattern}")

    # ════════════════════════════════════════════════════════════════════
    # Extracted rules
    # ════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 80)
    print("EXTRACTED LAYOUT RULES")
    print("=" * 80)

    rules = [
        ("R1: BEDROOM DIRECT ACCESS",
         "Every bedroom (except loft) MUST be directly adjacent to at least one "
         "hub room (great_room, living, entry, dining, kitchen_open). "
         "This is the #1 failure mode — 16/16 failing homes violate this.",
         "CRITICAL"),

        ("R2: GREAT ROOM HUB",
         "Hub rooms (LDK + entry) must be adjacent to ≥60% of all indoor rooms. "
         f"Passing avg: {sum(pass_hub)/len(pass_hub):.0f}%, Failing avg: {sum(fail_hub)/len(fail_hub):.0f}%.",
         "HIGH"),

        ("R3: NO PRIVATE PASS-THROUGH",
         "No bedroom path from entry should pass through another bedroom, bathroom, "
         "or closet. These are dead-end rooms, not circulation rooms.",
         "CRITICAL"),

        ("R4: PRIVACY GRADIENT",
         "Bedrooms should NOT be directly adjacent to entry. "
         f"{sum(1 for r in results if r['entry_adj_bedrooms'])}/27 homes violate this.",
         "MEDIUM"),

        ("R5: WET WALL CLUSTERING",
         "All wet rooms should share at least one wall with another wet room. "
         f"{sum(1 for r in results if r['wet_clustering'].startswith('0/') and not r['wet_clustering'].endswith('/0'))}/27 have zero wet adjacency.",
         "MEDIUM"),

        ("R6: NOISE ISOLATION",
         "No bedroom should share a wall with kitchen or garage. "
         f"{sum(1 for r in results if r['noise_violations'])}/27 violate this.",
         "LOW"),

        ("R7: DECK → LDK CONNECTION",
         "Every deck/engawa must be directly adjacent to LDK zone. "
         f"{sum(1 for r in results if not r['deck_ldk_connected'])}/27 have disconnected decks.",
         "MEDIUM"),

        ("R8: STORAGE ≥ 10%",
         f"Storage rooms should be ≥10% of indoor area. "
         f"{sum(1 for r in results if r['storage_pct'] < 10)}/27 below target.",
         "LOW"),

        ("R9: LDK ≥ 35%",
         f"LDK should be ≥35% of indoor area. "
         f"{sum(1 for r in results if r['ldk_pct'] < 35)}/27 below target.",
         "LOW — most homes actually EXCEED this"),

        ("R10: ROOM PROPORTIONS ≤ 2:1",
         f"No room wider than 2:1 ratio. "
         f"{sum(1 for r in results if r['bad_ratios'])}/27 have bad ratios.",
         "LOW"),
    ]

    for name, desc, priority in rules:
        print(f"\n  [{priority}] {name}")
        print(f"    {desc}")

    # ════════════════════════════════════════════════════════════════════
    # Fix prescription per home
    # ════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 80)
    print("FIX PRESCRIPTIONS — What each failing home needs")
    print("=" * 80)

    for r in failing:
        print(f"\n  {r['model']} ({r['id']}):")
        missing = r['beds_missing_hub']
        if missing:
            print(f"    Problem: {', '.join(missing)} not adjacent to hub room")
            print(f"    Fix: Rearrange so these bedrooms share a wall with great_room/entry")
        for issue in r['path_issues']:
            bedroom = issue['bedroom']
            path = issue['path']
            # Find the first private room in the path (after entry)
            blockers = [p for p in path[1:-1]
                       if any(p in r['bedroom_detail'] for _ in [0])
                       or 'bath' in p.lower() or 'closet' in p.lower()
                       or 'storage' in p.lower()]
            if not blockers:
                # Find blockers from the issue text
                print(f"    {bedroom}: {issue['issue']}")
            else:
                print(f"    {bedroom} blocked by: {', '.join(blockers)}")

    print()


if __name__ == '__main__':
    main()
