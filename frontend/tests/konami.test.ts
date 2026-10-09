import {expect,it} from 'vitest';
import {KonamiSequence} from '../src/ui/konami';
const keys=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
it('recognizes the full sequence and consumes it without consuming ordinary keys',()=>{
  const sequence=new KonamiSequence();
  expect(sequence.push('a')).toEqual({consume:false,complete:false});
  keys.forEach((key,index)=>expect(sequence.push(key)).toEqual({consume:true,complete:index===9}));
  expect(sequence.push('a').complete).toBe(false);
});
it('resets after mistakes and allows an overlapping restart',()=>{
  const sequence=new KonamiSequence();
  sequence.push('ArrowUp');sequence.push('ArrowUp');
  expect(sequence.push('ArrowLeft').consume).toBe(false);
  sequence.push('ArrowUp');
  for(const key of keys.slice(0,-1))expect(sequence.push(key).complete).toBe(false);
  expect(sequence.push('A').complete).toBe(true);
});
it('clears an interrupted sequence',()=>{
  const sequence=new KonamiSequence();
  keys.slice(0,8).forEach(key=>sequence.push(key));sequence.reset();
  expect(sequence.push('b').consume).toBe(false);
  expect(sequence.push('a').complete).toBe(false);
});
