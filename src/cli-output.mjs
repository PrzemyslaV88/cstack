import {json} from './util.mjs';
import {stripVTControlCharacters} from 'node:util';
export const html = value => plain(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const plain = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
  char => char === '\r' ? '\\r' : `\\x${char.codePointAt(0).toString(16).padStart(2,'0')}`);
export function cleanDisplay(value){if(typeof value==='string')return plain(value);if(Array.isArray(value))return value.map(cleanDisplay);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[plain(k),cleanDisplay(v)]));return value;}
export function renderResult(value, format='markdown') {
  value=cleanDisplay(value);
  if(format==='json') return json(value);
  if(format==='jsonl') return JSON.stringify({kind:'result',...value})+'\n';
  return value.markdown || Object.entries(value).filter(([k])=>k!=='markdown').map(([k,v])=>`${k.replaceAll('_',' ')}: ${plain(typeof v==='object'?JSON.stringify(v):v)}`).join('\n')+'\n';
}
export function errorResult(error) {
  return {status:'ERROR',code:error.code || 'INVALID',message:plain(error.message),...(error.review?{review:error.review}:{}),next_action:error.next_action || 'Correct the stated input or prerequisite and repeat this command.'};
}
