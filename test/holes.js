// Drawn holes (Holes tool, c = -2) on the Nothing and the iPhone 17 Pro, with beyond-the-edge pieces: manifold.
//   node test/holes.js
const fs=require("fs"),R=require("path").join(__dirname,"..")+"/";
const G=require(R+"src/geo.js");const html=fs.readFileSync(R+"src/index.src.html","utf8");const window={};eval(fs.readFileSync(R+"src/phones.js","utf8"));
const S0=eval("("+html.match(/const DEFAULT_SPEC = (\{[\s\S]*?\n\});/)[1]+")"),D=eval("("+html.match(/const DEFAULT_DESIGN = (\{[\s\S]*?\n\});/)[1]+")");
function badEdges(parts){const xml=new TextDecoder().decode(G.to3MF(parts,'t'));let bad=0,names=[];
 for(const [, name, m] of xml.matchAll(/<object id="\d+" name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)){const e=new Map();
  for(const x of m.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){const t=[+x[1],+x[2],+x[3]];for(let j=0;j<3;j++){const p=t[j],q=t[(j+1)%3],k=p<q?p+','+q:q+','+p;const r=e.get(k)||[0,0];r[p<q?0:1]++;e.set(k,r);}}
  let b=0;for(const [f,r] of e.values()) if(f!==1||r!==1) b++; if(b) names.push(name+":"+b); bad+=b;}
 return [bad,names];}
for(const S of [S0, Object.assign({},S0,window.PHONES.find(x=>x.name=="iPhone 17 Pro").spec)]){
const W=S.width,L=S.length;
const strokes=[{c:0,w:8,pts:[[-5,90],[W+5,100]]},{c:-2,w:6,pts:[[15,80],[W-15,110]]},{c:-2,w:4,pts:[[-10,130],[20,140]]},{c:1,w:5,pts:[[W/2,60],[W/2,150]]},{c:-2,w:3,pts:[[W/2,70]]}];
for(const [mode,caseStyle] of [["inlay","plain"],["inlay","extrude"],["relief","stripes"],["relief","plain"]]){
  const d={...D,strokes,mode,caseStyle,beyond:true,beyondDepth:5,inkHeights:[1,2,0]};
  const ps=G.buildPrintSet(S,d).parts;const [bad,n]=badEdges(ps);if(bad) process.exitCode=1;
  console.log(S.phone,mode,caseStyle,ps.length,"parts bad",bad,n.join(" "));
}}
