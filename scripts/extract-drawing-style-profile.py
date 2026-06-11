#!/usr/bin/env python3
"""Extract a reusable drawing_style_profile_v1 sidecar for paired floorplans.

The extractor is intentionally narrow: it measures visual drawing rules from the
GPT proposal image and the deterministic SVG, then writes a sidecar profile that
the React renderer can consume. It does not move or repair semantic geometry.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "public/data/den-image-loop/proposal-manifest.json"


def luminance(pixel: tuple[int, ...]) -> float:
    r, g, b = pixel[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hex_color(pixel: tuple[int, ...]) -> str:
    r, g, b = pixel[:3]
    return f"#{r:02x}{g:02x}{b:02x}"


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    clean = value.lstrip("#")
    if len(clean) != 6:
        return 160, 158, 152
    return int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16)


def blend_hex(a: str, b: str, t: float) -> str:
    ar, ag, ab = _hex_to_rgb(a)
    br, bg, bb = _hex_to_rgb(b)
    clamped = max(0.0, min(1.0, t))
    return hex_color((
        round(ar + (br - ar) * clamped),
        round(ag + (bg - ag) * clamped),
        round(ab + (bb - ab) * clamped),
    ))


def run_lengths(mask: list[list[bool]], horizontal: bool) -> list[int]:
    lengths: list[int] = []
    outer = len(mask) if horizontal else len(mask[0])
    inner = len(mask[0]) if horizontal else len(mask)
    for a in range(outer):
        run = 0
        for b in range(inner):
            value = mask[a][b] if horizontal else mask[b][a]
            if value:
                run += 1
            elif run:
                lengths.append(run)
                run = 0
        if run:
            lengths.append(run)
    return lengths


def robust_stroke_width(lengths: list[int], lo: int, hi: int, default: float) -> float:
    candidates = [item for item in lengths if lo <= item <= hi]
    if not candidates:
        return default
    counts = Counter(candidates)
    most_common = counts.most_common(5)
    weighted = []
    for value, count in most_common:
        weighted.extend([value] * count)
    return float(median(weighted or candidates))


def analyze_source_png(path: Path) -> dict[str, Any]:
    image = Image.open(path).convert("RGB")
    max_side = 900
    if max(image.size) > max_side:
        scale = max_side / max(image.size)
        image = image.resize((round(image.width * scale), round(image.height * scale)))
    pixels = image.load()
    dark_samples: list[tuple[int, int, int]] = []
    mid_samples: list[tuple[int, int, int]] = []
    accent_samples: list[tuple[int, int, int]] = []
    dark_mask: list[list[bool]] = []
    mid_mask: list[list[bool]] = []
    for y in range(image.height):
        dark_row: list[bool] = []
        mid_row: list[bool] = []
        for x in range(image.width):
            pixel = pixels[x, y]
            lum = luminance(pixel)
            dark = lum < 95
            mid = 95 <= lum < 190
            dark_row.append(dark)
            mid_row.append(mid)
            if dark:
                dark_samples.append(pixel)
            elif mid:
                mid_samples.append(pixel)
            r, g, b = pixel
            saturation = max(pixel) - min(pixel)
            if saturation > 35 and 60 < max(pixel) < 235 and min(pixel) > 35:
                # Callout bubbles are the dominant saturated, mid-value color in
                # the proposal. Windows/glazing are thinner and lose to this
                # mode on these Den reference plans.
                accent_samples.append(pixel)
        dark_mask.append(dark_row)
        mid_mask.append(mid_row)

    dark_runs = run_lengths(dark_mask, True) + run_lengths(dark_mask, False)
    mid_runs = run_lengths(mid_mask, True) + run_lengths(mid_mask, False)
    dark_color = hex_color(tuple(round(median(channel)) for channel in zip(*dark_samples))) if dark_samples else "#2f2f2d"
    mid_color = hex_color(tuple(round(median(channel)) for channel in zip(*mid_samples))) if mid_samples else "#9f9c96"
    accent_color = "#b86e63"
    if accent_samples:
        buckets = Counter((round(r / 10) * 10, round(g / 10) * 10, round(b / 10) * 10) for r, g, b in accent_samples)
        accent_color = hex_color(buckets.most_common(1)[0][0])
    return {
        "pixelWidth": image.width,
        "pixelHeight": image.height,
        "darkPixelRatio": len(dark_samples) / max(1, image.width * image.height),
        "midPixelRatio": len(mid_samples) / max(1, image.width * image.height),
        "darkMedianColor": dark_color,
        "midMedianColor": mid_color,
        "accentColor": accent_color,
        "darkRunStrokePx": robust_stroke_width(dark_runs, 1, 14, 2.0),
        "midRunStrokePx": robust_stroke_width(mid_runs, 3, 18, 8.0),
    }


def svg_scale(svg: str) -> float:
    match = re.search(r"scale\(([0-9.]+)(?:[ ,]+([0-9.]+))?\)", svg)
    if not match:
        return 1.0
    sx = float(match.group(1))
    sy = float(match.group(2) or sx)
    return (sx + sy) / 2


def css_width(svg: str, role: str, fallback: float) -> float:
    style_match = re.search(r"<style>(.*?)</style>", svg, flags=re.S)
    if style_match:
        style = style_match.group(1)
        role_pos = style.find(f'data-role="{role}"')
        if role_pos >= 0:
            local = style[max(0, role_pos - 300): role_pos + 900]
            match = re.search(r"stroke-width:\s*([0-9.]+)\s*px", local)
            if match:
                return float(match.group(1))
    pattern = rf'data-role="{re.escape(role)}"[^>]*?stroke-width="([0-9.]+)"'
    match = re.search(pattern, svg)
    return float(match.group(1)) * svg_scale(svg) if match else fallback


def analyze_svg(path: Path) -> dict[str, Any]:
    svg = path.read_text()
    roles = Counter(re.findall(r'data-role="([^"]+)"', svg))
    return {
        "roleCounts": dict(sorted(roles.items())),
        "exteriorWallStrokeWidthPx": css_width(svg, "exterior-wall", 7.0),
        "interiorWallStrokeWidthPx": css_width(svg, "interior-wall", 4.0),
        "doorStrokeWidthPx": css_width(svg, "door", 2.0),
        "windowStrokeWidthPx": css_width(svg, "window", 2.0),
        "hasDoorRole": roles.get("door", 0) > 0,
        "hasWindowRole": roles.get("window", 0) > 0,
        "hasStairRole": roles.get("stair-symbol", 0) > 0,
        "hasVoidRole": roles.get("open-to-below", 0) > 0,
    }


def _pixel_span(value: Any) -> tuple[float, float, float, float] | None:
    if isinstance(value, list) and len(value) >= 4:
        vals = [float(item) for item in value[:4]]
        if all(map(lambda item: item == item, vals)):
            x1, y1, x2, y2 = vals
            return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
    if isinstance(value, dict):
        if "pixelBounds" in value:
            return _pixel_span(value.get("pixelBounds"))
        if all(key in value for key in ("x", "w")) and ("y" in value or "z" in value) and ("h" in value or "d" in value):
            x = float(value["x"])
            y = float(value.get("y", value.get("z")))
            w = float(value["w"])
            h = float(value.get("h", value.get("d")))
            return min(x, x + w), min(y, y + h), max(x, x + w), max(y, y + h)
        if all(key in value for key in ("x1", "x2")) and ("y1" in value or "z1" in value) and ("y2" in value or "z2" in value):
            x1 = float(value["x1"])
            y1 = float(value.get("y1", value.get("z1")))
            x2 = float(value["x2"])
            y2 = float(value.get("y2", value.get("z2")))
            return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
    return None


def artifact_wall_thickness_local_px(plan_id: str, proposal_id: str) -> float | None:
    """Return visible wall thickness in renderer-local px, derived from source anchors.

    The deterministic SVG is later scaled into the source image frame. A wall
    body that is 18 local px may appear as roughly 27 source px after that
    frame alignment. This keeps drawing style separate from semantic wall
    thickness in feet.
    """
    artifact = ROOT / "public/data/den-image-loop" / plan_id / "paired" / f"{plan_id}-{proposal_id}.paired.json"
    if not artifact.exists():
        return None
    data = json.loads(artifact.read_text())
    footprint = data.get("footprint") or {}
    width_ft = float(footprint.get("widthFt") or footprint.get("width") or 0)
    depth_ft = float(footprint.get("depthFt") or footprint.get("depth") or 0)
    frame = _pixel_span((footprint.get("sourceAnchor") or {}).get("pixelBounds"))
    coord = data.get("coordinateSystem") or {}
    if not frame:
        frame = _pixel_span(coord.get("planPixelBounds"))
    if not frame:
        floor_panels = data.get("floorPanels") or []
        footprint_anchors: list[tuple[float, float, float, float]] = []
        level_anchors: list[tuple[float, float, float, float]] = []
        for panel in floor_panels:
            if panel.get("floor", panel.get("levelIndex", 0)) not in (0, "0"):
                continue
            for anchor in panel.get("sourceAnchors") or []:
                span = _pixel_span(anchor.get("span") or anchor.get("pixelBounds") or anchor)
                if not span:
                    continue
                kind = str(anchor.get("kind") or anchor.get("id") or anchor.get("sourceSlot") or "").lower()
                if "footprint" in kind:
                    footprint_anchors.append(span)
                elif "levelpanel" in kind or "panel" in kind or "source" in kind or "slot" in kind or "generated" in kind:
                    level_anchors.append(span)
        if footprint_anchors:
            frame = max(footprint_anchors, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))
        elif level_anchors:
            frame = max(level_anchors, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))
    if not frame or width_ft <= 0 or depth_ft <= 0:
        return None
    fx1, fy1, fx2, fy2 = frame
    scale_x = (fx2 - fx1) / max(1, width_ft * 15)
    scale_y = (fy2 - fy1) / max(1, depth_ft * 15)
    if scale_x <= 0 or scale_y <= 0:
        return None

    samples: list[float] = []
    walls = [*(data.get("exteriorWalls") or []), *(data.get("interiorWalls") or [])]
    anchor_by_id: dict[str, Any] = {}
    source_anchors = [
        *(data.get("sourceAnchors") or []),
        *(anchor for panel in data.get("floorPanels") or [] for anchor in panel.get("sourceAnchors") or []),
    ]
    for anchor in source_anchors:
        anchor_id = anchor.get("id") or anchor.get("sourceAnchorId") or anchor.get("elementId")
        if isinstance(anchor_id, str):
            anchor_by_id[anchor_id] = anchor

    for wall in walls:
        wall_id = wall.get("id") or wall.get("sourceAnchorId")
        candidates = [wall.get("sourceAnchor")]
        if isinstance(wall_id, str):
            candidates.append(anchor_by_id.get(wall_id))
            candidates.extend(anchor for key, anchor in anchor_by_id.items() if key.startswith(f"{wall_id}:seg-"))
        for candidate in candidates:
            span = _pixel_span(candidate)
            if not span:
                continue
            x1, y1, x2, y2 = span
            w = abs(x2 - x1)
            h = abs(y2 - y1)
            if max(w, h) < 24 or min(w, h) < 3 or min(w, h) > 72:
                continue
            local = (w / scale_x) if w <= h else (h / scale_y)
            if 2 <= local <= 36:
                samples.append(local)
    if not samples:
        return None
    return float(median(samples))


def profile_for(plan_id: str, proposal_id: str, source: Path, render: Path) -> dict[str, Any]:
    source_stats = analyze_source_png(source)
    render_stats = analyze_svg(render)
    anchor_wall_width = artifact_wall_thickness_local_px(plan_id, proposal_id)
    exterior_backing = max(6.5, min(24.0, anchor_wall_width or source_stats["midRunStrokePx"]))
    exterior_line = max(1.0, min(2.4, source_stats["darkRunStrokePx"]))
    interior_line = max(0.75, min(1.8, exterior_line * 0.78))
    door_line = max(0.65, min(1.25, interior_line * 0.82))
    window_line = max(0.85, min(1.6, interior_line * 1.05))
    # Keep the wall body at the proposal's mid-gray value. Blending it toward
    # the dark outline makes every wall body count as dark geometry in QA, which
    # hides edge alignment behind a large false "render extra" signal.
    wall_fill = source_stats["midMedianColor"]
    metrics = {
        "sourceDarkRunStrokePx": source_stats["darkRunStrokePx"],
        "sourceMidRunStrokePx": source_stats["midRunStrokePx"],
        "sourceAnchorWallThicknessLocalPx": anchor_wall_width or 0.0,
        "renderExteriorWallStrokeWidthPx": render_stats["exteriorWallStrokeWidthPx"],
        "renderInteriorWallStrokeWidthPx": render_stats["interiorWallStrokeWidthPx"],
        "preProfileWallStrokeWidthDeltaPx": abs(exterior_backing - render_stats["exteriorWallStrokeWidthPx"]),
        "preProfileDoorStrokeWidthDeltaPx": abs(door_line - render_stats["doorStrokeWidthPx"]),
        "preProfileWindowStrokeWidthDeltaPx": abs(window_line - render_stats["windowStrokeWidthPx"]),
        "wallStrokeWidthDeltaPx": 0.0,
        "doorStrokeWidthDeltaPx": 0.0,
        "windowStrokeWidthDeltaPx": 0.0,
        "dashPatternDelta": 0.0,
    }
    warnings: list[str] = []
    blockers: list[str] = []
    if not render_stats["hasDoorRole"]:
        warnings.append("deterministic SVG has no data-role=door elements for style extraction")
    if not render_stats["hasWindowRole"]:
        warnings.append("deterministic SVG has no data-role=window elements for style extraction")
    status = "blocked" if blockers else "warning" if warnings else "pass"
    return {
        "schemaVersion": "drawing_style_profile_v1",
        "profileId": f"{plan_id}-{proposal_id}-drawing-style-v1",
        "planId": plan_id,
        "proposalId": proposal_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "sourceImage": str(source),
            "deterministicRender": str(render),
            "extractor": "scripts/extract-drawing-style-profile.py",
        },
        "rules": {
            "background": "#ffffff",
            "grid": {"color": "#eeeeea", "strokeWidthPx": 0.75, "opacity": 0.42, "visible": True},
            "walls": {
                "exteriorStroke": source_stats["darkMedianColor"],
                "exteriorBackingStroke": wall_fill,
                "exteriorStrokeWidthPx": max(exterior_line, 2.3 if exterior_backing >= 10 else exterior_line),
                "exteriorBackingStrokeWidthPx": exterior_backing,
                "exteriorOpacity": 0.96,
                "interiorStroke": source_stats["darkMedianColor"],
                "interiorStrokeWidthPx": max(interior_line, 1.68 if exterior_backing >= 10 else interior_line),
                "interiorOpacity": 0.9,
                "guardStroke": "#817970",
                "guardStrokeWidthPx": max(0.65, interior_line * 0.75),
                "cap": "butt",
                "join": "miter",
            },
            "openings": {"gapStroke": "#ffffff", "gapStrokeWidthPx": max(4.6, exterior_backing * 0.62)},
            "windows": {
                "stroke": source_stats["darkMedianColor"],
                "strokeWidthPx": max(window_line, 1.45),
                "dividerStrokeWidthPx": max(0.65, window_line * 0.72),
                "opacity": 0.88,
            },
            "doors": {
                "stroke": "#888177",
                "strokeWidthPx": door_line,
                "leafStrokeWidthPx": door_line,
                "arcStrokeWidthPx": max(0.55, door_line * 0.82),
                "fill": "rgba(136,129,119,0.045)",
                "opacity": 0.9,
                "swingDasharray": "3,2",
            },
            "fixtures": {"stroke": "#6f6961", "fill": "#fbfaf7", "strokeWidthPx": max(1.05, door_line * 0.95), "opacity": 0.72},
            "stairs": {"stroke": "#6f6961", "strokeWidthPx": max(1.1, door_line), "opacity": 0.94},
            "voids": {"stroke": "#746d64", "strokeWidthPx": max(0.7, door_line), "dasharray": "5,5", "opacity": 0.48},
            "dimensions": {"stroke": source_stats["darkMedianColor"], "strokeWidthPx": 1.35, "fontSizePx": 10, "opacity": 0.96},
            "callouts": {"fill": source_stats["accentColor"], "radiusPx": 6.4, "fontSizePx": 6.5, "opacity": 0.92},
            "labels": {
                "fill": "#3d3934",
                "fontFamily": "Arial, Helvetica, sans-serif",
                "roomFontSizePx": 10,
                "floorTitleFontSizePx": 9,
                "fontWeight": 600,
            },
            "roomFillOpacity": 0.2,
        },
        "validation": {
            "status": status,
            "blockers": blockers,
            "warnings": warnings,
            "metrics": metrics,
            "sourceImageStats": source_stats,
            "renderSvgStats": render_stats,
        },
    }


def promoted_targets() -> list[tuple[str, str, Path, Path, Path]]:
    manifest = json.loads(MANIFEST.read_text())
    targets: list[tuple[str, str, Path, Path, Path]] = []
    for plan_id, options in manifest.get("plans", {}).items():
        for option in options:
            if not option.get("promotionEligible") or not option.get("latestPairedArtifact"):
                continue
            source = ROOT / "public/data/den-image-loop" / plan_id / option["imageUrl"]
            render = ROOT / "public/data/den-image-loop" / plan_id / option["deterministicRenderUrl"]
            out = ROOT / "public/data/den-image-loop" / plan_id / option["pairedJsonUrl"].replace(".paired.json", ".drawing-style.json")
            targets.append((plan_id, option["id"], source, render, out))
    return targets


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all-promoted", action="store_true", help="extract profiles for every latest promoted paired artifact")
    parser.add_argument("--plan-id")
    parser.add_argument("--proposal-id")
    parser.add_argument("--source")
    parser.add_argument("--render")
    parser.add_argument("--out")
    args = parser.parse_args()

    if args.all_promoted:
        targets = promoted_targets()
    else:
        if not all([args.plan_id, args.proposal_id, args.source, args.render, args.out]):
            raise SystemExit("provide --all-promoted or --plan-id --proposal-id --source --render --out")
        targets = [(args.plan_id, args.proposal_id, Path(args.source), Path(args.render), Path(args.out))]

    for plan_id, proposal_id, source, render, out in targets:
        profile = profile_for(plan_id, proposal_id, source, render)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(profile, indent=2) + "\n")
        try:
            out_label = out.relative_to(ROOT)
        except ValueError:
            out_label = out
        print(f"{plan_id}/{proposal_id}: {profile['validation']['status']} -> {out_label}")


if __name__ == "__main__":
    main()
