# LAST BEACON — 最後の灯火

選定したゲーム画面KVを、実際にタップして一周遊べる縦画面2.5D Web/PWAプロトタイプにしたリポジトリです。

<p align="center">
  <img src="verification/01-initial-390x844.png" width="300" alt="LAST BEACON 初期ゲーム画面">
</p>

## いま遊べるループ

1. 発光している廃材をタップ（廃材 12 → 20）
2. 中央の灯火をLv.2へ強化（廃材 20 → 0）
3. 安全圏がアニメーションで拡大
4. 圏外にいた生存者を救助（人口 2/4 → 3/4、電力 80 → 76）
5. 以降は短いクールダウン付きで廃材を回収

施設・住民・周辺の3メニュー、効果音切替、ローカル保存、最大2時間分の放置回収、オフライン再起動にも対応しています。

## 起動

必要環境は Node.js 22.12 以上です。

```bash
npm install
npm run dev
```

本番ビルドと確認は次のとおりです。

```bash
npm run build
npm run preview
```

## GitHub → Vercel

このフォルダをGitHubリポジトリのルートへ置き、VercelでそのリポジトリをImportします。環境変数は不要です。

- Framework Preset: Vite（通常は自動検出）
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

本番URLをiPhoneで開き、共有メニューから「ホーム画面に追加」すると縦向きのスタンドアロンPWAとして起動できます。

## 保存仕様

- 保存先: 端末・ブラウザ内の `localStorage`
- 保存タイミング: 各操作後、タブ非表示時、復帰時、ページ離脱時
- 放置回収: 45秒につき廃材1、最大2時間分
- 初期化: 「周辺」メニュー内の「チュートリアルを最初から」

現段階ではアカウントやクラウド同期を持ちません。ブラウザデータを消すと進行も消えます。

## 構成

```text
src/
  game/
    LastBeaconScene.ts  2.5Dワールド、演出、タップ対象
    state.ts            ゲーム進行、保存、放置回収
    audio.ts            ユーザー操作後に鳴る合成効果音
  main.ts               HUD、メニュー、PWA更新UI
  styles.css            縦画面UI、Safe Area、レスポンシブ
public/
  assets/                軽量化済みWebPゲーム素材
  fonts/                 日本語UIフォント
art-source/              高解像度制作素材とフォントライセンス
verification/            実ブラウザ検証スクリーンショットと結果
```

## 検証済み

- `npm run build`（TypeScript + Vite + PWA）
- 390×844 / 375×667
- DPR 3端末で内部Canvasを2倍描画（780×1386）
- 回収 → 強化 → 安全圏拡大 → 救助
- 連打時の段階ガード
- 再読込後の進行保持
- 中断復帰時の放置回収と二重付与防止
- 救出演出中に初期化した場合の完全復元
- 施設・周辺メニュー
- Service Worker制御下でのオフライン再読込
- コンソールエラー、ページ例外、失敗リクエストなし

詳細は [verification/RESULTS.md](verification/RESULTS.md) を参照してください。

## アートと権利

ゲームの背景、灯火、施設、人物、廃材は本作向けに新規制作したオリジナル素材です。既存ゲームのスクリーンショット、ロゴ、キャラクター、音声、文章、数値表は使用していません。

日本語UIには Noto Sans Japanese の一部を同梱しています。ライセンスは [art-source/NotoSansJP-OFL.txt](art-source/NotoSansJP-OFL.txt) にあります。アート生成・分割条件と最終プロンプト一式は [ART_DIRECTION.md](ART_DIRECTION.md) に記録しています。

本プロトタイプの利用条件は [LICENSE.md](LICENSE.md)、使用ライブラリとフォントの表記は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。公開・譲渡前に、プロジェクト本体の最終ライセンスを権利者名義で確定してください。

## 現在の範囲

これは「一発で遊び方が分かるか」を検証する最初のプレイアブル版です。ワールド探索、住民のドラッグ配属、黒霧イベント、施設建設、経済バランス、クラウド保存、課金、ランキングはまだ実装していません。
