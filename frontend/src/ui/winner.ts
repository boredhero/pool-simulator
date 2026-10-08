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
    this.dialog.innerHTML='<div class="winner-confetti" aria-hidden="true"></div><div class="winner-content"><span class="winner-eyebrow">Rack complete</span><div class="winner-eight" aria-hidden="true">8</div><h2 id="winnertitle"></h2><p id="winnerdetail"></p><p id="winnernote"></p><p id="winnerstatus" role="status"></p><div class="winner-actions"><button id="winnerreplay" type="button"></button><button id="winnerclose" type="button">View table</button></div></div>';
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
    const box=this.dialog.querySelector('.winner-confetti')!;
    for(let i=0;i<38;i++){
      const piece=document.createElement('i');piece.style.cssText=`--x:${(i*37)%100}%;--delay:${(i%9)*.055}s;--turn:${i%2?360:-300}deg;--color:${['#eac77b','#b6d8a0','#f4e7c6','#94cacc'][i%4]}`;box.append(piece);
    }
    this.animationTimer=window.setTimeout(()=>this.clearConfetti(),2800);
  }
}
