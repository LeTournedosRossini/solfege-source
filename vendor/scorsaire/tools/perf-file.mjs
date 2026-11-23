#!/usr/bin/env node
/*
 * Layout timings of a REAL Guitar Pro / Scorsaire file in Node (no browser): the first (cold) layout, the size of the SVG windows, then repeated single-note
 * entries by click (the same intent as the real gesture: `app.enterNoteAt`) with the milliseconds of each layout phase and the cache counters.
 *   taskset -c 0,1 node tools/perf-file.mjs "/path/to/file.gp5"      (2 cores at most: Jean's rule)
 * Add `--cpu-prof` to node to profile. Read only: the file is never written, and nothing is copied into the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const r = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src') + '/';
const file = process.argv[2];
if (!file) { console.error('usage: node tools/perf-file.mjs <file.gp5>'); process.exit(1); }
const glyphs=JSON.parse(fs.readFileSync(r+'glyphs/bravura-subset.json','utf8'));
const { importGuitarProBytes } = await import(r+'import/guitarpro.js'); const { createDocument } = await import(r+'model/document.js');
const { createScoreView } = await import(r+'view/score-view.js'); const { setStrict } = await import(r+'model/index.js');
const { createApplication } = await import(r+'ui/application.js'); const { buildSequence } = await import(r+'audio/sequence.js');
setStrict(false);
const bytes=new Uint8Array(fs.readFileSync(file));
const imp=await importGuitarProBytes(bytes); const work=imp.work;
const mv=work.movements[0];
console.log('measures',mv.masterbars.length,'tracks',mv.tracks.length,'staves',mv.tracks.reduce((n,t)=>n+t.staves.length,0), mv.tracks.map(t=>t.staves.map(s=>s.props?.staffType??'?').join('/')).join(' | '));
const doc=createDocument(work); const app=createApplication({doc});
const view=app.addView(createScoreView({id:'main',doc,glyphs,width:100000,staffSpace:8,margin:10}));
const T=(n,f)=>{const a=performance.now(); const v=f(); console.log(n.padEnd(34),(performance.now()-a).toFixed(0).padStart(6),'ms'); return v;};
const lay=T('layout (cold)',()=>view.layout()); console.log(JSON.stringify(view.timings()));
console.log('layout width px', Math.round(lay.width*8), 'systems', lay.systems.length);
// windows
const el=(s)=>(s.match(/</g)||[]).length/2;
for (const [label,pad] of [['full (3 x 1688)',1688],['full (3 x 2514)',2514],['narrow 0.25 (1688)',422],['narrow 0.25 (2514)',629]]) {
  const vis=label.includes('2514')?2514:1688; const a=2000; const b=a+vis+pad*(label.startsWith('full')?1:1);
  const x1=Math.max(0,a-pad), x2=a+vis+pad;
  const w=T('renderWindow '+label,()=>view.renderWindow(x1,x2)); console.log('   elements',Math.round(el(w.svg)),'KB',(w.svg.length/1024).toFixed(0));
}
// edit: enter a note on a score staff in the middle
const staff=mv.tracks.flatMap(t=>t.staves).find(s=>(s.props?.staffType??'score')==='score');
app.setNoteEntry({active:true});
for (const mi of [10,60,60,90,120,5]) {
  const l=view.layout(); const sys=l.systems[0]; const m=sys.measures.find(x=>x.index===mi); const st=sys.staves.find(s=>s.ref===staff.id);
  const hit=view.staffHit((m.x+m.width*0.5)*8+10,(sys.top+st.originY-2)*8+10,{preferredStaffId:staff.id});
  const t0=performance.now(); let res; try{res=app.enterNoteAt(hit);}catch(e){console.log('err',e.message);continue;} view.layout(); const dt=performance.now()-t0;
  console.log('edit m'+mi,res?.action,dt.toFixed(0)+'ms', JSON.stringify(view.timings()));
}
T('buildSequence',()=>buildSequence(doc.work));
