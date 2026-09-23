/** Rebuild against the CURRENT placement implementation, audit, then render. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const stageIndex=args.indexOf('--stage');
const stage=stageIndex>=0?args[stageIndex+1]:null;
if(stage && !/^[a-z0-9-]+$/i.test(stage))throw new Error('Stage must use letters, numbers and hyphens.');
const fixed=args.includes('--fixed-size');
const out=path.join(root,'reports/placement',fixed?`fixed-${stage||'current'}`:'');
const env={...process.env,PLACEMENT_REPORT_DIR:out,PLACEMENT_FIXED_SIZE:fixed?'1':'0'};
const renderArgs=args.filter((arg,i)=>!arg.startsWith('--')&&!(stageIndex>=0&&i===stageIndex+1));
mkdirSync(out,{recursive:true});
const temporary=path.join(out,'.placement-render-current.mjs');
const python=process.env.PLACEMENT_PYTHON||'python3';
try {
  await build({entryPoints:[path.join(root,'tools/placement-render.ts')],outfile:temporary,bundle:true,platform:'node',format:'esm',external:['three'],logLevel:'warning'});
  const audit=args.includes('--render-only')?{status:0}:spawnSync(process.execPath,[temporary],{cwd:root,stdio:'inherit',env});
  if(audit.status!==0)process.exitCode=audit.status||1;
  else if(!args.includes('--audit-only')) {
    const render=spawnSync(python,[path.join(root,'tools/placement-render.py'),...renderArgs],{cwd:root,stdio:'inherit',env});
    process.exitCode=render.status||0;
  }
} finally {try{unlinkSync(temporary);}catch{}}
