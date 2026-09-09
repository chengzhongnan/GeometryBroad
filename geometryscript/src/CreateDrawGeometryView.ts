import * as vscode from 'vscode';
import path from 'path'

export function CreateDrawView(context: vscode.ExtensionContext, geometryOutputChannel?: vscode.OutputChannel) {
    // 创建右上角的按钮
    const executeCommand = vscode.commands.registerCommand('extension.showDrawing', async () => {
        // 1. 获取当前活动的编辑器
        const editor = vscode.window.activeTextEditor;

        if (editor && editor.document.languageId === 'geometryscript') {
            // 2. 获取文件的全部文本
            const scriptText = editor.document.getText();

            const panel = vscode.window.createWebviewPanel(
                'geometryDrawing', // Webview 的类型
                'Geometry Drawing', // 面板的标题
                vscode.ViewColumn.Beside, // 在旁边的编辑器中显示
                {
                    enableScripts: true, // 启用 JavaScript
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
                }
            );

            // 3. 将 Webview 面板的 HTML 内容设置为带有按钮的页面
            panel.webview.html = await getWebviewContent(panel.webview, context.extensionUri);

            // geometryOutputChannel?.append(panel.webview.html);

            // 4. 将脚本内容发送给 Webview
            panel.webview.onDidReceiveMessage(
                message => {
                    // 如果 webview 准备好了，就把脚本发过去
                    if (message.command === 'ready') {
                        panel.webview.postMessage({
                            command: 'executeScript',
                            script: scriptText
                        });
                    }
                },
                undefined,
                context.subscriptions
            );

        } else {
            vscode.window.showWarningMessage('No active Geometry Script editor found.');
        }
    });

    // 将新注册的命令也添加到订阅中，以便在插件停用时被正确销毁
    context.subscriptions.push(executeCommand);
}

// 用于生成 nonce 的辅助函数
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// 返回 Webview 页面 HTML 内容
async function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {

    const scriptPath = vscode.Uri.joinPath(extensionUri, 'media', 'geometry-interpreter.umd.js');
    const scriptUri = webview.asWebviewUri(scriptPath);

    const nonce = getNonce();

    // 这里可以传递绘图代码，假设绘图代码是从文件或文本中获取的
    const drawingCodeFile = vscode.Uri.joinPath(extensionUri, 'media', 'DrawGeometryView.html');
    const fileContentBytes = await vscode.workspace.fs.readFile(drawingCodeFile);
    const htmlTemplate = Buffer.from(fileContentBytes).toString('utf8');
    const drawingCode = htmlTemplate
                            .replace(/{{nonce}}/g, nonce)
                            .replace(/{{scriptUri}}/g, scriptUri.toString())
                            .replace(/{{cspSource}}/g, webview.cspSource);
    return drawingCode;
}