"use client";
import {Bell} from "lucide-react";
import {useCallback,useEffect,useState} from "react";

type Item={id:string;title:string;message:string;action_url:string|null;read_at:string|null};
export function NotificationInbox() {
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState<Item[]>([]);
  const [unread,setUnread]=useState(0);
  const [error,setError]=useState("");
  const refresh=useCallback(async()=>{
    try { const response=await fetch("/api/notifications",{cache:"no-store"}); if(!response.ok) throw Error(); const data=await response.json();setItems(data.items);setUnread(data.unread);setError(""); }
    catch {setError("No fue posible consultar notificaciones.");}
  },[]);
  useEffect(()=>{const first=setTimeout(()=>void refresh(),0);const timer=setInterval(()=>void refresh(),30000);return()=>{clearTimeout(first);clearInterval(timer);};},[refresh]);
  async function read(item:Item,navigate:boolean) {
    const response=await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id})});
    if(!response.ok){setError("No fue posible marcar como leída.");return;}
    await refresh();
    if(navigate && item.action_url?.startsWith("/") && !item.action_url.startsWith("//")) window.location.assign(item.action_url);
  }
  return <div className="notification-wrap">
    <button className="icon-button notification-button" type="button" title="Notificaciones" aria-expanded={open} onClick={()=>{setOpen(!open);void refresh();}}><Bell size={19}/>{unread>0?<span aria-label={`${unread} notificaciones sin leer`}>{unread}</span>:null}</button>
    {open?<div className="notification-popover"><div className="popover-heading"><strong>Notificaciones</strong><small>{unread} sin leer</small></div>{error?<p role="alert">{error}</p>:null}{items.map(item=><div key={item.id}><button type="button" onClick={()=>void read(item,true)}><span><strong>{item.read_at?"":"● "}{item.title}</strong><small>{item.message}</small></span></button>{!item.read_at?<button type="button" onClick={()=>void read(item,false)}>Marcar como leída</button>:null}</div>)}{items.length===0&&!error?<div className="notification-empty">Sin notificaciones</div>:null}</div>:null}
  </div>;
}
