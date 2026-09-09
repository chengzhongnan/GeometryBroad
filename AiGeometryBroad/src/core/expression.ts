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

function isFunction(token: string, customFunctions: Map<string, CustomFunction>): boolean {
    return token in SUPPORTED_FUNCTIONS || customFunctions.has(token);
}

// 变量名不能与函数名冲突
function isVariable(token: string, customFunctions: Map<string, CustomFunction>): boolean {
    const isIdentifier = /^[a-zA-Z_]\w*$/.test(token);
    const isArg = /^args\[\d+\]$/.test(token);
    return (isIdentifier || isArg) && !isFunction(token, customFunctions);
}

function isOperator(token: string): boolean {
    return token in OPERATOR_PRECEDENCE;
}

/**
 * 将表达式字符串分解为令牌数组 (更新版).
 * 新增对逗号的支持。
 * @param expression - 原始表达式字符串.
 * @returns 令牌字符串数组.
 */
function tokenize(expression: string): string[] {
    const regex = /args\[\d+\]|[a-zA-Z_]\w*|\d+\.?\d*|[+\-*/%^(),]/g;
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
function infixToRpn(tokens: string[], slots: Map<string, any>, customFunctions: Map<string, CustomFunction>): (string | number)[] {
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
                // 在函数定义时，args[n] 在 slots 中找不到是正常的，将其作为文本 token 推入队列
                // 在函数执行时，它将在 augmented slots 中找到值
                outputQueue.push(token); 
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
function evaluateRpn(rpnTokens: (string | number)[], slots: Map<string, any>, customFunctions: Map<string, CustomFunction>): number {
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

                // 使用增强后的 slots 递归调用 calculate
                const result = calculate(funcDef.expression, executionSlots, customFunctions);
                stack.push(result);
            }
        } else if (typeof token === 'string' && isVariable(token, customFunctions)) {
            // 这个分支处理 RPN 队列中以字符串形式存在的变量（包括 args[n]）
            const value = slots.get(token);
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
 * @returns 表达式的计算结果.
 */
export function calculate(expression: string, 
    slots: Map<string, number | string | Boolean>,
    functions: Map<string, CustomFunction>
): number {
    const tokens = tokenize(expression);
    const rpn = infixToRpn(tokens, slots, functions);
    const result = evaluateRpn(rpn, slots, functions);
    return optimizeResult(result);
}