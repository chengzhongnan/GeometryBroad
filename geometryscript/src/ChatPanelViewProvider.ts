import * as vscode from 'vscode';

export class ChatPanelViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'geometryView'; // 必须和 package.json 中的 id 匹配

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) { }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // 允许在 webview 中运行脚本
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        // 设置 webview 的 HTML 内容
        webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

        // 处理从 webview 发来的消息
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.command) {
                case 'sendMessage':
                    // 用户发送了一条消息，我们在这里调用 AI
                    vscode.window.showInformationMessage(`收到消息: ${data.text}`);
                    // 在这里调用AI逻辑，然后将结果发回
                    // 比如:
                    // const aiResponse = await getAiResponse(data.text);
                    // webviewView.webview.postMessage({ command: 'receiveMessage', text: aiResponse });
                    break;
                case 'insertCode':
                    // 用户点击了“插入代码”按钮
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, data.code);
                        });
                    }
                    break;
            }
        });
    }

    // 公共方法，用于从扩展的其他部分向 webview 发送消息
    public postMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }


    private async _getHtmlForWebview(webview: vscode.Webview) {
        // 1. 获取动态资源的 URI 和 nonce
        const nonce = this.getNonce();
        const toolkitUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mainChatPanel.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mainChatPanel.css'));

        // 2. 获取 HTML 模板文件的路径
        const panelHtmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'mainChatPanel.html');

        // 3. 异步读取文件内容
        const fileContentBytes = await vscode.workspace.fs.readFile(panelHtmlPath);
        const htmlTemplate = Buffer.from(fileContentBytes).toString('utf8');

        // 4. 替换 HTML 模板中的占位符
        const finalHtml = htmlTemplate
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{nonce}}/g, nonce)
            .replace(/{{toolkitUri}}/g, toolkitUri.toString())
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{scriptUri}}/g, scriptUri.toString());

        return finalHtml;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}



export function registerSidebar(context: vscode.ExtensionContext) {
    // 1. 创建并注册 TreeView
    const geometryViewProvider = new ChatPanelViewProvider(context.extensionUri, context);
    vscode.window.registerWebviewViewProvider(
        'geometryView', // 这个 ID 必须和 package.json 中的 views -> id 一致
        geometryViewProvider
    );

    // 2. 注册 TreeView 中定义的命令
    // 注意：这些命令ID需要是全新的，或者与你已有的功能对应起来


    // 将命令也注册到 context.subscriptions 中，以便插件禁用时销毁
    // context.subscriptions.push(visualizeFileDisposable);
}
