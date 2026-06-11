import type { DenHome } from '@/lib/types';
import { semanticBimFromHome, type SemanticBimModel } from './semantic-bim';

export interface ExperimentalIfcExport {
  status: 'experimental';
  semanticBim: SemanticBimModel;
  ifcText: string;
  blockers: string[];
}

export function exportExperimentalIfc(home: DenHome): ExperimentalIfcExport {
  const semanticBim = semanticBimFromHome(home);
  const blockers = [
    'web-ifc is installed, but full IFC STEP entity writing is intentionally gated behind semantic_bim_v1 validation.',
    'This export is a readable IFC placeholder plus the complete semantic_bim_v1 JSON payload.',
    'Before enabling production IFC, map elements to real IfcProject/IfcSite/IfcBuilding/IfcStorey/IfcWall/IfcSlab/IfcSpace entities and validate in a BIM checker.',
  ];
  const ifcText = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('semantic_bim_v1 experimental handoff'),'2;1');",
    `FILE_NAME('${home.id}-${home.pairedProposalId ?? 'draft'}.ifc','${new Date().toISOString()}',('OpenClaw'),('Den Outdoors Planner'),'web-ifc experimental','semantic_bim_v1','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    `/* semantic_bim_v1 element count: ${semanticBim.elements.length} */`,
    `/* Full deterministic BIM JSON is exported separately in the product packet. */`,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');

  return {
    status: 'experimental',
    semanticBim,
    ifcText,
    blockers,
  };
}
