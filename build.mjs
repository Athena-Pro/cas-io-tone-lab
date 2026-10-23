import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=new URL('./',import.meta.url);
let [html,css,engine,analysis,automation,cellAudio,audioFile,palette,app]=await Promise.all(['index.html','style.css','engine.js','harmonic-grid.js','grid-auto.js','cell-audio.js','audio-file.js','palette.js','app.js'].map(p=>readFile(new URL(p,root),'utf8')));
engine=engine.replace(/^export /gm,'');
const inline=source=>source.replace(/^import .* from '\.\/[\w-]+\.js';\r?\n/gm,'').replace(/^export /gm,'');
const script=[engine,inline(analysis),inline(automation),inline(cellAudio),inline(audioFile),inline(palette),inline(app)].join('\n').replace(/<\/script/gi,'<\\/script');
// A replacement callback preserves literal dollar signs in selector helpers.
html=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="app.js"></script>',()=>`<script type="module">${script}</script>`);
const bundledScript=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if(!bundledScript||bundledScript!==script)throw new Error('Packaged script differs from source');
const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:bundledScript,encoding:'utf8'});
if(check.status!==0)throw new Error(check.stderr||'Bundled JavaScript syntax check failed');
await mkdir(new URL('dist/',root),{recursive:true});
for(const name of ['index.html','CAS-I-O-TONE.html']){
  const target=new URL(`dist/${name}`,root);
  await writeFile(target,html);
  console.log(`Standalone instrument: ${fileURLToPath(target)} (${Buffer.byteLength(html)} bytes)`);
}
