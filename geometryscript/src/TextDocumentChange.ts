import * as vscode from 'vscode';

export function handleDidTextDocumentChange(event: vscode.TextDocumentChangeEvent, diagCollection: vscode.DiagnosticCollection) {
    if (event.document.languageId !== 'geometryscript') {
        return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const text = event.document.getText();
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (/create/i.test(line) && !/name=/.test(line)) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(index, 0, index, line.length),
                'Missing `name=` in create statement',
                vscode.DiagnosticSeverity.Warning
            ));
        }
        if (/CALCULATE/i.test(line) && !/expression=/.test(line)) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(index, 0, index, line.length),
                'Missing `expression=` in CALCULATE statement',
                vscode.DiagnosticSeverity.Warning
            ));
        }
    });
    diagCollection.set(event.document.uri, diagnostics);
}