export function compareRncpFolios(a: {folio:string;id?:string}, b: {folio:string;id?:string}) {
  const an = /^RNCP([0-9]+)$/.exec(a.folio), bn = /^RNCP([0-9]+)$/.exec(b.folio);
  if (an && bn) { const x=BigInt(an[1]),y=BigInt(bn[1]); if(x!==y)return x>y?-1:1; }
  else if(an||bn)return an?-1:1;
  return b.folio.localeCompare(a.folio,"es",{numeric:true}) || (a.id??"").localeCompare(b.id??"");
}
