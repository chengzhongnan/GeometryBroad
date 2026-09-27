import type { CustomFunction } from './geometry/types';

// 定义操作符的类型和优先级
const OPERATOR_PRECEDENCE: { [key: string]: number } = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '%': 2,
    '^': 3, // 幂运算
};

// 存储函数的实现
const SUPPORTED_FUNCTIONS: { [key: string]: (...args: number[]) => number } = {
    exp: Math.exp,
    log: Math.log, // 注意: 这是自然对数 ln
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    cot: (x) => 1 / Math.tan(x), // cot(x) = 1 / tan(x)
    arcsin: Math.asin,
    asin: Math.asin, // arcsin 和 asin 是同一个函数
    arccos: Math.acos,
    acos: Math.acos,
    arctan: Math.atan,
    atan: Math.atan,
    arctan2: Math.atan2,
    atan2: Math.atan2,
    arccot: (x) => Math.PI / 2 - Math.atan(x), // arccot(x) = PI/2 - arctan(x)
    acot: (x) => Math.PI / 2 - Math.atan(x),
    arccot2: (x, y) => Math.PI / 2 - Math.atan2(x, y),
    acot2: (x, y) => Math.PI / 2 - Math.atan2(x, y),
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    pow: Math.pow,
    sqrt: Math.sqrt,
    PI: () => Math.PI, // 支持 π 常量
    E: () => Math.E, // 支持 e 常量
    mod: (a, b) => a % b, // 模运算
    random: Math.random, // 支持随机数生成
    max: (a, b) => Math.max(a, b), // 最大值函数
    min: (a, b) => Math.min(a, b), // 最小值函数
};

// 存储函数需要的参数个数
const FUNCTION_ARITY: { [key: string]: number } = {
    exp: 1, log: 1, sin: 1, cos: 1, tan: 1, cot: 1,
    arcsin: 1, arccos: 1, arctan: 1, arccot: 1,
    abs: 1, floor: 1, ceil: 1,
    pow: 2, // pow 是一个双参数函数
    sqrt: 1, 
    PI: 0, E: 0, // π 和 e 是常量函数，无参数
    mod: 2, // 模运算是双参数函数
    random: 0, // random 是无参数函数
    max: 2, // 最大值函数
    min: 2, // 最小值函数
    asin: 1, acos: 1, atan: 1, acot: 1,
    arctan2: 2, atan2: 2, arccot2: 2, acot2: 2,
};

// 辅助函数：判断一个字符串是否是数字
function isNumeric(token: string): boolean {
    return !isNaN(parseFloat(token)) && isFinite(Number(token));
}

// ─────────────────────────────────────────────────────────────────────────────
// 属性穿透：`A.x` / `A_x`
//
// 表达式里可以直接读几何对象的属性，例如 `{A.x + 50}`、`{c1.radius * 2}`、
// `{c1.center.y}`。语言层面要解决两件事：
//
//   1. **词法**：`A.x` 必须被整体吞成一个复合标识符，而不是 `A` + `.` + `x`
//      三个 token（`.` 原本根本不在 token 正则里，`A.x` 会被静默拆成 `A` 和 `x`，
//      然后报「变量找不到」这种看不出根因的错）。
//   2. **依赖**：`{A.x + 50}` 里的 `A` 是一种**拓扑依赖**（B 的坐标由 A 决定），
//      删除 A 时必须能算出「谁依赖 A」。这件事**不需要求值**就能做，见
//      `collectMemberReferences` —— 它是纯词法扫描，所以没有对象表的调用方
//      （比如改写脚本的 `dslObjectEditing`）也能用。
//
// 真正的取值（`A` 到底有没有 `x`、值是多少）由调用方注入的 `MemberResolver` 决定，
// 因为只有解释器手里有对象表和属性表。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `对象.属性` 里允许出现的属性名（小写），**唯一的权威清单**。
 *
 * 之所以要有一份封闭词表，是因为下划线写法（`A_x`）在纯词法层面必须有办法判断
 * 「切在哪」：`seg_len` 到底是「槽位 seg_len」还是「对象 seg 的 len 属性」？
 * 只有属性名是封闭集合时，才能靠「切点右边是不是一个属性名」来判定。
 *
 * 解释器里的 `readMember` 是这份清单的**实现**，两边必须同步
 * （`expression-member-access-regression` 里有对照断言）。
 */
export const MEMBER_PROPERTIES: ReadonlySet<string> = new Set([
    // 点
    'x', 'y', 'r', 'radius',
    // 圆 / 椭圆
    'center', 'c', 'd', 'diameter', 'area', 'circumference', 'perimeter',
    'rx', 'radiusx', 'ry', 'radiusy', 'rotation', 'rotationdegrees',
    // 线性对象
    'length', 'len', 'p1', 'p2', 'dx', 'dy',
    // 角 / 圆锥曲线 / 多边形 / 曲线
    'value', 'radians', 'degrees', 'vertex', 'v',
    'p', 'pvalue', 'a', 'avalue', 'b', 'bvalue',
    'n', 'vertexcount', 'start', 'end',
]);

