const sequence=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

/** Recognize a sequence while preserving overlapping prefixes after mistakes. */
export class KonamiSequence {
  private keys:string[]=[];
  reset(){this.keys=[];}
  push(key:string):{consume:boolean;complete:boolean}{
    key=key.length===1?key.toLowerCase():key;
    this.keys.push(key);
    while(this.keys.length&&!this.keys.every((value,index)=>sequence[index]===value))this.keys.shift();
    const complete=this.keys.length===sequence.length,consume=this.keys.length>0;
    if(complete)this.reset();
    return {consume,complete};
  }
}
