import * as vscode from 'vscode';

export function registerHover(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('geometryscript', {
            provideHover(document, position) {
                const range = document.getWordRangeAtPosition(position);
                if (!range) {
                    return undefined;
                }

                const word = document.getText(range);
                const keywordDescriptions: { [key: string]: string } = {
                    'clear': 'Clears the canvas or resets the drawing.',
                    'CREATE': 'Creates a new geometric object.',
                    'create': 'Creates a new geometric object with a specific name.',
                    'getobj': 'Retrieves an object by its name or ID.',
                    'draw': 'Draws a geometric object on the canvas.',
                    'measure': 'Measures a specific property of an object (e.g., distance).',
                    'calculate': 'Performs a calculation on geometric objects.',
                    'CALCULATE': 'Performs a calculation on geometric objects.',
                    'print': 'Prints the result or output of a calculation.',
                };

                const description = keywordDescriptions[word.toLowerCase()];
                if (description) {
                    return new vscode.Hover(description);
                }

                return undefined;
            }
        })
    );
}
