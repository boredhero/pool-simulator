import './winner.css';

export interface WinPresentation { game:object; name:string; detail:string; action:string; note:string }

/** One celebration per completed rack. Authoritative results arrive after playback. */
export class WinnerDialog {
  private dialog=document.createElement('dialog');
  private shown:object|null=null;
  private busy=false;
  private animationTimer=0;
  constructor(private replay:()=>Promise<void>) {
    this.dialog.id='winnerdialog';this.dialog.setAttribute('aria-labelledby','winnertitle');
    this.dialog.innerHTML='<div class="winner-confetti" aria-hidden="true"></div><div class="winner-content"><span class="winner-eyebrow">Rack complete</span><div class="winner-eight" aria-hidden="true"><svg viewBox="0 0 40 40" focusable="false"><path d="M20 20C10 20 10 8 20 8C30 8 30 20 20 20C8 20 8 32 20 32C32 32 32 20 20 20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h2 id="winnertitle"></h2><p id="winnerdetail"></p><p id="winnernote"></p><p id="winnerstatus" role="status"></p><div class="winner-actions"><button id="winnerreplay" type="button"></button><button id="winnerclose" type="button">View table</button></div></div>';
    document.body.append(this.dialog);
    this.get('winnerclose').addEventListener('click',()=>this.dialog.close());
    this.dialog.addEventListener('keydown',e=>e.stopPropagation());
    this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
    this.dialog.addEventListener('close',()=>{this.clearConfetti();document.getElementById('game-canvas')?.focus();});
    this.get('winnerreplay').addEventListener('click',()=>void this.playAgain());
  }
  private get(id:string){return this.dialog.querySelector<HTMLElement>('#'+id)!;}
  sync(result:WinPresentation|null):void {
    if(!result){this.shown=null;if(this.dialog.open)this.dialog.close();return;}
    if(this.shown===result.game)return;
    // Do not stack over account, privacy, or welcome dialogs.
    if(document.querySelector('dialog[open]'))return;
    this.shown=result.game;
    this.get('winnertitle').textContent=`${result.name} wins!`;
    this.get('winnerdetail').textContent=result.detail;
    this.get('winnernote').textContent=result.note;
    this.get('winnerreplay').textContent=result.action;
    this.get('winnerstatus').textContent='';
    this.dialog.showModal();this.get('winnerreplay').focus();this.celebrate();
  }
  private async playAgain(){
    if(this.busy)return;this.busy=true;
    for(const button of this.dialog.querySelectorAll('button'))button.disabled=true;
    this.get('winnerstatus').textContent='';
    try {await this.replay();if(this.dialog.open)this.dialog.close();}
    catch(error){this.get('winnerstatus').textContent=error instanceof Error?error.message:'Could not start another game. Please try again.';}
    finally{this.busy=false;for(const button of this.dialog.querySelectorAll('button'))button.disabled=false;}
  }
  private clearConfetti(){clearTimeout(this.animationTimer);this.dialog.querySelector('.winner-confetti')!.replaceChildren();}
  private celebrate(){
    this.clearConfetti();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const box=this.dialog.querySelector<HTMLElement>('.winner-confetti')!;box.style.setProperty('--fall',`${this.dialog.clientHeight+40}px`);
    for(let i=0;i<56;i++){
      const piece=document.createElement('i');piece.className=i<12?'winner-spark':'winner-ribbon';piece.style.cssText=`--x:${(i*37)%100}%;--y:${18+(i*13)%38}%;--delay:${(i%9)*.06}s;--drift:${(i%2?1:-1)*(18+i%35)}px;--size:${5+i%5}px;--turn:${i%2?420:-360}deg;--color:${['#efcc7e','#b6d8a0','#fff0c8','#94cacc'][i%4]}`;box.append(piece);
    }
    this.animationTimer=window.setTimeout(()=>this.clearConfetti(),3200);
  }
}
