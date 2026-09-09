import * as vscode from 'vscode';

import { registerAdvancedCompletionItemProvider } from './AdvancedCompletionItem';
import { CreateDrawView } from './CreateDrawGeometryView';
import { RegisterSaveTextDocumentHandle } from './SaveTextDocument';
import { registerHover } from './Hover';
import { handleDidTextDocumentChange } from './TextDocumentChange';
import { registerSidebar } from './ChatPanelViewProvider'; 

let geometryChannel: vscode.OutputChannel | undefined = undefined;

function registerChannel(context: vscode.ExtensionContext) {
    // 创建 Geometry 输出通道
    geometryChannel = vscode.window.createOutputChannel('Geometry');
    
    // 将 Geometry 通道显示在输出面板中，并使其成为默认通道
    geometryChannel.show(true);  // true 会让 Geometry 通道成为默认显示的通道
    
    // 示例：向 Geometry 输出通道写入信息
    geometryChannel.appendLine('Geometry script started...');
    
    // 注册一个命令，用来在 Geometry 通道输出日志
    let disposable = vscode.commands.registerCommand('extension.geometryLog', () => {
        if (geometryChannel) 
            geometryChannel.appendLine('Logging a new geometry message...');
    });

    context.subscriptions.push(disposable);

    return geometryChannel;
}


export function activate(context: vscode.ExtensionContext) {
    console.log('GeometryScript extension activated'); // 调试输出

    // 注册通道
    registerChannel(context);

    // 注册AI对话面板
    registerSidebar(context);

    // 注册智能提示
    registerAdvancedCompletionItemProvider(context, geometryChannel);

    // 注册基础诊断 (简单错误检查)
    const diagCollection = vscode.languages.createDiagnosticCollection('GeometryScript');
    context.subscriptions.push(diagCollection);
    vscode.workspace.onDidChangeTextDocument(event => handleDidTextDocumentChange(event, diagCollection));

    // 注册关键字提示
    registerHover(context);

    // 创建绘图页面
    CreateDrawView(context, geometryChannel);

    // 注册保存事件
    RegisterSaveTextDocumentHandle(context, geometryChannel);
}

export function deactivate() {
    if (geometryChannel) {
        geometryChannel.dispose()
        geometryChannel = undefined;
    }
}
