import './jevDebug.css';

export class JevDebug {
  private button = document.createElement('button');
  private dialog = document.createElement('dialog');
  private output = document.createElement('pre');
  private enabled = false;
  private generation = 0;

  constructor(private gameId:()=>string|null) {
    this.button.id='jev-debug-button';this.button.type='button';this.button.textContent='Jev JSON';this.button.hidden=true;
    document.getElementById('spincontrols')!.after(this.button);
    this.dialog.id='jev-debug';this.dialog.setAttribute('aria-label','Jev JSON exchanges');
    const title=document.createElement('h2');title.textContent='Jev JSON exchanges';
    const note=document.createElement('p');note.textContent='Raw requests and responses captured while developer access is enabled. Each exchange includes the selected shot plan. Refresh after a shot to see new exchanges.';
    const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh';refresh.onclick=()=>void this.refresh();
    const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>this.dialog.close();
    this.dialog.append(title,note,refresh,close,this.output);document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.generation++;this.output.textContent='';this.button.focus();});
    this.button.onclick=()=>{this.dialog.showModal();void this.refresh();};
  }

  setEnabled(enabled:boolean):void {
    this.enabled=enabled;this.button.hidden=!enabled;
    if(!enabled){this.generation++;this.dialog.close();this.output.textContent='';}
  }

  private async refresh():Promise<void> {
    const generation=++this.generation, id=this.gameId();
    if(!this.enabled)return;
    if(!id){this.output.textContent='Start or resume a Jev game to view its exchanges.';return;}
    this.output.textContent='Loading…';
    try {
      const response=await fetch(`/api/opponents/jev/games/${encodeURIComponent(id)}/debug`,{cache:'no-store'});
      const body=await response.json();
      if(!response.ok)throw new Error(body.detail??'Unable to load Jev exchanges.');
      if(generation!==this.generation||!this.enabled)return;
      this.output.textContent=JSON.stringify(body,null,2);
    } catch(error) {
      if(generation===this.generation&&this.enabled)this.output.textContent=error instanceof Error?error.message:'Unable to load Jev exchanges.';
    }
  }
}
