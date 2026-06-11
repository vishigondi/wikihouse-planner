import type { RenderTheme, RenderThemeId } from './types';

export const RENDER_THEMES: Record<RenderThemeId, RenderTheme> = {
  'product-presentation': {
    id: 'product-presentation',
    label: 'Product',
    background: '#f7f3ec',
    ground: '#eee8de',
    gridCell: '#eee8de',
    gridSection: '#e5ded2',
    exteriorWall: '#3d3933',
    interiorWall: '#c9beae',
    deckFloor: '#d9be89',
    roomFloor: '#eee7db',
    openPlanFloor: '#f1e8d2',
    fixtureMaterial: '#b8b0a4',
    labelAccent: '#b96f62',
    wallOpacity: 0.92,
    fixtureOpacity: 0.92,
    showGrid: false,
    softStudio: true,
  },
};

export const DEFAULT_RENDER_THEME_ID: RenderThemeId = 'product-presentation';