/** 一次属性穿透引用：`A.x` / `c1.center.y` / `A_x`。 */
export interface MemberReference {
    /** 原始复合标识符，原样保留 —— 调用方要用它去查槽位/对象名。 */
    token: string;
    /** 根标识符（对象名）。 */
    root: string;
    /** 属性路径：`c1.center.y` -> `['center', 'y']`；下划线写法恒为一段。 */
    path: string[];
}

/** 标识符的一段（不能以数字开头）。 */
const IDENTIFIER_PART = /^[a-zA-Z_]\w*$/;

/**
 * 把一个复合标识符切成「根 + 属性路径」；不是属性穿透就返回 `null`。
 *
 * 两种写法：
 *   - **点号** `A.x` / `c1.center.y`：显式、无歧义，路径可以任意长。
 *   - **下划线** `A_x`：只能是一段属性。切法是「从右往左找第一个能对上属性词表的切点」——
 *     纯词法就能判定，不需要对象表。注意它天然有歧义（对象名里本来就常含下划线），
 *     所以运行时会再按「名字整个对得上就优先当对象/槽位」过滤一次；
 *     **静态依赖扫描只认点号**，见 `collectMemberReferences`。
 */
export function splitMemberToken(token: string): MemberReference | null {
    if (token.includes('.')) {
        const parts = token.split('.');
        if (parts.length < 2 || !parts.every(part => IDENTIFIER_PART.test(part))) return null;
        return { token, root: parts[0], path: parts.slice(1) };
    }

    for (let index = token.lastIndexOf('_'); index > 0; index = token.lastIndexOf('_', index - 1)) {
        const property = token.slice(index + 1);
        if (MEMBER_PROPERTIES.has(property.toLowerCase())) {
            return { token, root: token.slice(0, index), path: [property] };
        }
    }
    return null;
}

/**
 * 语法上「像属性穿透」的 token（点号写法 + 下划线写法都算），去重、保序。
 *
 * **不做任何对象表/槽位表的判定** —— 那是调用方的事。之所以要单独暴露这一步，
 * 是因为下划线写法天生有歧义（`seg_len` 既可能是槽位、也可能是「seg 的 len」），
 * 只有拿到 token 原文，调用方才能按「名字整个对得上就优先当槽位/对象」过滤。
 */
export function collectMemberTokens(expression: string): string[] {
    let tokens: string[];
    try {
        tokens = tokenize(expression);
    } catch {
        return []; // 空表达式 / 完全无法分词：没有依赖可谈
    }

    const seen = new Set<string>();
    const found: string[] = [];
    for (const token of tokens) {
        if (seen.has(token) || !splitMemberToken(token)) continue;
        seen.add(token);
        found.push(token);
    }
    return found;
}

/**
 * 静态扫出表达式里所有属性穿透引用 —— **不执行、不求值**。
 *
 * 这就是「拓扑依赖收集」那一步：`{A.x + 50}` 里的 `A` 不需要算出来也能被精确抓到，
 * 于是改写脚本/删除对象这类**没有解释器**的场合也能算出依赖关系。
 *
 * 只返回**点号**写法：下划线写法在纯字符串层面和对象名/槽位名里的下划线分不开
 * （`seg_len` 会被误判成 `seg` 的 `len`），静态硬猜会把依赖算多、
 * 进而删掉无关对象 —— 比「依赖漏算、重跑时报一条错」危险得多。
 * 下划线写法只保证**求值**正确（运行时按槽位/对象名优先过滤，见解释器的 resolveMemberValue）。
 */
export function collectMemberReferences(expression: string): MemberReference[] {
    const references: MemberReference[] = [];
    for (const token of collectMemberTokens(expression)) {
        if (!token.includes('.')) continue;
        const reference = splitMemberToken(token);
        if (reference) references.push(reference);
    }
    return references;
}

/**
 * `对象.属性` 的取值器。由调用方注入 —— 只有解释器知道对象表和属性表。
 * 返回 `undefined` 表示「这个 token 不是属性穿透」，让引擎照旧报「变量找不到」。
 */
export type MemberResolver = (token: string) => number | undefined;

function isFunction(token: string, customFunctions: Map<string, CustomFunction>): boolean {
    return token in SUPPORTED_FUNCTIONS || customFunctions.has(token);
}

