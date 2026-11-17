import type { RncpDraftInput } from "@/lib/rncp-data";
export interface PdfInitialPhoto {name:string;dataUrl:string;width:number;height:number;}
export interface RncpPdfInput {values:RncpDraftInput;folio?:string;supplierName?:string;supplierCode?:string;siteName?:string;status:string;photos:PdfInitialPhoto[]; documentId?:string; documentDate?:string; actions?:Array<{description:string;responsible:string|null;dueDate:string|null;status:string;executedAt:string|null;evidence:Array<{name:string;sha256:string}>}>;}
export function fitInitialPhoto(width:number,height:number,maxWidth:number,maxHeight:number){const scale=Math.min(maxWidth/width,maxHeight/height);return{width:width*scale,height:height*scale};}
const show=(v:unknown)=>String(v??"").trim()||"No registrado";
export async function buildRncpPdf(input:RncpPdfInput,logo?:string){
 const {jsPDF}=await import("jspdf");const doc=new jsPDF({unit:"mm",format:"a4",compress:true});const margin=12,w=186;let y=48;
 if(input.documentId)doc.setFileId(input.documentId);if(input.documentDate)doc.setCreationDate(new Date(input.documentDate));
 const header=()=>{doc.setDrawColor(30);doc.setLineWidth(.3);doc.setFont("helvetica","normal");doc.rect(margin,10,w,30);doc.line(57,10,57,40);doc.line(143,10,143,40);
  if(logo){const image=doc.getImageProperties(logo),fit=fitInitialPhoto(image.width,image.height,39,22);doc.addImage(logo,"JPEG",12+(45-fit.width)/2,10+(30-fit.height)/2,fit.width,fit.height);}else{doc.setFontSize(16);doc.text("Towell",18,26);}
  doc.setFont("helvetica","bold");doc.setFontSize(10);doc.text("Towell S.A. de C.V.",100,19,{align:"center"});doc.setFontSize(9);doc.text("Reporte de No Calidad Proveedores",100,29,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(7);["Código: F-CA-25","Versión: 1","Aprobación: 04/07/2024","Revisión: 08/07/2024"].forEach((t,i)=>doc.text(t,145,16+i*6));
 };
 const next=()=>{doc.addPage();header();y=48;};header();
 const pair=(a:string,av:unknown,b:string,bv:unknown)=>{const values=[doc.splitTextToSize(show(av),88),doc.splitTextToSize(show(bv),88)] as string[][];const h=12+Math.max(values[0].length,values[1].length)*4;
  if(h>170){section(a,av);section(b,bv);return;}if(y+h>265)next();[a,b].forEach((label,i)=>{const x=margin+i*w/2;doc.rect(x,y,w/2,h);doc.setFont("helvetica","bold");doc.setFontSize(8);doc.text(label,x+2,y+5);doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(values[i],x+2,y+11);});y+=h;
 };
 const section=(label:string,value:unknown)=>{let lines=doc.splitTextToSize(show(value),w-6) as string[];let continued=false;while(lines.length){if(y+24>265)next();const room=Math.max(1,Math.floor((265-y-12)/4.5)),part=lines.slice(0,room);lines=lines.slice(room);doc.setFillColor(224,236,245);doc.rect(margin,y,w,8,"FD");doc.setFont("helvetica","bold");doc.setFontSize(9);doc.text(label+(continued?" (continuación)":""),margin+3,y+5);const h=part.length*4.5+7;doc.rect(margin,y+8,w,h);doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(part,margin+3,y+14);y+=h+10;continued=true;}};
 pair("Folio de RNCP",input.folio??"SIN FOLIO - VISTA PREVIA","Estado del reporte",input.status==="draft"?"BORRADOR":"Registrado; comunicación por separado");
 pair("Fecha de reporte",input.values.reportDate,"Número de proveedor",input.supplierCode);
 pair("Proveedor",input.supplierName,"Sucursal",input.siteName);
 pair("¿Cuál es el defecto?",input.values.findingType,"¿Qué producto se detectó?",input.values.materialOrService);
 pair("¿Dónde se detectó?","No registrado","¿Qué lote se detectó?","No registrado");
 pair("¿Quién lo detectó?","No registrado","¿Cuánto afectó? - Cantidad rechazada",input.values.rejectedQuantity);
 section("Clasificación",input.values.classification);
 section("Responsable de seguimiento",input.values.responsibleName);
 section("Evidencias y descripción del fallo",input.values.description);
 section("Acciones inmediatas para contener (Towell)",input.values.immediateDisposition);
 section("Fotografías del defecto inicial",input.photos.length?input.photos.length+" fotografías. Anexos en el orden guardado o seleccionado.":"Sin fotografías del defecto inicial.");
 pair("Realizó","No registrado","Autorizó","No registrado");
 for(let i=0;i<input.photos.length;i++){const p=input.photos[i];next();section("Evidencias del defecto inicial - fotografía "+(i+1)+" de "+input.photos.length,p.name);const box={x:margin,y:y+3,w,height:Math.min(190,264-y-10)};const fit=fitInitialPhoto(p.width,p.height,box.w-4,box.height-4);doc.rect(box.x,box.y,box.w,box.height);doc.addImage(p.dataUrl,p.dataUrl.startsWith("data:image/png")?"PNG":"JPEG",box.x+(box.w-fit.width)/2,box.y+(box.height-fit.height)/2,fit.width,fit.height,undefined,"FAST");}
 for(const action of input.actions??[]) {next();section("Seguimiento posterior - acción correctiva",action.description);pair("Responsable",action.responsible,"Fecha compromiso",action.dueDate);pair("Estado registrado",action.status,"Conclusión registrada",action.executedAt);section("Evidencias posteriores vinculadas",action.evidence.map(e=>e.name+" | SHA-256 "+e.sha256).join("\n")||"Sin evidencia vinculada");}
 const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.text("F-CA-25 | "+(input.folio??"Vista previa")+" | Página "+i+" de "+pages,margin,282);doc.text("Generar o descargar este PDF no notifica al proveedor ni inicia el plazo de respuesta.",margin,287);}
 return{bytes:new Uint8Array(doc.output("arraybuffer")),pages};
}
export async function photoForPdf(name:string,blob:Blob):Promise<PdfInitialPhoto>{
 const url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();const fit=fitInitialPhoto(image.naturalWidth,image.naturalHeight,Math.min(3000,image.naturalWidth),Math.min(3000,image.naturalHeight)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(fit.width));canvas.height=Math.max(1,Math.round(fit.height));const context=canvas.getContext("2d");if(!context)throw new Error("No se pudo preparar la fotografía.");context.fillStyle="white";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return{name,dataUrl:canvas.toDataURL("image/jpeg",.94),width:canvas.width,height:canvas.height};}finally{URL.revokeObjectURL(url);}
}
export async function loadRncpLogo(){const r=await fetch("/brand/towell-logo.jpg");if(!r.ok)throw new Error("No se pudo cargar el logotipo oficial; no se generó un PDF incompleto.");const b=new Uint8Array(await r.arrayBuffer());let binary="";for(const n of b)binary+=String.fromCharCode(n);return"data:image/jpeg;base64,"+btoa(binary);}
