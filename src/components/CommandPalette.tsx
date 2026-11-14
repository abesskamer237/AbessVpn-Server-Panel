import {useEffect,useMemo,useRef,useState,type ComponentType} from 'react';
import {CornerDownLeft,Search} from 'lucide-react';

export type Command={id:string;group:string;label:string;hint?:string;icon:ComponentType<{size?:number}>;keywords?:string;run:()=>void};

/** Keyboard-first launcher (Ctrl/⌘+K): navigation, actions and record search. */
export function CommandPalette({open,onClose,commands}:{open:boolean;onClose:()=>void;commands:Command[]}){
  const [query,setQuery]=useState(''),[active,setActive]=useState(0);
  const input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open){setQuery('');setActive(0);window.setTimeout(()=>input.current?.focus(),0)}},[open]);
  const results=useMemo(()=>{
    const q=query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const norm=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const found=!q?commands.filter(c=>c.group!=='Clients'&&c.group!=='Revendeurs'):commands.filter(c=>norm(c.label+' '+(c.keywords||'')+' '+(c.hint||'')).includes(q));
    return found.slice(0,40);
  },[commands,query]);
  useEffect(()=>{setActive(0)},[query]);
  useEffect(()=>{list.current?.querySelector('.cmdk-item.active')?.scrollIntoView({block:'nearest'})},[active]);
  if(!open)return null;
  const run=(c?:Command)=>{if(!c)return;onClose();c.run()};
  let lastGroup='';
  return <div className="cmdk-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="cmdk" role="dialog" aria-label="Palette de commandes">
      <div className="cmdk-input"><Search size={16}/>
        <input ref={input} value={query} placeholder="Rechercher une page, une action, un client…" aria-label="Rechercher une commande"
          onChange={e=>setQuery(e.target.value)}
          onKeyDown={e=>{
            if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(results.length-1,i+1))}
            else if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1))}
            else if(e.key==='Enter'){e.preventDefault();run(results[active])}
            else if(e.key==='Escape'){e.preventDefault();onClose()}
          }}/>
        <kbd>Échap</kbd>
      </div>
      <div className="cmdk-list" ref={list}>
        {!results.length&&<div className="cmdk-empty">Aucun résultat pour « {query} »</div>}
        {results.map((c,i)=>{
          const header=c.group!==lastGroup?<div className="cmdk-group" key={'g'+c.group}>{c.group}</div>:null;lastGroup=c.group;
          return [header,<button key={c.id} className={'cmdk-item'+(i===active?' active':'')} onMouseMove={()=>setActive(i)} onClick={()=>run(c)}>
            <c.icon size={15}/><span>{c.label}</span>{c.hint&&<span className="table-secondary" style={{marginLeft:6}}>{c.hint}</span>}
            {i===active&&<kbd><CornerDownLeft size={10}/></kbd>}
          </button>];
        })}
      </div>
      <div className="cmdk-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> naviguer</span><span><kbd>↵</kbd> ouvrir</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> basculer</span></div>
    </div>
  </div>;
}
