// Derive child markup from the pinned, unmodified upstream SVG files.
// Renderer icon() supplies exactly one root SVG; XML/root wrappers must not
// enter the child fragment or the HTML parser may swallow following text.
import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('../vendor/ant-design-icons/',import.meta.url);
const provenance=JSON.parse(await readFile(new URL('provenance.json',base),'utf8'));
const fragments={};
for(const entry of provenance.files){
  const raw=await readFile(new URL(entry.file,base),'utf8');
  const start=/<svg\b[^>]*>/i.exec(raw),end=raw.lastIndexOf('</svg>');
  if(!start||end<=start.index+start[0].length)throw Error(`Invalid SVG root: ${entry.file}`);
  const fragment=raw.slice(start.index+start[0].length,end).trim();
  if(!fragment||/<\/?svg\b|<\?xml|<!DOCTYPE/i.test(fragment))throw Error(`Expected only SVG children: ${entry.file}`);
  fragments[entry.file.replace(/\.svg$/,'')]=fragment;
}
await writeFile(new URL('icons.json',base),JSON.stringify(fragments,null,2)+'\n');
console.log(`Indexed ${Object.keys(fragments).length} pinned icon fragments; upstream SVG files unchanged.`);
