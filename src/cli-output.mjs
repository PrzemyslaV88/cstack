import {json} from './util.mjs';
export const html = value => plain(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const plain = value => String(value ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
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
