export default function ManualPurchaseFields({ period, required = false }: { period: string; required?: boolean }) {
  return <fieldset className="manual-purchase-fields">
    <legend>{period}度の購入情報{!required && "（任意）"}</legend>
    <label>購入種別<select name="purchaseKind" defaultValue="repeat"><option value="repeat">リピート購入</option><option value="initial">初回購入</option><option value="additional">追加購入</option></select></label>
    <label>購入p.v.<input name="purchasePv" type="number" min="0" step="1" required={required} placeholder="例：5330" inputMode="numeric" /></label>
    <label>購入額（円・任意）<input name="purchasePrice" type="number" min="0" step="1" placeholder="例：9950" inputMode="numeric" /></label>
    <small className="field-note">購入種別ごとの実績を入力します。{!required && "p.v.が空欄なら未登録、0なら購入p.v.なしとして保存。"}購入額の空欄は0円で計算します。</small>
  </fieldset>;
}
