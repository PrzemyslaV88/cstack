import {plain} from './cli-output.mjs';
import {redact} from './util.mjs';

function longestRun(text, character) {
  let longest=0,current=0;
  for(const value of text){if(value===character){current++;longest=Math.max(longest,current);}else current=0;}
  return longest;
}

export function markdownCode(value) {
  const text=plain(redact(value)).replace(/\r?\n/g,' '),fence='`'.repeat(Math.max(1,longestRun(text,'`')+1));
  const pad=text.startsWith('`')||text.endsWith('`')||text.startsWith(' ')||text.endsWith(' ')?' ':'';
  return fence+pad+text+pad+fence;
}

export function markdownBlock(value) {
  const text=plain(redact(value)),fence='`'.repeat(Math.max(3,longestRun(text,'`')+1));
  return `${fence}\n${text}\n${fence}`;
}
