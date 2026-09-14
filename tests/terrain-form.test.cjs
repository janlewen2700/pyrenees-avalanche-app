const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
function setup(){
 const nodes=Object.fromEntries(['form-elevation','form-slope','form-aspect','form-location-summary','auto-terrain-note'].map(id=>[id,{value:'',options:[{value:'N'},{value:'E'}],addEventListener(_name,fn){this.edit=fn;}}]));
 const requests=[];const context=vm.createContext({$:id=>nodes[id],pendingAutoTerrain:null,Number,escapeHtml:String,compassAspect:()=> 'N',fetchJson:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))});
 vm.runInContext(source.slice(source.indexOf('    let terrainRequestId ='),source.indexOf('    function openReportModal')),context);
 return {nodes,requests,run:()=>vm.runInContext('autoFillReportTerrain(42.5, 1.2)',context)};
}
test('lookup populates fields, including zero slope, without inventing missing elevation',async()=>{
 const h=setup(),p=h.run();h.requests[0].resolve({elevationM:null,slopeDeg:0,aspectDeg:null});await p;
 assert.equal(h.nodes['form-elevation'].value,'');assert.equal(h.nodes['form-slope'].value,'0.0');assert.equal(h.nodes['form-aspect'].value,'');
});
test('manual measurements survive a slow lookup',async()=>{
 const h=setup(),p=h.run();h.nodes['form-slope'].value='37';h.nodes['form-slope'].edit();h.requests[0].resolve({elevationM:2000,slopeDeg:25,aspectDeg:0});await p;assert.equal(h.nodes['form-slope'].value,'37');
});
test('an older response cannot populate a newly selected location',async()=>{
 const h=setup(),a=h.run(),b=h.run();h.requests[1].resolve({elevationM:2500,slopeDeg:35,aspectDeg:0});await b;h.requests[0].resolve({elevationM:1000,slopeDeg:10,aspectDeg:0});await a;assert.equal(h.nodes['form-elevation'].value,2500);
});
test('lookup failure leaves terrain unknown and permits manual entry',async()=>{
 const h=setup(),p=h.run();h.requests[0].reject(new Error('Provider unavailable'));await p;assert.equal(h.nodes['form-elevation'].value,'');assert.match(h.nodes['auto-terrain-note'].innerHTML,/remains unknown/);
});
