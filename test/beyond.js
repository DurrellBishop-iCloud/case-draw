// Drawing beyond the edge: pieces outside the case outline, in every mode and depth, must export manifold.
//   node test/beyond.js
const fs=require("fs"),R=require("path").join(__dirname,"..")+"/";
const G=require(R+"src/geo.js");const html=fs.readFileSync(R+"src/index.src.html","utf8");
const S=eval("("+html.match(/const DEFAULT_SPEC = (\{[\s\S]*?\n\});/)[1]+")"),D=eval("("+html.match(/const DEFAULT_DESIGN = (\{[\s\S]*?\n\});/)[1]+")");
function badEdges(parts){const xml=new TextDecoder().decode(G.to3MF(parts,'t'));let bad=0,names=[];
 for(const [, name, m] of xml.matchAll(/<object id="\d+" name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)){const e=new Map();
  for(const x of m.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){const t=[+x[1],+x[2],+x[3]];for(let j=0;j<3;j++){const p=t[j],q=t[(j+1)%3],k=p<q?p+','+q:q+','+p;const r=e.get(k)||[0,0];r[p<q?0:1]++;e.set(k,r);}}
  let b=0;for(const [f,r] of e.values()) if(f!==1||r!==1) b++; if(b) names.push(name+":"+b); bad+=b;}
 return [bad,names];}
const W=S.width,L=S.length;
const strokes=[{c:0,w:8,pts:[[-15,50],[20,60]]},{c:1,w:6,pts:[[W*0.5,L*0.7],[W+14,L*0.72],[W+14,L*0.9]]},{c:2,w:5,pts:[[-20,L*0.3],[-12,L*0.35]]},{c:0,fill:[[[[20,L-4],[50,L-4],[50,L+10],[20,L+10],[20,L-4]]]]}];
for(const [mode,caseStyle] of [["inlay","plain"],["inlay","extrude"],["relief","stripes"],["relief","plain"]]){
 for(const depth of [1,4,7,12]){
  const d={...D,strokes,mode,caseStyle,beyond:true,beyondDepth:depth,inkHeights:[1,2,0]};
  const ps=G.buildPrintSet(S,d).parts;const [bad,n]=badEdges(ps);
  if(bad) process.exitCode=1;
  console.log(mode,caseStyle,depth,ps.map(p=>p.name).filter(x=>/beyond/.test(x)).join(","),"bad",bad,n.join(" "));
 }}
const c=G.buildCoupon(S,{...D,strokes,beyond:true,beyondDepth:6},32);const cb=badEdges(c.parts);if(cb[0]) process.exitCode=1;console.log("coupon bad",cb[0]);
console.log(process.exitCode?"FAIL":"OK: beyond-the-edge pieces export clean");
