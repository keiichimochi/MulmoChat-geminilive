# Requirements Document

## Project Description (Input)
Gemini Liveのgemini-2.5-flash-preview-native-audio-dialogモデルを利用して、AIとの音声会話機能を実装するための計画を以下に示します。現在の実装はOpenAIのリアルタイムAPIに依存しているため、API費用を抑えるためにGoogleのGemini Liveに切り替えるには、バックエンドとフロントエンドの両方で大幅な変更が必要です。

実装計画の概要
この実装計画は、3つの主要なフェーズに分かれています。

バックエンドの変更: サーバーサイドでOpenAIのAPI呼び出しをGoogle Gemini Liveのものに置き換えます。

フロントエンドの変更: クライアントサイドでWebRTCの接続とデータチャネルの通信をGemini Liveの仕様に合わせます。

依存関係の確認: 必要なライブラリが最新であり、Gemini Liveに対応しているか確認します。

フェーズ1: バックエンドの変更 (server/routes/api.ts)
現在のサーバーは、OpenAIからセッション用の一次キーを取得しています。これをGemini Liveのセッションを開始する処理に置き換える必要があります。

/api/startエンドポイントの修正:

現在、このエンドポイントはOpenAIのclient_secrets APIを呼び出しています。これを削除し、GoogleのGemini APIを使用してセッションを開始するロジックに置き換えます。

認証には、.envファイルに設定されているGEMINI_API_KEYを利用します。

Gemini LiveのAPIから返されるセッション情報（セッションIDやトークンなど）をクライアントに返すように変更します。

OpenAI関連コードの削除:

OpenAI APIへのfetchリクエストや、それに関連するセッション設定のコードを完全に削除します。

フェーズ2: フロントエンドの変更 (src/App.vue)
フロントエンドでは、WebRTCの接続処理と、AIモデルとのデータチャネルを介した通信方法を、Gemini Liveの仕様に合わせて全面的に書き直します。

startChat 関数の更新:

/api/startから受け取るレスポンスの形式が変更されるため、その処理を更新します。

RTCPeerConnectionのセットアップやSDP（Session Description Protocol）の交換プロセスを、Gemini LiveのAPIドキュメントに従って修正します。現在、OpenAIのエンドポイントにSDPを送信していますが、これをGeminiの指定するエンドポイントに変更します。

データチャネル通信の変更:

データチャネルが開かれた際に送信されるsession.updateメッセージの内容を、Gemini Liveの仕様に合わせます。特に、modelの値を"gpt-realtime"から"gemini-2.5-flash-preview-native-audio-dialog"に変更する必要があります。

messageHandler関数を修正し、Gemini Liveから送られてくるメッセージ（テキストの差分、ツールの呼び出しなど）を正しく解釈できるようにします。メッセージの形式はOpenAIと異なる可能性が高いです。

ツール呼び出しの互換性確認:

現在実装されているツール呼び出しの仕組み（画像生成やウェブ閲覧など）が、Gemini Liveでも同様に機能するかを確認し、必要に応じてpluginTools関数やprocessToolCall関数を修正します。

フェーズ3: 依存関係の確認 (package.json)
プロジェクトがGemini Liveの機能を十分に活用できるよう、依存ライブラリが最新の状態であることを確認します。

@google/genai パッケージの確認:

package.jsonを見ると、@google/genaiが^1.17.0でインストールされています。このバージョンがgemini-2.5-flash-preview-native-audio-dialogモデルの音声対話機能に対応しているかを確認し、必要であれば新しいバージョンにアップデートします。場合によっては、別のSDKが必要になる可能性もあります。

# 要件文書

## はじめに
この機能は、現在OpenAIリアルタイムAPIに依存している音声会話システムを、GoogleのGemini Live（gemini-2.5-flash-preview-native-audio-dialogモデル）に移行することを目的としています。主な目標はAPI費用の削減と、既存機能の維持・向上です。

## 要件

### 要件1: バックエンドAPI統合
**目的:** 開発者として、OpenAIリアルタイムAPIをGemini LiveAPIに置き換えたい。これにより、API費用を削減し、同等以上の音声会話機能を提供できるようになる。

