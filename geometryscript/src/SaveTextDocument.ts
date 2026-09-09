import * as vscode from 'vscode';

export function RegisterSaveTextDocumentHandle(context: vscode.ExtensionContext, geometryOutputChannel?: vscode.OutputChannel) {
        // 监听文本文档保存事件
        const onSaveDisposable = vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
        
            // 1. 检查被保存的文档语言ID是否是我们的脚本语言
            if (document.languageId === 'geometryscript') {
                
                // (可选) 在输出面板打印一条日志，方便调试
                // if (geometryOutputChannel) { // 确保 output channel 存在
                //     geometryOutputChannel.appendLine(`[AUTO-RUN] Detected save on: ${document.fileName}. Triggering drawing update...`);
                // }
    
                // 2. 如果是，就执行我们之前定义好的 showDrawing 命令
                vscode.commands.executeCommand('extension.showDrawing');
            }
        });
    
        // 3. 将事件监听也添加到订阅中，以便在插件停用时被正确销毁
        context.subscriptions.push(onSaveDisposable);
}