# FORDAYS Navigator

フォーデイズ会員向けの、非公式・個人用攻略シミュレーターです。React SPA、Hono API、Cloudflare D1を1つのCloudflare Workerへ配備します。MVPではAIを使わず、版管理した公式ルール設定から決定論的にタイトル、5種類のボーナス、配置候補、ミッション、条件付き将来試算を算出します。

正式な資格・報酬はフォーデイズ公式明細を優先してください。本アプリは収入、健康効果、タイトル取得を保証しません。公式ロゴ、原本資料、実会員ID、口座情報、病歴・診療・服薬情報は保存しません。

## 実装範囲

- Dashboard: タイトル進捗、営業月p.v.、総ボーナス、概算手取、今日のミッション
- 組織: スマホ用階層リスト、PC用2カラムツリー、購入・活動履歴
- ABCカルテ: 関心タグ、温度感、接触・体験・説明会・登録状態
- 商品: 価格、p.v.、換算数、数量選択による自動計算
- 配置: 全候補を仮複製して再計算し、安定した規則で上位3案を表示
- 将来試算: 3・6・12か月、保守・標準・挑戦の明示前提
- CSV: 会員、月次購入、候補者のテンプレート、全行プレビュー、一括反映
- PWA: 静的アセットだけを保存し、`/api/*`は常にネットワーク取得

対象外はAI文章生成、AIチャット、LINE、カレンダー、PDF、公式サイトの自動操作、一般公開SaaSです。

## ローカル起動

Node.js 22以降を使用します。

```sh
npm install
npm run cf-typegen
npm run db:migrate:local
npm run dev
```

初期マイグレーションには匿名デモデータが入ります。開発URLは通常 `http://localhost:5173` です。

検証コマンド:

```sh
npm run typecheck
npm test
npm run build
npm run deploy:dry
npm run check:startup
```

## ルール設定

報酬・商品・タイトル条件は [`config/plans/fordays-2026-03.json`](config/plans/fordays-2026-03.json) にあります。数値をコードへ埋め込まず、適用期間と出典ページを持たせています。同一項目が競合する場合は新しい改版を優先します。

営業月は18日から翌月17日です。グループp.v.は本人リピートを除外し、本人追加購入を含めます。総ボーナスと概算手取は分離し、後者にインボイス経過措置、源泉徴収、手数料、相殺、前月繰越を反映します。

## Cloudflare本番準備

本番公開前にCloudflare Accessを設定し、本人の許可メールだけをAllowにしてください。Accessがない状態で個人データを投入しないでください。

1. D1を作成します。

   ```sh
   npx wrangler d1 create fordays-navigator
   ```

2. 返された`database_id`で [`wrangler.jsonc`](wrangler.jsonc) のゼロUUIDを、通常設定と`env.production`の2か所とも置き換えます。
3. Cloudflare Zero TrustでWorkerの公開ホストをSelf-hosted applicationへ登録し、本人メールのAllow policyを作成します。
4. 最初のWorkerだけ手動で作成し、Accessの適用をシークレットウィンドウで確認します。

   ```sh
   npm run deploy:ci
   ```

5. CloudflareのWorker `fordays-navigator-production`で `Settings > Builds > Connect` を開き、GitHubリポジトリを接続します。設定値は次のとおりです。

   | 項目 | 設定値 |
   | --- | --- |
   | Production branch | `main` |
   | Build command | `npm run verify:ci` |
   | Deploy command | `npm run deploy:ci` |
   | Root directory | 空欄（リポジトリ直下） |
   | Non-production branch builds | MVPでは無効 |

以後は`main`へのpushで、型チェック、テスト、ビルドに成功した場合だけCloudflareへ自動公開されます。GitHub Actionsから二重にデプロイする設定は追加しません。

### D1マイグレーション

Workers Buildsの自動公開ではD1マイグレーションを実行しません。スキーマ変更を含むリリースでは、公開前にバックアップを取得し、内容を確認してから手動で適用します。

```sh
npm run db:migrate:remote -- --env production
```

マイグレーションが新コードより先に適用されても既存コードが動く、後方互換な変更を基本とします。破壊的変更は自動公開と同時に行いません。

本番環境では`ACCESS_REQUIRED=true`です。これはヘッダー欠落をWorkerでも拒否する補助防御であり、Access application自体の設定を代替しません。

## D1バックアップと復元

バックアップ:

```sh
mkdir -p backups
npx wrangler d1 export fordays-navigator --remote --env production --output backups/fordays-navigator.sql
```

`backups/`には個人データが含まれるため、Gitへ追加しないでください。復元は空の検証用D1で先に確認します。

```sh
npx wrangler d1 execute fordays-navigator --remote --env production --file backups/fordays-navigator.sql
```

## セキュリティとデータ境界

- API入出力はZodで検証し、D1はバインド変数と準備済みSQLを使用します。
- 全業務テーブルが`workspace_id`を持ちます。MVPは固定の個人ワークスペースですが、複数利用者化で分離キーとして使えます。
- APIは`Cache-Control: no-store`、PWAはAPIを`NetworkOnly`にします。
- CSVは1MBまで、全件検証後にD1 batchで一括反映します。
- 配置と将来試算は元組織を変更しません。公式登録は利用者が公式サイトで行います。