// 变量名不能与函数名冲突
function isVariable(token: string, customFunctions: Map<string, CustomFunction>): boolean {
    // 允许复合标识符：`A.x` / `c1.center.y` 也是一个变量（属性穿透的取值由 resolver 提供）。
    const isIdentifier = /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(token);
    const isArg = /^args\[\d+\]$/.test(token);
    return (isIdentifier || isArg) && !isFunction(token, customFunctions);
}

function isOperator(token: string): boolean {
    return token in OPERATOR_PRECEDENCE;
}

/**
 * 将表达式字符串分解为令牌数组 (更新版).
 * 新增对逗号的支持。
 *
 * `[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*` 这个分支让 `A.x` / `c1.center.y` **整体**成为一个
 * 复合标识符 —— 点号不是运算符，切成 `A` `.` `x` 三段的话中间那段没人认识，
 * 会被静默丢掉，最后报一个和真正原因无关的错。数字分支在它后面，
 * 所以 `1.5` 仍然按数字切。
 *
 * @param expression - 原始表达式字符串.
 * @returns 令牌字符串数组.
 */
function tokenize(expression: string): string[] {
    const regex = /args\[\d+\]|[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*|\d+\.?\d*|[+\-*/%^(),]/g;
    const tokens = expression.match(regex);
    if (!tokens) {
        throw new Error("Cannot tokenize expression.");
    }
    return tokens;
}

/**
 * 使用 Shunting-yard 算法将中缀表达式转换为后缀表达式 (RPN) (更新版).
 * 新增了对函数和逗号的处理逻辑。
 * @param tokens - 令牌数组.
 * @param slots - 包含变量值的 Map.
 * @returns RPN 格式的令牌数组.
 */
function infixToRpn(
    tokens: string[],
    slots: Map<string, any>,
    customFunctions: Map<string, CustomFunction>,
    resolveMember?: MemberResolver,
): (string | number)[] {
    const outputQueue: (string | number)[] = [];
    const operatorStack: string[] = [];

    for (const token of tokens) {
        if (isNumeric(token)) {
            outputQueue.push(parseFloat(token));
        } else if (isFunction(token, customFunctions)) {
            operatorStack.push(token);
        } else if (isVariable(token, customFunctions)) {
            // 因为 isVariable 现在能识别 args[n]，所以这里的逻辑可以统一处理普通 slot 变量和函数参数
            const value = slots.get(token);
            if (value === undefined) {
                // 槽位里没有 —— 可能是 `A.x` / `A_x` 这种属性穿透，交给调用方注入的取值器。
                // 取不到就照旧把 token 原样推入队列，留给 evaluateRpn 报「变量找不到」。
                const member = resolveMember?.(token);
                if (member !== undefined) outputQueue.push(member);
                else outputQueue.push(token);
            } else if (typeof value === 'number') {
                outputQueue.push(value);
            } else {
                const numValue = parseFloat(value.toString());
                if (isNaN(numValue)) throw new Error(`Value of variable '${token}' ('${value}') is not a number.`);
                outputQueue.push(numValue);
            }
        } else if (token === ',') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                outputQueue.push(operatorStack.pop()!);
            }
            if (operatorStack.length === 0) {
                throw new Error("Mismatched commas or parentheses in function arguments.");
            }
        } else if (isOperator(token)) {
            while (
                operatorStack.length > 0 &&
                isOperator(operatorStack[operatorStack.length - 1]) &&
                OPERATOR_PRECEDENCE[operatorStack[operatorStack.length - 1]] >= OPERATOR_PRECEDENCE[token]
            ) {
                outputQueue.push(operatorStack.pop()!);
            }
            operatorStack.push(token);
        } else if (token === '(') {
            operatorStack.push(token);
        } else if (token === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                outputQueue.push(operatorStack.pop()!);
            }
            if (operatorStack.length === 0) {
                throw new Error("Mismatched parentheses.");
            }
            operatorStack.pop(); // Pop '('.
            if (operatorStack.length > 0 && isFunction(operatorStack[operatorStack.length - 1], customFunctions)) {
                outputQueue.push(operatorStack.pop()!);
            }
        }
    }

    while (operatorStack.length > 0) {
        const op = operatorStack.pop()!;
        if (op === '(') {
            throw new Error("Mismatched parentheses.");
        }
        outputQueue.push(op);
    }
    return outputQueue;
}

/**
 * 计算后缀表达式 (RPN) 的值 (更新版).
 * 新增了函数求值的逻辑。
 * @param rpnTokens - RPN 格式的令牌数组.
 * @returns 计算结果.
 */
