import type { ModularComponent, DenHome, ComponentLibrary } from './types';

import libraryData from '@/public/data/library.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = libraryData as any as ComponentLibrary;

export const components: ModularComponent[] = lib.components;
export const homes: DenHome[] = lib.homes;
export const coverage: Record<string, Record<string, boolean>> = lib.coverage;

export function getHome(id: string): DenHome | undefined {
  return homes.find(h => h.id === id);
}

export function getComponent(id: string): ModularComponent | undefined {
  return components.find(c => c.id === id);
}

export function getComponentsForHome(homeId: string): ModularComponent[] {
  const home = getHome(homeId);
  if (!home) return [];
  return home.componentsUsed
    .map(id => getComponent(id))
    .filter((c): c is ModularComponent => c !== undefined);
}
