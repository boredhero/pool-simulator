import './passwordControls.css';

/** Shared visibility and confirmation behavior for sign-in and password setup. */
export class PasswordControls {
  private password=document.getElementById('accountpassword') as HTMLInputElement;
  private confirmation=document.getElementById('accountpasswordconfirm') as HTMLInputElement;
  private fields:Array<{input:HTMLInputElement;button:HTMLButtonElement;label:string}>=[];
  constructor(){
    for(const [input,label] of [[this.password,'password'],[this.confirmation,'password confirmation']] as const){
      const wrapper=document.createElement('div');wrapper.className='password-field';input.before(wrapper);wrapper.append(input);
      const button=document.createElement('button');button.type='button';button.className='password-visibility';button.setAttribute('aria-controls',input.id);
      button.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/></svg>';
      const field={input,button,label};this.fields.push(field);wrapper.append(button);
      button.addEventListener('click',()=>{input.type=input.type==='password'?'text':'password';this.update(field);});
      input.addEventListener('input',()=>this.check());this.update(field);
    }
  }
  private update({input,button,label}:typeof this.fields[number]){
    const shown=input.type==='text';button.setAttribute('aria-pressed',String(shown));button.setAttribute('aria-label',`${shown?'Hide':'Show'} ${label}`);button.title=`${shown?'Hide':'Show'} ${label}`;
  }
  private check(){
    this.confirmation.setCustomValidity(!this.confirmation.disabled&&this.confirmation.value&&this.password.value!==this.confirmation.value?'Passwords do not match.':'');
  }
  setRequired(required:boolean){
    this.reset();document.getElementById('accountconfirmation')!.hidden=!required;
    this.confirmation.disabled=!required;this.confirmation.required=required;
  }
  validate():boolean {
    this.check();if(this.confirmation.disabled)return true;
    if(!this.confirmation.reportValidity()){this.confirmation.focus();return false;}return true;
  }
  reset(){
    for(const field of this.fields){field.input.value='';field.input.type='password';this.update(field);}
    this.confirmation.setCustomValidity('');
  }
}
