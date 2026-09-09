import * as vscode from 'vscode';

// --- 数据模型 ---

// 定义一个指令的结构，包含文档和代码片段
interface CommandInfo {
    documentation: vscode.MarkdownString;
    snippet: vscode.SnippetString;
}

// 1. 元指令及其参数 (从 executeMetaCommand 和相关函数中提取)
const metaCommands: Record<string, CommandInfo> = {
    'CREATE': {
        documentation: new vscode.MarkdownString('Begins the creation of a new geometric object. Press space to see available objects like `POINT`, `LINE`, etc.'),
        snippet: new vscode.SnippetString('CREATE ')
    },
    'CLEAR': {
        documentation: new vscode.MarkdownString('Clears the entire canvas.\n\n**Parameters:**\n* `color` or `c`: (Optional) The background color to fill the canvas with. Defaults to `white`.'),
        snippet: new vscode.SnippetString('CLEAR color=${1:white}')
    },
    'VIEW': {
        documentation: new vscode.MarkdownString('Sets the camera view of the canvas.\n\n**Parameters:**\n* `centerX`: The x-coordinate of the view center.\n* `centerY`: The y-coordinate of the view center.\n* `scale`: The zoom level. `1` is default, `>1` is zoom in, `<1` is zoom out.'),
        snippet: new vscode.SnippetString('VIEW centerX=${1:0} centerY=${2:0} scale=${3:1}')
    },
    'DRAW': {
        documentation: new vscode.MarkdownString('Draws a specified geometric object on the canvas.\n\n**Parameters:**\n* `obj`: The name of the object to draw.\n* `color` or `c`: (Optional) The stroke color.\n* `width`: (Optional) The line width.\n* `fill`: (Optional) The fill color for closed shapes.\n* `style`: (Optional) Can be set to `dashed`.\n* `label` or `l`: (Optional) A text label to draw near the object.'),
        snippet: new vscode.SnippetString('DRAW obj=${1:objectName} color=${2:black} width=${3:1} label="${4:}"')
    },
    'MEASURE': {
        documentation: new vscode.MarkdownString('Measures a property of an object and stores the result in a slot.\n\n**Parameters:**\n* `type` or `t`: The type of measurement (`distance`, `angle`, `area`).\n* `obj` or `o`: The object to measure.\n* `slot` or `s`: The name of the slot to store the result in.'),
        snippet: new vscode.SnippetString('MEASURE type=${1|distance,angle,area|} obj=${2:objectName} slot=${3:slotName}')
    },
    'RUN': {
        documentation: new vscode.MarkdownString('Executes a named block of code defined with the `CODE` command.'),
        snippet: new vscode.SnippetString('RUN code=${1:codeBlockName}')
    },
    'CODE': {
        documentation: new vscode.MarkdownString('Begins the definition of a named block of code. Subsequent lines until a line ending with `]` will be part of this block.'),
        snippet: new vscode.SnippetString('CODE name=${1:codeBlockName}')
    },
    'WITH': {
        documentation: new vscode.MarkdownString('Executes a code block with a given slot value.'),
        snippet: new vscode.SnippetString('WITH code=${1:codeBlockName} with=${2:slotValue}')
    },
    'GETOBJ': {
        documentation: new vscode.MarkdownString('Gets a property from an object and stores its name or value in a slot.\n\n**Parameters:**\n* `name` (`n`, `object`, `o`): The source object\'s name.\n* `property` (`p`): The name of the property to get (e.g., `center`, `radius`).\n* `slot` (`s`): The destination slot name.'),
        snippet: new vscode.SnippetString('GETOBJ name=${1:objectName} property=${2:propertyName} slot=${3:slotName}')
    },
    'CALCULATE': {
        documentation: new vscode.MarkdownString('Evaluates a mathematical expression and stores the result in a slot. You can use other slots in the expression.'),
        snippet: new vscode.SnippetString('CALCULATE expression="${1:{slot_A} + {slot_B}}" slot=${2:resultSlot}')
    },
    'PRINT': {
        documentation: new vscode.MarkdownString('Prints a message to the output channel. You can embed slot values using `{slotName}` syntax.'),
        snippet: new vscode.SnippetString('PRINT message="The value is: {my_slot_value}"')
    }
};

