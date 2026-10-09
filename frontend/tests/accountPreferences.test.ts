import {describe,it,expect,vi} from 'vitest';
import {AccountPreferences} from '../src/ui/accountPreferences';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(){
  const values=new Map<string,string>([['pool:felt','#123456']]);
  const storage={getItem:vi.fn((key:string)=>values.get(key)??null),setItem:vi.fn((key:string,value:string)=>values.set(key,value))};
  return {store:new AccountPreferences(()=>storage as unknown as Storage),storage};
}
describe('account settings',()=>{
  it('keeps guest storage separate and hydrates account, reload, and logout defaults',async()=>{
    const {store,storage}=setup();const save=vi.fn(async()=>({id:'a'}));
    expect(store.getItem('pool:felt')).toBe('#123456');
    store.setItem('pool:wood','#234567');expect(storage.setItem).toHaveBeenCalledOnce();
    const changed=vi.fn();store.subscribe(changed);
    store.bind({id:'a',settings:{'pool:felt':'#abcdef'}},save);
    expect(store.getItem('pool:felt')).toBe('#abcdef');expect(store.getItem('pool:wood')).toBeNull();
    store.setItem('pool:felt','#654321');await tick();
    expect(save).toHaveBeenCalledWith({settings:{'pool:felt':'#654321'}});expect(storage.setItem).toHaveBeenCalledOnce();
    store.bind({id:'a',settings:{'pool:felt':'#654321'}},save);expect(store.getItem('pool:felt')).toBe('#654321');
    store.bind(null,save);expect(store.getItem('pool:felt')).toBe('#123456');expect(changed).toHaveBeenCalled();
  });
  it('coalesces changes and preserves later edits while a save is in flight',async()=>{
    const {store}=setup();let done!:(value:{id:string})=>void;
    const save=vi.fn(()=>new Promise<{id:string}>(resolve=>{done=resolve;}));
    store.bind({id:'a'},save);store.setItem('pool:felt','#123456');store.setItem('pool:wood','#654321');await tick();
    expect(save).toHaveBeenCalledTimes(1);
    store.setItem('pool:felt','#abcdef');store.bind({id:'a',settings:{'pool:felt':'#123456'}},save);
    expect(store.getItem('pool:felt')).toBe('#abcdef');done({id:'a'});await tick();
    expect(save).toHaveBeenLastCalledWith({settings:{'pool:felt':'#abcdef'}});done({id:'a'});await tick();
  });
  it('does not carry a failed old-account request into a newly signed-in account',async()=>{
    const {store}=setup();let reject!:(error:Error)=>void;
    store.bind({id:'a'},()=>new Promise((_,r)=>{reject=r;}));store.setItem('pool:felt','#111111');await tick();
    const save=vi.fn(async()=>({id:'b'}));store.bind({id:'b',settings:{'pool:felt':'#222222'}},save);
    reject(new Error('offline'));await tick();expect(store.error).toBe('');expect(store.getItem('pool:felt')).toBe('#222222');expect(save).not.toHaveBeenCalled();
  });
  it('keeps failed changes for an explicit retry',async()=>{
    const {store}=setup();const save=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({id:'a'});
    store.bind({id:'a'},save);store.setItem('pool:fast-forward','1');await tick();expect(store.error).toContain('could not');
    await store.retry();expect(store.error).toBe('');expect(save).toHaveBeenCalledTimes(2);
  });
});
