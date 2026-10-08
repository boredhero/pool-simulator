import releases from '../../../changelog.json';

export function setupChangelog() {
  const button=document.getElementById('version') as HTMLButtonElement;
  const dialog=document.getElementById('changelog') as HTMLDialogElement;
  const content=document.getElementById('changelog-content')!;
  button.textContent=`v${releases[0].version}`;
  for(const release of releases) {
    const section=document.createElement('section');
    const title=document.createElement('h3');title.textContent=`v${release.version} · ${release.title}`;
    const date=document.createElement('time');date.dateTime=release.date;date.textContent=release.date;
    const list=document.createElement('ul');
    for(const change of release.changes){const item=document.createElement('li');item.textContent=change;list.append(item);}
    section.append(title,date,list);content.append(section);
  }
  button.addEventListener('click',()=>dialog.showModal());
  document.getElementById('changelog-close')!.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>button.focus());
}
