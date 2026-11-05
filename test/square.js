// Square corners: the case is a rectangle round the phone, and still exports manifold in every mode.
//   node test/square.js
const fs=require("fs"),R=require("path").join(__dirname,"..")+"/";
const G=require(R+"src/geo.js");const html=fs.readFileSync(R+"src/index.src.html","utf8");const window={};eval(fs.readFileSync(R+"src/phones.js","utf8"));
const B=eval("("+html.match(/const DEFAULT_SPEC = (\{[\s\S]*?\n\});/)[1]+")"),D=eval("("+html.match(/const DEFAULT_DESIGN = (\{[\s\S]*?\n\});/)[1]+")");
function badEdges(parts){const xml=new TextDecoder().decode(G.to3MF(parts,'t'));let bad=0,n=[];
 for(const [, name, m] of xml.matchAll(/<object id="\d+" name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)){const e=new Map();
  for(const x of m.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){const t=[+x[1],+x[2],+x[3]];for(let j=0;j<3;j++){const p=t[j],q=t[(j+1)%3],k=p<q?p+','+q:q+','+p;const r=e.get(k)||[0,0];r[p<q?0:1]++;e.set(k,r);}}
  let b=0;for(const [f,r] of e.values()) if(f!==1||r!==1) b++; if(b) n.push(name+":"+b); bad+=b;}
 return [bad,n];}
for(const base of [B, Object.assign({},B,window.PHONES.find(x=>x.name=="iPhone 17 Pro").spec)]){
 for(const rad of [0, 2]){
  const s=Object.assign({},base,{squareCorners:true,squareRadius:rad});
  const W=s.width,L=s.length,o=s.phoneClearance+s.frameWall;
  const ring=G.caseOutline(s,o,16)[0],xs=ring.map(q=>q[0]),ys=ring.map(q=>q[1]);
  const strokes=[{c:0,w:9,pts:[[-4,L*0.35],[W+4,L*0.45]]},{c:1,w:5,pts:[[W*0.2,-4],[W*0.5,L+4]]},{c:2,w:7,pts:[[W*0.6,L*0.7],[W*0.9,L*0.8]]}];
  let bad=0,names=[];
  for(const [mode,style] of [["inlay","plain"],["inlay","extrude"],["relief","stripes"]]){
    const set=G.buildPrintSet(s,{...D,strokes,mode,caseStyle:style,inkHeights:[1,2,0]});
    const [b,n]=badEdges(set.parts); bad+=b; names.push(...n);
  }
  if(bad) process.exitCode=1;
  console.log(`${s.phone.padEnd(18)} r=${rad}  outline ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)} x ${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)} (want ${(-o).toFixed(2)}..${(W+o).toFixed(2)} x ${(-o).toFixed(2)}..${(L+o).toFixed(2)})  points ${ring.length}  bad ${bad} ${names.join(" ")}`);
 }
}
// the corner wall is thicker than the sides
const s=Object.assign({},B,{squareCorners:true,squareRadius:0});
const o=s.phoneClearance+s.frameWall, R0=s.cornerRadius;
const corner=Math.hypot(R0,R0)-R0+o-s.phoneClearance;   // extra material on the diagonal
console.log(`side wall ${s.frameWall} mm, corner wall about ${corner.toFixed(1)} mm`);
console.log(process.exitCode?"FAIL":"OK: square corners export clean");
