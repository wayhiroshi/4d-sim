import {afterEach,describe,it,expect,vi} from "vitest";
import {strategyFixture} from "./test/strategy-fixture";
type Reply={job:number;type:string;cached?:boolean;result?:unknown};
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup() {
  const replies:Reply[]=[];
  const worker={onmessage:null as null|((event:{data:unknown})=>Promise<void>),postMessage:(r:Reply)=>replies.push(r)};
  vi.stubGlobal("self",worker);
  await import("./strategy-worker");
  const {base,request}=strategyFixture(1);
  const send=(job:number,patch:Record<string,unknown>={})=>worker.onmessage!({data:{job,base,request,mode:"preview",band:"standard",...patch}});
  return {replies,send,base,request};
}
describe("browser calculation worker",()=>{
  it("reuses only exact inputs including band, purchases and priorities",async()=>{
    const {replies,send,base,request}=await setup();
    await send(1);await send(2);
    expect(replies.at(-1)).toMatchObject({type:"result",job:2,cached:true});
    const result=replies.at(-1)!.result;
    await send(3,{band:"conservative"});expect(replies.at(-1)!.cached).toBe(false);
    await send(4,{base:{...base,purchases:base.purchases.map(p=>({...p,pv:p.pv+1}))}});expect(replies.at(-1)!.cached).toBe(false);
    await send(5,{request:{...request,growthPriority:[{memberId:"sub1",title:"DR"}]}});expect(replies.at(-1)!.cached).toBe(false);
    await send(6);expect(replies.at(-1)).toMatchObject({job:6,cached:true,result});
  });
  it("discards superseded jobs even when the newer job is a cache hit",async()=>{
    const {replies,send,request}=await setup();
    await send(1);replies.length=0;
    const old=send(2,{request:{...request,horizonMonths:120}});
    const latest=send(3);await Promise.all([old,latest]);
    expect(replies.filter(r=>r.type==="result").map(r=>r.job)).toEqual([3]);
    expect(replies.at(-1)!.cached).toBe(true);
  });
  it("single-band preview agrees with the full calculation when adopted",async()=>{
    const {replies,send,request}=await setup();
    await send(1,{request:{...request,growthPriority:[{memberId:"sub1",title:"DR"}]}});
    const preview=replies.at(-1)!.result;
    await send(2,{mode:undefined,request:{...request,growthPriority:[{memberId:"sub1",title:"DR"}]}});
    const full=replies.at(-1)!.result as import("./shared/strategy").StrategySimulationResult;
    expect(full.variants[0]!.bands.standard).toEqual(preview);
  });
});
