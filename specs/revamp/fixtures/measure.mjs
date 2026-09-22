// Planning-only inventory and canonical-byte measurements. Does not run the app or simulator.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Non-finite number');
  return value;
}
const hash = text => createHash('sha256').update(text).digest('hex');
const measure = value => { const text = canonical(value); return { bytes: Buffer.byteLength(text), sha256: hash(text) }; };
const assert = (condition, message) => { if (!condition) throw Error(message); };
const keys = (value, expected, path) => assert(Object.keys(value).sort().join() === expected.split(',').sort().join(), `Unexpected fields: ${path}`);
const uuid = number => `70000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const depth = value => value && typeof value === 'object' ? 1 + Math.max(0,...Object.values(value).map(depth)) : 0;
const containers = value => value && typeof value === 'object' ? 1 + Object.values(value).reduce((sum,v)=>sum+containers(v),0) : 0;

function payloadMatches(value, shape) {
  if (value === null) return shape.nullable;
  switch (shape.type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isSafeInteger(value);
    case 'scalar-union': return shape.types.some(type => payloadMatches(value, { type, nullable: false }));
    case 'list': return Array.isArray(value) && value.length <= shape.maxItems && value.every(v => payloadMatches(v, shape.items));
    case 'record': return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(k => shape.fields.some(f => f.key === k))
      && shape.fields.every(f => Object.hasOwn(value, f.key) ? payloadMatches(value[f.key], f.shape) : f.optional);
    default: throw Error(`Unknown shape ${shape.type}`);
  }
}
function normalizedShape(shape) {
  if (shape.type === 'record') return { type: shape.type, nullable: shape.nullable, fields: shape.fields.map(({ key, optional, shape: s }) => ({ key, optional, shape: normalizedShape(s) })).sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
  if (shape.type === 'list') return { ...shape, items: normalizedShape(shape.items) };
  return shape;
}
function inventory(document) {
  keys(document, 'schema,id,title,elements,connections,relations,schemas,fixtures,refinements,scenarios,views', 'document');
  const definitions = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && Object.hasOwn(value, 'id')) {
      assert(!definitions.has(value.id), `Duplicate ID ${value.id}`); definitions.add(value.id);
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id), `Invalid ID ${value.id}`);
    }
    Object.values(value).forEach(visit);
  };
  visit(document);
  const schemas = new Map(document.schemas.map(s => [s.id, s.shape]));
  const elements = new Map(document.elements.map(e => [e.id, e]));
  const ports = new Map(document.elements.flatMap(e => e.ports.map(p => [p.id, { ...p, elementId: e.id }])));
  const fixtures = new Map(document.fixtures.map(f => [f.id, f]));
  const endpoint = e => { const p = ports.get(e.portId); assert(p && p.elementId === e.elementId, 'Invalid endpoint'); return p; };
  const compatible = (a,b) => canonical(normalizedShape(schemas.get(a))) === canonical(normalizedShape(schemas.get(b)));
  for (const e of elements.values()) {
    assert(e.ports.length <= 16, 'Port ceiling');
    for (const p of e.ports) { assert(schemas.has(p.schemaId), 'Missing port schema'); assert(p.channel === 'call' ? schemas.has(p.responseSchemaId) : p.responseSchemaId === null, 'Response schema'); }
    const b = e.behavior;
    if (b.kind === 'machine') {
      const states = new Set(b.states.map(s => s.id)); assert(states.has(b.initialStateId), 'Missing state');
      assert(fixtures.get(b.initialContextFixtureId)?.schemaId === b.contextSchemaId, 'Context schema');
      for (const t of b.transitions) { assert(states.has(t.fromStateId) && states.has(t.toStateId), 'Transition state'); assert(ports.get(t.eventPortId)?.elementId === e.id, 'Transition port'); }
      for (const bnd of b.responseBindings) { assert(compatible(ports.get(bnd.callPortId).responseSchemaId, ports.get(bnd.eventPortId).schemaId), 'Binding shape'); }
    }
  }
  for (const f of fixtures.values()) assert(schemas.has(f.schemaId) && payloadMatches(f.value, schemas.get(f.schemaId)), `Fixture payload ${f.id}`);
  for (const c of document.connections) {
    const a=endpoint(c.source), b=endpoint(c.target);
    assert(a.direction === 'out' && b.direction === 'in' && a.channel === c.kind && b.channel === c.kind, `Channel mismatch ${c.label}`);
    assert(compatible(a.schemaId,b.schemaId), `Payload mismatch ${c.label}`);
    if(c.kind === 'call') assert(compatible(a.responseSchemaId,b.responseSchemaId), 'Call response mismatch');
  }
  for (const s of document.scenarios) {
    keys(s,'id,label,revision,mode,scopeElementIds,entryPorts,inputs,workloads,faults,boundaries,refinementSelections,initialContexts,assertions,seed,budgets,completion,assumptions',s.label);
    assert(s.assertions.length > 0 && s.inputs.length > 0, 'Vacuous fixture');
    for (const id of s.scopeElementIds) assert(elements.has(id), 'Missing scope');
    for (const i of s.inputs) { const p=endpoint(i.entry); const f=fixtures.get(i.fixtureId); assert(p.direction === 'in' && f && compatible(p.schemaId,f.schemaId),'Input shape'); }
    for (const b of s.boundaries) {
      const p=endpoint(b.source); assert(p.channel === 'call', 'Boundary call');
      for(const r of b.responses) { assert(fixtures.has(r.responseFixtureId),'Missing response fixture'); assert(r.afterInputId === null || s.inputs.some(i=>i.id === r.afterInputId),'Missing afterInput'); }
    }
  }
  assert(document.elements.length<=100 && document.connections.length<=200 && document.schemas.length<=100 && document.scenarios.length<=20 && document.views.length<=10,'Document counts');
  const fixtureBytes = document.fixtures.reduce((sum, f) => sum + measure(f.value).bytes,0);
  assert(fixtureBytes<=1048576 && document.fixtures.every(f=>measure(f.value).bytes<=262144),'Fixture bytes');
  assert(measure(document).bytes<=2097152,'Document bytes');
  assert(depth(document)<=32,'Document raw nesting');
  return { definitions: definitions.size, rawDepth:depth(document), elements:document.elements.length, connections:document.connections.length, schemas:document.schemas.length, scenarios:document.scenarios.length, assertions:document.scenarios.reduce((s,x)=>s+x.assertions.length,0), fixtureBytes };
}
const report={ runtime:process.version, canonicalEncoding:'canonical-json-v1 (these fixtures use ASCII keys and finite ordinary integers)', scope:'Planning data inventory and serialization only; no runtime outcomes, memory or latency measured', files:[] };
for(const name of ['s01.json','s02.json','s03.json','s04.json','s05.json','combined.json']) {
  const d=JSON.parse(readFileSync(join(directory,name),'utf8'));
  report.files.push({name,...measure(d),...inventory(d)});
}

// Reproducible storable near-ceiling document. Unmodeled elements intentionally prevent run-readiness.
let next=1;const id=()=>uuid(next++);
const stress={schema:'studio-model/1',id:id(),title:'Synthetic sizing only',elements:[],connections:[],relations:[],schemas:[],fixtures:[],refinements:[],scenarios:[],views:[]};
for(let i=0;i<100;i++)stress.elements.push({id:id(),label:`Element ${i}`,description:'x'.repeat(4000),visualKind:'custom',ports:[],behavior:{kind:'unmodeled',version:1,reason:'Sizing only'}});
for(let i=0;i<100;i++)stress.schemas.push({id:id(),label:`Schema ${i}`,shape:{type:'record',nullable:false,fields:Array.from({length:100},(_,j)=>({id:id(),key:`f${j}`,optional:false,shape:{type:'string',nullable:false}}))}});
const payload=()=>Object.fromEntries(Array.from({length:100},(_,i)=>[`f${i}`, '']));
for(let i=0;i<4;i++)stress.fixtures.push({id:id(),schemaId:stress.schemas[0].id,value:payload()});
let remaining=2097152-1024-measure(stress).bytes;
for(const f of stress.fixtures)for(const key of Object.keys(f.value)){const add=Math.min(2000,Math.max(0,remaining));f.value[key]='x'.repeat(add);remaining-=add;}
report.stress={...measure(stress),...inventory(stress),remainingTo2MiB:2097152-measure(stress).bytes,recipe:'100 unmodeled elements, 100 schemas x 100 fields, bounded string fixtures; recreated by this script'};

// Trace rows are synthetic encoding specimens, not observed events or qualifying evidence.
const trace=Array.from({length:100000},(_,sequence)=>({id:`${uuid(20000)}:${sequence}`,sequence,rootId:`${uuid(20001)}:0`,journeyId:uuid(20002),parentId:sequence?`${uuid(20000)}:${sequence-1}`:null,elementId:uuid(20003),portId:uuid(20004),kind:'dispatch',code:'synthetic-sizing',payloadRef:'a'.repeat(64),atMs:sequence,outcome:null}));
report.syntheticTrace={rows:trace.length,...measure(trace),byteCeiling:16777216,withinByteCeiling:measure(trace).bytes<=16777216,note:'Row count and byte cap are simultaneous bounds; reaching either stops incomplete. Payload-table bytes are additional.'};

// A legal incomplete-work recovery inventory, without fabricated commit/run evidence.
const combined=JSON.parse(readFileSync(join(directory,'combined.json'),'utf8'));const snapshot=measure(combined).sha256;
const project={id:uuid(30000),title:'Synthetic checkpoint history',mainBranchId:uuid(30001),initialSnapshotId:snapshot,createdAt:0,updatedAt:100,branches:Array.from({length:100},(_,i)=>({id:uuid(30001+i),label:i?`Draft ${i}`:'main',state:'open',headCommitId:null,workingSnapshotId:snapshot,workingRevision:0,createdAt:0})),snapshots:[{id:snapshot,document:combined}],commits:[],publications:[],checkpoints:Array.from({length:100},(_,i)=>({id:uuid(31000+i),snapshotId:snapshot,sourceBranchId:uuid(30002),label:`Checkpoint ${i}`,actor:{actorId:uuid(32000),kind:'local-human',displayName:'Sizing fixture'},createdAt:i})),runs:[],parts:[]};
const envelope={format:'system-studio',version:9,project};
assert(depth(envelope)<=40,'Transfer raw nesting');
assert(containers(envelope)<=100000,'Transfer container count');
report.syntheticHistory={...measure(envelope),rawDepth:depth(envelope),containers:containers(envelope),branches:100,checkpoints:100,commits:0,runs:0,note:'Checkpoint/history serialization only. No synthetic passing evidence or executed results.'};
report.scriptSha256=hash(readFileSync(fileURLToPath(import.meta.url),'utf8'));
process.stdout.write(JSON.stringify(report,null,2)+'\n');
