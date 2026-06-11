import catalog from '@/public/data/bim-components/catalog.json';
import visualCatalog from '@/public/data/bim-components/visual-catalog.json';

export interface LocalBimAssetCandidate {
  id: string;
  label: string;
  manufacturer?: string;
  intendedUse: string;
  ifcClass: string;
  file: string;
  renderMode?: 'metadata-only' | 'procedural-fallback' | 'gltf-cache';
  dimensions?: {
    widthFt?: number;
    depthFt?: number;
    heightFt?: number;
  };
}

export interface VisualAssetCandidate {
  id: string;
  source: string;
  uid?: string;
  label: string;
  intendedUse: string;
  author?: string;
  authorUrl?: string;
  sourceUrl?: string;
  license?: string;
  licenseUrl?: string;
  credit?: string;
  entrypoint: string;
  renderMode: 'gltf-cache';
  status: 'cached' | 'candidate';
  approvedForBrochure?: boolean;
}

type CatalogShape = {
  componentCount: number;
  components: LocalBimAssetCandidate[];
};

type VisualCatalogShape = {
  assets: VisualAssetCandidate[];
};

const localCatalog = catalog as CatalogShape;
const localVisualCatalog = visualCatalog as VisualCatalogShape;

function desiredUse(text: string) {
  const value = text.toLowerCase();
  if (/furniture\.bed|(^|\\s)bed(\\s|$)|queen|bunk/.test(value)) return 'bed';
  if (/furniture\.seating|sofa|couch/.test(value)) return 'sofa';
  if (/furniture\.table|dining|coffee.table|table/.test(value)) return 'table';
  if (/fixture\.tub-shower|tub|bath|shower/.test(value)) return 'bath';
  if (/fixture\.toilet|toilet|wc/.test(value)) return 'toilet';
  if (/fixture\.sink-vanity|sink|vanity|basin/.test(value)) return 'sink';
  if (/equipment\.kitchen-counter-appliance|kitchen|range|stove|cooktop|refrigerator|fridge|appliance|counter|cabinet|casework|island/.test(value)) return 'kitchen';
  if (/sofa|couch/.test(value)) return 'sofa';
  if (/chair|bench|seating/.test(value)) return 'chair';
  if (/table|dining|coffee/.test(value)) return 'table';
  if (/storage|closet|cabinet|shelf|credenza/.test(value)) return 'storage';
  if (/tub|bath|shower/.test(value)) return 'bath';
  if (/toilet|wc/.test(value)) return 'toilet';
  if (/sink|vanity|basin/.test(value)) return 'sink';
  return undefined;
}

export function localBimAssetSummary() {
  return {
    componentCount: localCatalog.componentCount,
    renderableCount: localVisualCatalog.assets.filter((item) => item.renderMode === 'gltf-cache').length,
    metadataOnlyCount: localCatalog.components.filter((item) => item.renderMode !== 'gltf-cache').length,
    visualAssetCount: localVisualCatalog.assets.length,
    byUse: localCatalog.components.reduce<Record<string, number>>((counts, item) => {
      counts[item.intendedUse] = (counts[item.intendedUse] ?? 0) + 1;
      return counts;
    }, {}),
    visualByUse: localVisualCatalog.assets.reduce<Record<string, number>>((counts, item) => {
      counts[item.intendedUse] = (counts[item.intendedUse] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function localVisualAssetAttributions() {
  return localVisualCatalog.assets.map((asset) => ({
    id: asset.id,
    label: asset.label,
    intendedUse: asset.intendedUse,
    source: asset.source,
    sourceUrl: asset.sourceUrl,
    author: asset.author,
    authorUrl: asset.authorUrl,
    license: asset.license,
    licenseUrl: asset.licenseUrl,
    credit: asset.credit,
    renderMode: asset.renderMode,
    geometryAuthority: 'semantic-json',
  }));
}

export function resolveLocalBimAsset(text: string): LocalBimAssetCandidate | undefined {
  const use = desiredUse(text);
  if (!use) return undefined;
  return localCatalog.components
    .filter((item) => item.intendedUse === use)
    .sort((a, b) => {
      const aSize = a.dimensions?.widthFt ?? a.dimensions?.depthFt ?? 999;
      const bSize = b.dimensions?.widthFt ?? b.dimensions?.depthFt ?? 999;
      return aSize - bSize;
    })[0];
}

export function resolveVisualAsset(text: string): VisualAssetCandidate | undefined {
  const use = desiredUse(text);
  if (!use) return undefined;
  return localVisualCatalog.assets.find((item) => (
    item.intendedUse === use &&
    item.status === 'cached' &&
    item.approvedForBrochure === true
  ));
}

export function visualAssetMode(localAsset?: LocalBimAssetCandidate, visualAsset?: VisualAssetCandidate) {
  if (visualAsset) return visualAsset.renderMode;
  if (localAsset) return localAsset.renderMode ?? 'metadata-only';
  return 'procedural-fallback';
}
