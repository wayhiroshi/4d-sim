import { useEffect, useRef, useState } from "react";
import type { OrganizationSnapshot } from "./shared/types";
import { TITLE_ORDER } from "./shared/types";
import type { Band, StrategySimulationRequest, StrategyVariantResult } from "./shared/strategy";
import { combinationAlternatives, placementAlternatives, priorityAlternatives, rankAlternatives, type Alternative } from "./domain/strategy-alternatives";
import { Income } from "./StrategyStudio";
import "./strategy-alternatives.css";

type Row = Alternative & { result: StrategyVariantResult };
const money = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
export default function StrategyAlternatives({base,input,band,selectedId,disabled,adopt}: {
  base:OrganizationSnapshot; input:StrategySimulationRequest; band:Band; selectedId:string|null; disabled:boolean; adopt:(r:StrategySimulationRequest)=>void;
}) {
  const worker = useRef<Worker|null>(null), token = useRef(0), job = useRef(0);
  const pending = useRef<((reason:Error)=>void)|null>(null);
  const [rows,setRows] = useState<Row[]>([]), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [progress,setProgress] = useState(""), [scope,setScope] = useState("");
  const [objective,setObjective] = useState<"income"|"fastest">("income");
  const [prepareQualifications,setPrepareQualifications] = useState(false), [assignIntroducer,setAssignIntroducer] = useState(input.allowIntroducerIdChoice);
  const identity = JSON.stringify([base,input,band,prepareQualifications,assignIntroducer]);
  const [computedIdentity,setComputedIdentity] = useState("");
  const stop = () => { token.current++; worker.current?.terminate(); worker.current=null; pending.current?.(new Error("中止")); pending.current=null; setBusy(false); setProgress("比較を中止しました（計算済みの案は残ります）"); };
  useEffect(()=>{ stop(); setRows([]); setProgress(""); setError(""); },[identity]);
  useEffect(()=>()=>{token.current++;worker.current?.terminate();pending.current?.(new Error("中止"));},[]);
  async function evaluate(option:Alternative) {
    const w = worker.current ?? new Worker(new URL("./strategy-worker.ts",import.meta.url),{type:"module"}); worker.current=w;
    const id=++job.current;
    return new Promise<StrategyVariantResult>((resolve,reject)=>{
      pending.current=reject;
      w.onmessage=(e:MessageEvent<{job:number;type:string;result:StrategyVariantResult;error:string}>)=>{
        if(e.data.job!==id)return;
        if(e.data.type==="result"){pending.current=null;resolve(e.data.result);}
        if(e.data.type==="error"){pending.current=null;reject(new Error(e.data.error));}
      };
      w.onerror=()=>{w.terminate();worker.current=null;pending.current=null;reject(new Error("候補の計算に失敗しました"));};
      w.postMessage({job:id,mode:"preview",band,base,request:option.request});
    });
  }
  async function compare(kind:"placement"|"priority"|"combinations") {
    const started=performance.now();
    const sequence=++token.current; setBusy(true);setError("");setRows([]);setComputedIdentity(identity);
    try {
    const combos=kind==="combinations"?combinationAlternatives(base,input):null;
    const options=kind==="placement"&&selectedId?placementAlternatives(base,input,selectedId):kind==="priority"?priorityAlternatives(base,input,{prepareQualifications,assignIntroducer}):combos!.options;
    setScope(kind==="placement"?"選択したチームを、配置可能な所有IDの下へ移す比較です。":kind==="priority"?`LD・DRの浅い段の不足を先に埋め、DR取得の翌月から次のIDへ切り替えます。${assignIntroducer?"新規分の紹介IDは同じ所有者の優先IDへ割り当てます。":"紹介IDは変更しません。"}${prepareQualifications?"優先IDのGコース変更・ライセンス取得を1か月後に予定します（既存の予定が優先）。":"資格・コースは変更しません。"}既存登録と紹介人数は変えません。`:combos!.exhaustive?`新規の独立チーム${combos!.movableTeams}組 × 所有IDへの配置${combos!.total}通りを確認（禁止配置は除外）。既存組織や育成順は固定です。`:"集中・分散案を比較し、上位案の配置を1チームずつ変えて追加探索します。全配置の最適性は保証しません。");
    const completed:Row[]=[];const seen=new Set<string>();let failures=0;
    const seedCount=options.length;
      for(let index=0;index<options.length;index++) {
        if(sequence!==token.current)return;
        const option=options[index]!; const key=JSON.stringify(option.request); if(seen.has(key))continue;seen.add(key);
        setProgress(`${index+1} / ${options.length}案を計算中`);
        try { const result=await evaluate(option); if(sequence!==token.current)return;completed.push({...option,result});setRows([...completed]); }
        catch(e){if(sequence!==token.current)return;failures++;setError(`${failures}案を計算できませんでした：${(e as Error).message}`);}
        if(combos&&!combos.exhaustive&&index===seedCount-1) {
          const best=rankAlternatives(completed,input.horizonMonths,objective).slice(0,3);
          for(const row of best) for(const l of row.request.leaders.filter(l=>!l.existingMemberId)) {
            for(const neighbor of placementAlternatives(base,row.request,`strategy-${l.id}`).slice(1)) {
              if(options.length>=96)break;
              if(!options.some(o=>JSON.stringify(o.request)===JSON.stringify(neighbor.request)))options.push({...neighbor,label:`追加探索：${l.name}を${neighbor.label}`});
            }
          }
        }
      }
      if(sequence===token.current){setProgress(`${completed.length}案を比較しました · ${((performance.now()-started)/1000).toFixed(1)}秒${failures?`（計算不可 ${failures}案）`:""}`);setBusy(false);}
    } catch(e){if(sequence===token.current){setError((e as Error).message);setBusy(false);}}
  }
  const current=rows.find(r=>r.label==="現在の案")?.result.months.find(m=>m.month===input.horizonMonths);
  const ranked=rankAlternatives(rows,input.horizonMonths,objective);
  const fresh=computedIdentity===identity;
  return <section className="strategy-alternatives" aria-label="別のパターンを比較">
    <h2>こっちのパターンは？</h2>
    <details><summary>タイトル取得を目指すときの前提</summary><label><input type="checkbox" checked={assignIntroducer} disabled={busy} onChange={e=>setAssignIntroducer(e.target.checked)}/>新規分の紹介IDも、同じ所有者の優先IDへ割り当てる</label><label><input type="checkbox" checked={prepareQualifications} disabled={busy} onChange={e=>setPrepareQualifications(e.target.checked)}/>優先IDのGコース変更・ライセンス取得を1か月後に予定する</label><p>資格を自動取得済みにはしません。この前提を含めた案だけを比較します。コース変更後の購入費も再計算します。</p></details>
    <div className="alternative-tools"><button disabled={disabled||busy||!selectedId||selectedId===input.rootId} onClick={()=>void compare("placement")}>選んだチームの配置先を比較</button><button disabled={disabled||busy} onClick={()=>void compare("priority")}>メイン・サブの育成順を比較</button><button disabled={disabled||busy||!input.leaders.some(l=>!l.existingMemberId)} onClick={()=>void compare("combinations")}>チームの組合せも探す</button>{busy&&<button onClick={stop}>比較を中止</button>}</div>
    <p className="canvas-hint">組織図で人・チームを選んでから配置先を比較できます。成長前提は共通、公式登録は変更しません。</p>
    {progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}
    {fresh&&rows.length>0&&<><p className="canvas-hint">{scope}</p><label>比較の優先順位<select value={objective} onChange={e=>setObjective(e.target.value as typeof objective)}><option value="income">同じ経過時間での参考月額</option><option value="fastest">目標タイトルまでの時間</option></select></label><p className="canvas-hint">金額は全案とも{input.horizonMonths/12}年時点・{band==="standard"?"標準":band==="conservative"?"保守":"挑戦"}。一時ボーナスを除きます。育成順は配置方針の比較で、目標タイトルは変わりません。</p>
      <div className="alternative-cards">{ranked.slice(0,12).map((r,i)=>{const m=r.result.months.find(m=>m.month===input.horizonMonths);return <article key={JSON.stringify(r.request)}><h3>{i+1}. {r.label}</h3><dl><div><dt>継続月額</dt><dd>{m?money(m.recurring):"計算範囲外"}</dd></div><div><dt>購入費控除後</dt><dd>{m?money(m.recurringCashflow):"—"}</dd></div><div><dt>現在の案との差</dt><dd>{m&&current?`${m.recurringCashflow-current.recurringCashflow>=0?"+":""}${money(m.recurringCashflow-current.recurringCashflow)}`:"—"}</dd></div><div><dt>目標タイトルまで</dt><dd>{r.result.titleMonth===null?"期間内未到達":`${r.result.titleMonth}か月`}</dd></div></dl>
        {r.request.growthPriority.map(stage=>{const reached=r.result.months.find(row=>row.month<=input.horizonMonths&&row.ids.some(id=>id.id===stage.memberId&&TITLE_ORDER.indexOf(id.acquiredTitle)>=TITLE_ORDER.indexOf(stage.title)));return <p className="canvas-hint" key={stage.memberId}>{base.members.find(id=>id.id===stage.memberId)?.displayName}：{stage.title} {reached?`${reached.month}か月で取得`:"期間内未取得"}</p>;})}
        {r.result.warnings.some(w=>w.startsWith("育成優先"))&&<details><summary>優先タイトルを取れない理由</summary><ul>{r.result.warnings.filter(w=>w.startsWith("育成優先")).map(w=><li key={w}>{w}</li>)}</ul></details>}{m&&<Income row={m} title="ID別・報酬内訳"/>}<button disabled={busy||disabled} onClick={()=>adopt(r.request)}>この案を試す</button></article>;})}</div>
      <p className="canvas-hint">上位12案を表示。保存は「この案を試す」→「別案として保存」。未達の育成段階は切り替わらず、資格・紹介条件も自動では付与しません。</p></>}
  </section>;
}
