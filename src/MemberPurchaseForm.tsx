import { useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import ManualPurchaseFields from "./ManualPurchaseFields";
import { readManualPurchase } from "./shared/manual-purchase";
import type { Member, OrganizationSnapshot } from "./shared/types";

export default function MemberPurchaseForm({ member, snapshot, onSaved }: { member: Member; snapshot: OrganizationSnapshot; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  const purchases = snapshot.purchases.filter(p => p.memberId === member.id && p.period === snapshot.period && p.status === "confirmed");
  const pv = purchases.reduce((sum, p) => sum + p.pv * p.quantity, 0);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const values = new FormData(event.currentTarget); pending.current = true; setBusy(true); setError("");
    try {
      const purchase = readManualPurchase(values);
      if (!purchase) throw new Error("p.v.を入力してください");
      await api.createPurchase({ ...purchase, memberId: member.id, period: snapshot.period, productCode: null, status: "confirmed", quantity: 1 });
      setOpen(false); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "購入情報を保存できませんでした"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="member-purchase-section">
    <h3>{snapshot.period}度の購入p.v.</h3>
    <p>{purchases.length ? `${pv.toLocaleString("ja-JP")} p.v.（登録済み${purchases.length}件）` : "未登録です。購入実績を入力するとタイトル・報酬の試算へ反映されます。"}</p>
    <button className="text-button" disabled={busy} onClick={() => { setOpen(!open); setError(""); }}>{open ? "入力を閉じる" : purchases.length ? "購入を追加" : "当月p.v.を登録"}</button>
    {open && <form onSubmit={event => void save(event)}>
      <ManualPurchaseFields period={snapshot.period} required />
      {purchases.length > 0 && <p className="field-note">今回入力する分を加算します。登録済みの購入を重ねて入力しないでください。</p>}
      <button className="secondary-button" disabled={busy}>{busy ? "保存中…" : "購入情報を保存"}</button>
      {error && <p role="alert" className="form-error">{error}</p>}
    </form>}
  </section>;
}
