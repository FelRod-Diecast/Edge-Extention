const $=id=>document.getElementById(id);
async function send(action,extra={}){return chrome.runtime.sendMessage({action,...extra})}
function card(product,selected){
  const div=document.createElement("div");div.className="card";
  const label=document.createElement("label");label.className="watch";
  const cb=document.createElement("input");cb.type="checkbox";cb.checked=Boolean(selected);
  cb.addEventListener("change",async()=>{await send("setAssistance",{enabled:cb.checked,product});await render()});
  label.append(cb,document.createTextNode(" Need checkout assistance"));
  const title=document.createElement("div");title.className="title";title.textContent=product.title||product.handle;
  const meta=document.createElement("div");meta.className="meta";meta.textContent="Handle: "+product.handle+" • Variant: "+(product.variantId||"resolve when live");
  const row=document.createElement("div");row.className="row";
  const status=document.createElement("span");status.className="status";status.textContent=selected?.status||"NOT WATCHED";
  const test=document.createElement("button");test.className="small";test.textContent="Test assistant";test.addEventListener("click",()=>send("testAssistant",{product}));
  row.append(status,test);div.append(label,title,meta,row);return div;
}
async function render(){
  const [state,candidates]=await Promise.all([send("getState"),send("getCandidates")]);
  const map=Object.fromEntries((state?.products||[]).map(p=>[p.handle,p]));
  const selected=$("selected");selected.innerHTML="";
  const watched=Object.values(map);
  if(!watched.length)selected.textContent="No products selected yet.";
  else watched.forEach(p=>selected.appendChild(card(p,p)));
  const box=$("candidates");box.innerHTML="";
  const list=(candidates?.products||[]).filter(p=>!map[p.handle]);
  if(!list.length)box.textContent="No RLC candidates discovered yet. Try Refresh.";
  else list.slice(0,60).forEach(p=>box.appendChild(card(p,null));
}
async function refreshAll(){
  $("refresh").textContent="Refreshing...";
  await send("discover");
  await send("checkNow");
  $("refresh").textContent="Refresh";
  await render();
}
$("refresh").addEventListener("click",refreshAll);
$("checkNow").addEventListener("click",async()=>{$("checkNow").textContent="Checking...";await send("checkNow");$("checkNow").textContent="Check selected now";await render()});
render();