function evaluateRpn(
    rpnTokens: (string | number)[],
    slots: Map<string, any>,
    customFunctions: Map<string, CustomFunction>,
    resolveMember?: MemberResolver,
): number {
    const stack: number[] = [];

    for (const token of rpnTokens) {
        if (typeof token === 'number') {
            stack.push(token);
        } else if (isOperator(token as string)) {
            if (stack.length < 2) throw new Error("Invalid expression: operator needs two operands.");
            const b = stack.pop()!;
            const a = stack.pop()!;
            let result: number;
            switch (token) {
                case '+': result = a + b; break;
                case '-': result = a - b; break;
                case '*': result = a * b; break;
                case '/': if (b === 0) throw new Error("Division by zero."); result = a / b; break;
                case '%': if (b === 0) throw new Error("Modulo by zero."); result = a % b; break;
                case '^': result = Math.pow(a, b); break;
                default: throw new Error(`Unknown operator: ${token}`);
            }
            stack.push(result);
        } else if (isFunction(token as string, customFunctions)) {
            const funcName = token as string;
            
            if (funcName in SUPPORTED_FUNCTIONS) {
                const arity = FUNCTION_ARITY[funcName];
                const func = SUPPORTED_FUNCTIONS[funcName];
                if (stack.length < arity) throw new Error(`Function '${funcName}' needs ${arity} arguments.`);
                const args = stack.splice(stack.length - arity, arity);
                const result = func(...args);
                stack.push(result);

            /**
             * 创建临时的 slot/作用域来传递参数。
             */
            } else if (customFunctions.has(funcName)) {
                const funcDef = customFunctions.get(funcName)!;
                const arity = funcDef.argCount;
                if (stack.length < arity) throw new Error(`Custom function '${funcName}' needs ${arity} arguments.`);
                
                const args = stack.splice(stack.length - arity, arity);
                
                // 创建一个专用于本次函数调用的参数 map
                const argSlots = new Map<string, number>();
                for (let i = 0; i < arity; i++) {
                    argSlots.set(`args[${i + 1}]`, args[i]);
                }

                // 将参数 map 与全局的 slots map 合并，参数优先
                const executionSlots = new Map([...slots, ...argSlots]);

                // 使用增强后的 slots 递归调用 calculate。
                // `resolveMember` 必须一起传下去，否则 `{f(A.x)}` 这种写法在函数体里就断了。
                const result = calculate(funcDef.expression, executionSlots, customFunctions, resolveMember);
                stack.push(result);
            }
        } else if (typeof token === 'string' && isVariable(token, customFunctions)) {
            // 这个分支处理 RPN 队列中以字符串形式存在的变量（包括 args[n]）
            // 以及槽位/对象表都查不到的复合标识符（属性穿透的兜底在这里再试一次）。
            const value = slots.get(token) ?? resolveMember?.(token);
            if(typeof value !== 'number') {
                throw new Error(`Variable '${token}' not found or its value is not a number during evaluation.`);
            }
            stack.push(value);
        }
    }

    if (stack.length !== 1) {
        throw new Error("Invalid expression format.");
    }
    return stack[0];
}


/**
 * 优化计算结果，处理浮点数精度问题。
 * - 如果一个数非常接近一个整数（如 1.999999999 或 0.000000001），则四舍五入到该整数。
 * - 如果一个数的绝对值非常小（如 10e-10），则将其视为 0。
 * @param value - 原始计算结果。
 * @param epsilon - 可接受的误差范围，默认为 1e-9。
 * @returns 优化后的数字。
 */
function optimizeResult(value: number, epsilon: number = 1e-9): number {
    // 首先，不对 NaN 或无穷大进行处理
    if (!isFinite(value)) {
        return value;
    }

    // 找到最接近的整数
    const roundedValue = Math.round(value);

    // 计算原始值与最接近整数之间的差的绝对值
    const difference = Math.abs(value - roundedValue);

    // 如果差值在我们的误差范围内，就返回那个整数
    // 这同时处理了接近0和接近其他整数的情况
    if (difference < epsilon) {
        return roundedValue;
    }

    // 否则，返回原始值
    return value;
}

/**
 * 计算包含变量和函数的算术表达式的值.
 * @param expression - 算术表达式字符串.
 * @param slots - 存储变量及其值的 Map.
 * @param functions - 函数
 * @param resolveMember - 可选的属性穿透取值器，用于 `{A.x + 50}` 这类写法。
 *   不传时复合标识符一律按普通变量处理（找不到就报错），所以不关心几何对象的调用方
 *   （例如纯数学场景）行为完全不变。
 * @returns 表达式的计算结果.
 */
export function calculate(expression: string, 
    slots: Map<string, number | string | Boolean>,
    functions: Map<string, CustomFunction>,
    resolveMember?: MemberResolver,
): number {
    const tokens = tokenize(expression);
    const rpn = infixToRpn(tokens, slots, functions, resolveMember);
    const result = evaluateRpn(rpn, slots, functions, resolveMember);
    return optimizeResult(result);
}