#### 受入基準
1. WHEN セッション開始リクエストを受信した THEN システム SHALL OpenAI client_secrets APIの代わりにGemini Live APIを呼び出す
2. WHEN Gemini Live認証を行う THEN システム SHALL 環境変数GEMINI_API_KEYを使用して認証する
3. WHEN Gemini Liveセッションが正常に開始された THEN システム SHALL セッションID、トークン、およびその他の必要な情報をクライアントに返す
4. WHERE server/routes/api.tsの/api/startエンドポイント THE システム SHALL OpenAI関連のすべてのfetchリクエストとセッション設定コードを削除する
5. IF Gemini Live APIが利用できない THEN システム SHALL 適切なエラーメッセージとともにリクエストを拒否する

### 要件2: フロントエンドWebRTC通信
**目的:** ユーザーとして、Gemini Liveとの音声会話において、既存のユーザーエクスペリエンスを維持したい。これにより、シームレスな移行を実現できる。

#### 受入基準
1. WHEN startChat関数が呼び出された THEN システム SHALL 変更されたAPIレスポンス形式を正しく処理する
2. WHEN RTCPeerConnectionをセットアップする THEN システム SHALL Gemini Live APIドキュメントに従ってSDP交換プロセスを実行する
3. WHERE OpenAIエンドポイントへのSDP送信が現在行われている THE システム SHALL Geminiの指定するエンドポイントに変更する
4. WHEN データチャネルが開かれた THEN システム SHALL session.updateメッセージをGemini Live仕様に合わせて送信する
5. WHERE modelパラメータ THE システム SHALL "gpt-realtime"の代わりに"gemini-2.5-flash-preview-native-audio-dialog"を設定する

### 要件3: メッセージハンドリング
**目的:** システム管理者として、Gemini Liveからのメッセージが正しく解釈されることを確認したい。これにより、音声会話の品質と機能性を保証できる。

#### 受入基準
1. WHEN Gemini Liveからメッセージを受信した THEN システム SHALL テキストの差分を正しく解釈する
2. WHEN ツール呼び出しメッセージを受信した THEN システム SHALL Gemini Live形式のツール呼び出しを処理する
3. WHILE 音声会話セッションが継続中 THE システム SHALL リアルタイムでメッセージを双方向で送受信する
4. IF メッセージ形式がOpenAIと異なる THEN システム SHALL 適切な変換処理を行う

### 要件4: ツール統合互換性
**目的:** エンドユーザーとして、既存のツール機能（画像生成、ウェブ閲覧など）を継続して利用したい。これにより、機能的な後退なく移行を完了できる。

#### 受入基準
1. WHEN 画像生成ツールが呼び出された THEN システム SHALL Gemini Live環境で正常に動作する
2. WHEN ウェブ閲覧ツールが使用された THEN システム SHALL 既存の機能レベルを維持する
3. WHERE pluginTools関数とprocessToolCall関数 THE システム SHALL 必要に応じてGemini Live互換性のための修正を適用する
4. IF 既存のツールがGemini Liveで互換性がない THEN システム SHALL 代替実装または適切なエラーハンドリングを提供する

### 要件5: 依存関係管理
**目的:** 開発チームとして、プロジェクトの依存関係がGemini Live機能をサポートしていることを確認したい。これにより、安定した開発環境を維持できる。

#### 受入基準
1. WHEN @google/genaiパッケージのバージョンをチェックする THEN システム SHALL gemini-2.5-flash-preview-native-audio-dialog対応を確認する
2. IF 現在のバージョン（^1.17.0）が不十分な場合 THEN システム SHALL 適切なバージョンにアップデートする
3. WHERE 音声対話機能が必要な場合 THE システム SHALL 必要であれば追加のSDKをインストールする
4. WHEN パッケージの更新を行う THEN システム SHALL すべての関連機能が正常に動作することを確認する

### 要件6: コスト最適化
**目的:** 事業責任者として、API使用料金の削減を実現したい。これにより、運用コストを削減しながら同等以上のサービス品質を提供できる。

#### 受入基準
1. WHEN Gemini Live APIを使用する THEN システム SHALL OpenAI APIよりも低いコストで音声会話機能を提供する
2. WHILE セッションが継続中 THE システム SHALL 効率的なリソース使用でコストを最小化する
3. WHERE API呼び出しが発生する THE システム SHALL 不要なリクエストを削減する最適化を実装する
4. WHEN 移行が完了した THEN システム SHALL OpenAI関連のすべての課金対象コードを削除する