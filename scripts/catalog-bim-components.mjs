#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const inputDir = process.argv[2] ?? path.join(repoRoot, 'public/data/bim-components/staging');
const outputFile = process.argv[3] ?? path.join(repoRoot, 'public/data/bim-components/catalog.json');

const PRODUCT_CLASSES = [
  'IFCSANITARYTERMINAL',
  'IFCFLOWTERMINAL',
  'IFCFURNISHINGELEMENT',
  'IFCFURNITURETYPE',
  'IFCDOOR',
  'IFCWINDOW',
  'IFCBUILDINGELEMENTPROXY',
  'IFCSYSTEMFURNITUREELEMENT',
  'IFCELEMENTASSEMBLY',
];

function decodeIfcString(value) {
  return String(value ?? '')
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, '')
    .replace(/''/g, "'")
    .trim();
}

function firstQuotedArgs(line) {
  return [...line.matchAll(/'([^']*(?:''[^']*)*)'/g)].map((match) => decodeIfcString(match[1]));
}

function getProperty(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = text.split(/\r?\n/).find((item) => new RegExp(`IFCPROPERTYSINGLEVALUE\\('${escaped}'`, 'i').test(item));
  if (!line) return undefined;
  const quoted = firstQuotedArgs(line);
  if (quoted.length > 1) return quoted[1];
  const measured = line.match(/IFC(?:REAL|INTEGER|LENGTHMEASURE|POSITIVELENGTHMEASURE)\(([-0-9.]+)\)/i);
  if (measured) return measured[1];
  return undefined;
}

function classify(fileName, productClass, text) {
  const lower = fileName.toLowerCase();
  if (/toilet|wc|bath|shower|sink|basin|plumbing|sanitary|wudu/.test(lower) || /FLOWTERMINAL|SANITARY/.test(productClass)) return 'sanitary';
  if (/sofa|chair|bench|seating|booth|table|storage|credenza|cube|furniture/.test(lower) || /FURNISH/.test(productClass)) return 'furniture';
  if (/door/.test(lower) || productClass === 'IFCDOOR') return 'door';
  if (/window/.test(lower) || productClass === 'IFCWINDOW') return 'window';
  if (/panel|wall/.test(lower)) return 'panel';
  return /Furniture/i.test(text) ? 'furniture' : 'generic';
}

function inferUse(fileName) {
  const lower = fileName.toLowerCase();
  if (/sofa|2seater|softseating|booth/.test(lower)) return 'sofa';
  if (/chair|seat|bench/.test(lower)) return 'chair';
  if (/table/.test(lower)) return 'table';
  if (/storage|credenza|cube|unit/.test(lower)) return 'storage';
  if (/bath/.test(lower)) return 'bath';
  if (/toilet|wc/.test(lower)) return 'toilet';
  if (/sink|basin/.test(lower)) return 'sink';
  return 'generic';
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.ifc') ? [full] : [];
  }));
  return files.flat();
}

async function catalogIfc(file) {
  const text = await fs.readFile(file, 'utf8');
  const stats = await fs.stat(file);
  const schema = text.match(/FILE_SCHEMA\(\('([^']+)'\)\)/i)?.[1] ?? 'unknown';
  const productLine = text.split(/\r?\n/).find((line) => PRODUCT_CLASSES.some((item) => line.includes(`=${item}(`))) ?? '';
  const productClass = PRODUCT_CLASSES.find((item) => productLine.includes(`=${item}(`)) ?? 'IFCBUILDINGELEMENTPROXY';
  const quoted = firstQuotedArgs(productLine);
  const name = quoted[2] || quoted[0] || path.basename(file, '.ifc');
  const typeName = getProperty(text, 'Type Name') ?? getProperty(text, 'TypeName') ?? getProperty(text, 'Family and Type') ?? name;
  const manufacturer = getProperty(text, 'Manufacturer') ?? getProperty(text, 'ManufacturerName') ?? name.split(/[-_:]/)[0] ?? 'unknown';
  const category = getProperty(text, 'Category') ?? classify(file, productClass, text);
  const nominalLengthMm = Number(getProperty(text, 'NominalLength') ?? getProperty(text, 'Length') ?? NaN);
  const nominalDepthMm = Number(getProperty(text, 'NominalDepth') ?? getProperty(text, 'Depth') ?? NaN);
  const nominalHeightMm = Number(getProperty(text, 'NominalHeight') ?? getProperty(text, 'Height') ?? NaN);
  const relPath = path.relative(path.join(repoRoot, 'public'), file).split(path.sep).join('/');
  return {
    id: path.basename(file, '.ifc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    label: typeName,
    manufacturer,
    category: classify(file, productClass, text),
    intendedUse: inferUse(file),
    ifcClass: productClass,
    ifcSchema: schema,
    source: 'local-download',
    sourceLabel: 'Downloaded IFC staging',
    file: `/${relPath}`,
    renderMode: 'metadata-only',
    bytes: stats.size,
    dimensions: {
      widthFt: Number.isFinite(nominalLengthMm) ? +(nominalLengthMm / 304.8).toFixed(3) : undefined,
      depthFt: Number.isFinite(nominalDepthMm) ? +(nominalDepthMm / 304.8).toFixed(3) : undefined,
      heightFt: Number.isFinite(nominalHeightMm) ? +(nominalHeightMm / 304.8).toFixed(3) : undefined,
    },
    metadata: {
      rawCategory: category,
      productName: name,
      modelReference: getProperty(text, 'ModelReference'),
      nbsReference: getProperty(text, 'NBSReference'),
      material: getProperty(text, 'Material'),
    },
    geometryAuthority: 'semantic-json',
    status: 'cataloged',
  };
}

const files = await listFiles(inputDir);
const components = (await Promise.all(files.map(catalogIfc))).sort((a, b) => a.id.localeCompare(b.id));
await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify({
  schemaVersion: 'bim_component_catalog_v1',
  generatedAt: new Date().toISOString(),
  inputDir: path.relative(repoRoot, inputDir),
  componentCount: components.length,
  components,
}, null, 2)}\n`);

console.log(`cataloged ${components.length} IFC component(s) -> ${path.relative(repoRoot, outputFile)}`);
