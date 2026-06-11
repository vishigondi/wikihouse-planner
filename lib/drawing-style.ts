export type DrawingStyleSeverity = 'pass' | 'warning' | 'blocked';

export interface DrawingStyleProfile {
  schemaVersion: 'drawing_style_profile_v1';
  profileId: string;
  planId?: string;
  proposalId?: string;
  generatedAt?: string;
  source?: {
    sourceImage?: string;
    deterministicRender?: string;
    extractor?: string;
  };
  rules: {
    background: string;
    grid: {
      color: string;
      strokeWidthPx: number;
      opacity: number;
      visible: boolean;
      orientation?: 'both' | 'horizontal' | 'vertical';
      spacingFt?: number;
    };
    floorTexture?: {
      visible: boolean;
      color: string;
      strokeWidthPx: number;
      opacity: number;
      spacingFt: number;
      orientation: 'horizontal' | 'vertical';
    };
    walls: {
      exteriorStroke: string;
      exteriorBackingStroke: string;
      exteriorStrokeWidthPx: number;
      exteriorBackingStrokeWidthPx: number;
      exteriorOpacity: number;
      interiorStroke: string;
      interiorStrokeWidthPx: number;
      interiorOpacity: number;
      guardStroke: string;
      guardStrokeWidthPx: number;
      cap: 'butt' | 'square' | 'round';
      join: 'miter' | 'round' | 'bevel';
      wallBodyLineMode?: 'outline' | 'centerline';
    };
    openings: {
      gapStroke: string;
      gapStrokeWidthPx: number;
    };
    windows: {
      stroke: string;
      strokeWidthPx: number;
      dividerStrokeWidthPx: number;
      opacity: number;
    };
    doors: {
      stroke: string;
      strokeWidthPx: number;
      leafStrokeWidthPx: number;
      arcStrokeWidthPx: number;
      fill: string;
      opacity: number;
      swingDasharray?: string;
    };
    fixtures: {
      stroke: string;
      fill: string;
      strokeWidthPx: number;
      opacity: number;
    };
    stairs: {
      stroke: string;
      strokeWidthPx: number;
      opacity: number;
    };
    voids: {
      stroke: string;
      strokeWidthPx: number;
      dasharray: string;
      opacity: number;
    };
    dimensions: {
      stroke: string;
      strokeWidthPx: number;
      fontSizePx: number;
      opacity: number;
    };
    callouts: {
      fill: string;
      radiusPx: number;
      fontSizePx: number;
      opacity: number;
    };
    labels: {
      fill: string;
      fontFamily: string;
      roomFontSizePx: number;
      floorTitleFontSizePx: number;
      fontWeight: number;
      showTraceRoomNames?: boolean;
      traceRoomFontSizePx?: number;
      traceRoomLabelOpacity?: number;
    };
    roomFillOpacity: number;
  };
  validation?: {
    status: DrawingStyleSeverity;
    blockers: string[];
    warnings: string[];
    metrics?: Record<string, number>;
  };
}

export const DEFAULT_DEN_DRAWING_STYLE_PROFILE: DrawingStyleProfile = {
  schemaVersion: 'drawing_style_profile_v1',
  profileId: 'den-brochure-default-v1',
  source: {
    extractor: 'default-den-style-profile',
  },
  rules: {
    background: '#ffffff',
    grid: {
      color: '#eeeeea',
      strokeWidthPx: 0.8,
      opacity: 0.42,
      visible: true,
      spacingFt: 4,
    },
    floorTexture: {
      visible: false,
      color: '#d8d4cc',
      strokeWidthPx: 0.45,
      opacity: 0.32,
      spacingFt: 0.35,
      orientation: 'horizontal',
    },
    walls: {
      exteriorStroke: '#2f2f2d',
      exteriorBackingStroke: '#9f9c96',
      exteriorStrokeWidthPx: 1.2,
      exteriorBackingStrokeWidthPx: 8.2,
      exteriorOpacity: 0.92,
      interiorStroke: '#55504a',
      interiorStrokeWidthPx: 0.95,
      interiorOpacity: 0.92,
      guardStroke: '#817970',
      guardStrokeWidthPx: 0.8,
      cap: 'butt',
      join: 'miter',
      wallBodyLineMode: 'outline',
    },
    openings: {
      gapStroke: '#ffffff',
      gapStrokeWidthPx: 4.8,
    },
    windows: {
      stroke: '#aebdc0',
      strokeWidthPx: 1.15,
      dividerStrokeWidthPx: 0.75,
      opacity: 0.86,
    },
    doors: {
      stroke: '#888177',
      strokeWidthPx: 0.75,
      leafStrokeWidthPx: 0.8,
      arcStrokeWidthPx: 0.7,
      fill: 'rgba(136,129,119,0.045)',
      opacity: 0.68,
    },
    fixtures: {
      stroke: '#827b71',
      fill: '#fbfaf7',
      strokeWidthPx: 1,
      opacity: 0.72,
    },
    stairs: {
      stroke: '#827b71',
      strokeWidthPx: 1,
      opacity: 0.72,
    },
    voids: {
      stroke: '#746d64',
      strokeWidthPx: 0.85,
      dasharray: '5,5',
      opacity: 0.48,
    },
    dimensions: {
      stroke: '#746d64',
      strokeWidthPx: 0.8,
      fontSizePx: 10,
      opacity: 0.62,
    },
    callouts: {
      fill: '#b86e63',
      radiusPx: 6.4,
      fontSizePx: 6.5,
      opacity: 0.92,
    },
    labels: {
      fill: '#3d3934',
      fontFamily: 'Arial, Helvetica, sans-serif',
      roomFontSizePx: 10,
      floorTitleFontSizePx: 9,
      fontWeight: 600,
      showTraceRoomNames: false,
      traceRoomFontSizePx: 6.2,
      traceRoomLabelOpacity: 0.55,
    },
    roomFillOpacity: 0.2,
  },
  validation: {
    status: 'warning',
    blockers: [],
    warnings: ['Default drawing style profile used; extract a per-artifact profile before brochure release.'],
  },
};

export function drawingStyleOrDefault(profile?: DrawingStyleProfile | null): DrawingStyleProfile {
  return profile ?? DEFAULT_DEN_DRAWING_STYLE_PROFILE;
}
