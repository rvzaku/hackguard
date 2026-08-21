import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../src/openapi.js';

const doc = buildOpenApiDocument();
const out = new URL('../openapi.json', import.meta.url);
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`Wrote ${out.pathname}`);