// 2. 几何指令及其参数 (从 executeGeometricCommand 和 create... 函数中提取)
const geometricCommands: Record<string, CommandInfo> = {
    'POINT': {
        documentation: new vscode.MarkdownString('Creates a point.\n\n**Parameters:**\n* `name`: The unique name for the point.\n* `x`, `y`: The coordinates.\n* `radius`: (Optional) The display radius of the point.\n* `real`: (Optional) `true` if it\'s a real construction point.'),
        snippet: new vscode.SnippetString('POINT name=${1:P1} x=${2:0} y=${3:0} radius=${4:1} real=${5|true,false|}')
    },
    'LINE': {
        documentation: new vscode.MarkdownString('Creates an infinite line passing through two points.'),
        snippet: new vscode.SnippetString('LINE name=${1:L1} p1=${2:P1} p2=${3:P2}')
    },
    'SEGMENT': {
        documentation: new vscode.MarkdownString('Creates a line segment between two points.'),
        snippet: new vscode.SnippetString('SEGMENT name=${1:S1} p1=${2:P1} p2=${3:P2}')
    },
    'RAY': {
        documentation: new vscode.MarkdownString('Creates a ray starting from a vertex and passing through another point.'),
        snippet: new vscode.SnippetString('RAY name=${1:R1} vertex=${2:V1} p1=${3:P1}')
    },
    'MIDPOINT': {
        documentation: new vscode.MarkdownString('Creates the midpoint of two given points.'),
        snippet: new vscode.SnippetString('MIDPOINT name=${1:M1} p1=${2:P1} p2=${3:P2}')
    },
    'INTERSECT': {
        documentation: new vscode.MarkdownString('Finds the intersection point(s) of two objects (lines, circles).\n\nFor two intersections, name them like `I1,I2`.'),
        snippet: new vscode.SnippetString('INTERSECT name=${1:I1} obj1=${2:obj1} obj2=${3:obj2}')
    },
    'POINT_ON_LINE': {
        documentation: new vscode.MarkdownString('Creates a point on a linear object at a specific distance from another point.'),
        snippet: new vscode.SnippetString('POINT_ON_LINE name=${1:P_on_L} line=${2:L1} point=${3:P1} distance=${4:10}')
    },
    'PERP_BISECTOR': {
        documentation: new vscode.MarkdownString('Creates the perpendicular bisector of the segment defined by two points.'),
        snippet: new vscode.SnippetString('PERP_BISECTOR name=${1:B1} p1=${2:P1} p2=${3:P2}')
    },
    'PERPENDICULAR': {
        documentation: new vscode.MarkdownString('Creates a line perpendicular to a given line and passing through a given point.'),
        snippet: new vscode.SnippetString('PERPENDICULAR name=${1:Perp1} line=${2:L1} point=${3:P1}')
    },
    'PARALLEL': {
        documentation: new vscode.MarkdownString('Creates a line parallel to a given line and passing through a given point.'),
        snippet: new vscode.SnippetString('PARALLEL name=${1:Para1} line=${2:L1} point=${3:P1}')
    },
    'ANGLE_BISECTOR': {
        documentation: new vscode.MarkdownString('Creates the bisector of a given angle.'),
        snippet: new vscode.SnippetString('ANGLE_BISECTOR name=${1:AB1} angle=${2:Angle1}')
    },
    'CIRCUMCIRCLE': {
        documentation: new vscode.MarkdownString('Creates the circumcircle of a triangle defined by three points.'),
        snippet: new vscode.SnippetString('CIRCUMCIRCLE name=${1:CC1} p1=${2:A} p2=${3:B} p3=${4:C}')
    },
    'INCIRCLE': {
        documentation: new vscode.MarkdownString('Creates the incircle of a triangle defined by three points.'),
        snippet: new vscode.SnippetString('INCIRCLE name=${1:IC1} p1=${2:A} p2=${3:B} p3=${4:C}')
    },
    'TANGENT': {
        documentation: new vscode.MarkdownString('Creates tangent line(s) or point(s) from a point to a circle.\n\nIf the point is outside the circle, two tangent points are created. Provide two names like `T1,T2`.'),
        snippet: new vscode.SnippetString('TANGENT name=${1:T1,T2} circle=${2:C1} point=${3:P1}')
    },
    'POLYGON': {
        documentation: new vscode.MarkdownString('Creates a polygon from a comma-separated list of point names.'),
        snippet: new vscode.SnippetString('POLYGON name=${1:Poly1} points=${2:P1,P2,P3,P4}')
    },
    'TRIANGLE': {
        documentation: new vscode.MarkdownString('Creates a triangle from three points. A specialized version of POLYGON.'),
        snippet: new vscode.SnippetString('TRIANGLE name=${1:T1} p1=${2:A} p2=${3:B} p3=${4:C}')
    },
    'RECTANGLE': {
        documentation: new vscode.MarkdownString('Creates a rectangle from a starting point, width, and height.'),
        snippet: new vscode.SnippetString('RECTANGLE name=${1:Rect1} p1=${2:A} width=${3:100} height=${4:50}')
    },
    'CIRCLE': {
        documentation: new vscode.MarkdownString('Creates a circle.\n\n**Primary Method:**\n* `center`, `radius`\n\n**Other Methods:**\n* `center`, `chord` (a segment object)\n* `center`, `chordPt1`, `chordPt2` (two points on the circle)'),
        snippet: new vscode.SnippetString('CIRCLE name=${1:C1} center=${2:P1} radius=${3:50}')
    },
    'ELLIPSE': {
        documentation: new vscode.MarkdownString('Creates an ellipse.'),
        snippet: new vscode.SnippetString('ELLIPSE name=${1:E1} center=${2:C1} radiusX=${3:100} radiusY=${4:50} rotation=${5:0}')
    },
    'ANGLE': {
        documentation: new vscode.MarkdownString('Creates an angle object.\n\n**Methods:**\n1. From three points: `vertex`, `p1`, `p2`.\n2. From two points and an angle value in degrees: `vertex`, `p1`, `angle`.'),
        snippet: new vscode.SnippetString('ANGLE name=${1:A1} vertex=${2:V} p1=${3:P1} p2=${4:P2}')
    },
    'FOCIS': {
        documentation: new vscode.MarkdownString('Finds the foci of a conic section (e.g., an ellipse) and creates them as points.\n\nProvide two names for the foci, like `F1,F2`.'),
        snippet: new vscode.SnippetString('FOCIS name=${1:F1,F2} obj=${2:ellipseName}')
    },
    'RANDOMPOINT': {
        documentation: new vscode.MarkdownString('Creates a random point on a linear object or a circle/ellipse edge.'),
        snippet: new vscode.SnippetString('RANDOMPOINT name=${1:RP1} obj=${2:objectName} start=${3:0} end=${4:1}')
    },
    'SLOT': {
        documentation: new vscode.MarkdownString('Creates a variable slot that can be used in expressions and parameter values.'),
        snippet: new vscode.SnippetString('SLOT name=${1:my_slot} value=${2:10}')
    },
    'ANIMATION': {
        documentation: new vscode.MarkdownString('Creates an animation that repeatedly executes a code block.'),
        snippet: new vscode.SnippetString('ANIMATION name=${1:anim1} code=${2:codeBlockName} slot=${3:frameCounter} interval=${4:100} repeat=${5|true,false|}')
    },
    'PARABOLA': {
        documentation: new vscode.MarkdownString('Creates a parabola. (Not yet fully implemented in source).'),
        snippet: new vscode.SnippetString('PARABOLA name=${1:Para1}')
    },
    'HYPERBOLA': {
        documentation: new vscode.MarkdownString('Creates a hyperbola. (Not yet fully implemented in source).'),
        snippet: new vscode.SnippetString('HYPERBOLA name=${1:Hyper1}')
    },
    'MOVE': {
        documentation: new vscode.MarkdownString('Applies a move transformation. (Not yet fully implemented in source).'),
        snippet: new vscode.SnippetString('MOVE')
    },
    'ROTATE': {
        documentation: new vscode.MarkdownString('Applies a rotation transformation. (Not yet fully implemented in source).'),
        snippet: new vscode.SnippetString('ROTATE')
    },
    'REFLECT': {
        documentation: new vscode.MarkdownString('Applies a reflection transformation. (Not yet fully implemented in source).'),
        snippet: new vscode.SnippetString('REFLECT')
    }
};

