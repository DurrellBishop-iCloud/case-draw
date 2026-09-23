// Magnet ring (MagSafe size) in the back: the surround part and the keepout must export manifold in every mode.
//   node test/ring.js
const fs=require("fs"),R=require("path").join(__dirname,"..")+"/";
const G=require(R+"src/geo.js");const html=fs.readFileSync(R+"src/index.src.html","utf8");const window={};eval(fs.readFileSync(R+"src/phones.js","utf8"));
const B=eval("("+html.match(/const DEFAULT_SPEC = (\{[\s\S]*?\n\});/)[1]+")"),D=eval("("+html.match(/const DEFAULT_DESIGN = (\{[\s\S]*?\n\});/)[1]+")");
function badEdges(parts){const xml=new TextDecoder().decode(G.to3MF(parts,'t'));let bad=0,n=[];
 for(const [, name, m] of xml.matchAll(/<object id="\d+" name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)){const e=new Map();
  for(const x of m.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){const t=[+x[1],+x[2],+x[3]];for(let j=0;j<3;j++){const p=t[j],q=t[(j+1)%3],k=p<q?p+','+q:q+','+p;const r=e.get(k)||[0,0];r[p<q?0:1]++;e.set(k,r);}}
  let b=0;for(const [f,r] of e.values()) if(f!==1||r!==1) b++; if(b) n.push(name+":"+b); bad+=b;}
 return [bad,n];}
const s=Object.assign({},B,window.PHONES.find(x=>x.name=="iPhone 17 Pro").spec);
const W=s.width,L=s.length;
const strokes=[{c:0,w:10,pts:[[8,60],[W-8,120]]},{c:1,w:6,pts:[[W/2,55],[W/2,140]]},{c:2,w:14,pts:[[20,95],[55,95]]}];
const ring={on:true,od:55,id:45,t:0.64,lip:1,fit:0.3,cx:W/2,cy:L-71.5};   // Apple's magnets: 71.5 mm up from the bottom
for(const [mode,style] of [["inlay","plain"],["relief","plain"],["relief","stripes"],["inlay","extrude"]]){
  const d={...D,strokes,mode,caseStyle:style,ring,inkHeights:[0.8,1.6,0]};
  const set=G.buildPrintSet(s,d);const [bad,n]=badEdges(set.parts);
  const rp=set.parts.find(p=>/Magnet/.test(p.name));
  let z=[9,-9];if(rp)for(let i=2;i<rp.mesh.v.length;i+=3){z[0]=Math.min(z[0],rp.mesh.v[i]);z[1]=Math.max(z[1],rp.mesh.v[i+1-1+1]);}
  let zmin=9,zmax=-9;if(rp)for(let i=2;i<rp.mesh.v.length;i+=3){zmin=Math.min(zmin,rp.mesh.v[i]);zmax=Math.max(zmax,rp.mesh.v[i]);}
  console.log(mode,style,"parts",set.parts.length,"ring part z",zmin.toFixed(2),zmax.toFixed(2),"bad",bad,n.join(" "));
  if(bad) process.exitCode=1;
}
console.log("problem when off-phone:", G.ringProblem(s,{...D,ring:{...ring,cx:5,cy:10}}));
console.log("problem over camera:", G.ringProblem(s,{...D,ring:{...ring,cy:30}}));
const fit=G.ringProblem(s,{...D,ring});if(fit) process.exitCode=1;
console.log("problem as placed:", JSON.stringify(fit));
console.log(process.exitCode?"FAIL":"OK: magnet ring exports clean and fits");