export function registerAdvancedCompletionItemProvider(context: vscode.ExtensionContext, geometryOutputChannel?: vscode.OutputChannel) {

    const provider = vscode.languages.registerCompletionItemProvider('geometryscript', {

        provideCompletionItems(
            document: vscode.TextDocument,
            position: vscode.Position
        ): vscode.ProviderResult<vscode.CompletionItem[]> {
            
            const linePrefix = document.lineAt(position).text.substring(0, position.character);

            // --- 上下文 1: 在 "CREATE " 之后，并且可能正在输入几何指令 ---
            // 新的正则表达式: 匹配 "CREATE " 开头，并捕获后面正在输入的词 (\w*)
            const createMatch = linePrefix.match(/\bCREATE\s+(\w*)$/i);
            if (createMatch) {
                // createMatch[1] 就是用户正在输入的词，例如 "p" 或 "po"
                const partialWord = createMatch[1];

                // 过滤几何指令，只显示以 partialWord 开头的
                const filteredCommands = Object.entries(geometricCommands)
                    .filter(([label, info]) => label.startsWith(partialWord.toUpperCase()));
                
                return filteredCommands.map(([label, info]) => {
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
                    item.insertText = info.snippet;
                    item.documentation = info.documentation;
                    return item;
                });
            }

            // --- 上下文 2: 在其他指令后提供参数提示 ---
            const commandMatch = linePrefix.match(/^(\w+)\s/);
            if (commandMatch) {
                const command = commandMatch[1].toUpperCase();
                // 确保不是 CREATE 指令，避免冲突
                if (command !== 'CREATE') { 
                    const allCommands = { ...metaCommands, ...geometricCommands };
                    if (allCommands[command]) {
                        // ... (这部分参数提示逻辑保持不变)
                        const snippet = allCommands[command].snippet.value;
                        const paramsInSnippet = [...snippet.matchAll(/(\w+)=\${/g)].map(m => m[1]);
                        const alreadyTypedParams = [...linePrefix.matchAll(/\s(\w+)=/g)].map(m => m[1]);
                        const availableParams = paramsInSnippet.filter(p => !alreadyTypedParams.includes(p));
                        return availableParams.map(param => {
                            const item = new vscode.CompletionItem(param, vscode.CompletionItemKind.Property);
                            item.insertText = `${param}=`;
                            item.command = { title: 'Trigger Suggest', command: 'editor.action.triggerSuggest' };
                            return item;
                        });
                    }
                }
            }

            // --- 上下文 3: 顶层默认提示 (元指令) ---
            // 确保我们不在输入一个词的中间，避免干扰
            if (!/\w+$/.test(linePrefix)) {
                return Object.entries(metaCommands).map(([label, info]) => {
                    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
                    item.insertText = info.snippet;
                    item.documentation = info.documentation;
                    return item;
                });
            }
            
            // 如果其他情况都不满足，返回空，避免不必要的提示
            return [];
        }
    }, ' ');

    context.subscriptions.push(provider);
}