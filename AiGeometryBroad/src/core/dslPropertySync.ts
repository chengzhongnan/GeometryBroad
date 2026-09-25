import type { ObjectPropertyKey } from './DSLInterpreter';

export interface DslPropertyUpdate {
    script: string;
    lineNumber: number;
}

// 把属性改动同步回代码时附带的定位信息：解释器在渲染时建立的
// “代码行 <-> 对象”映射给出的真实物理行号（1-based）。
// 有了它就不必再靠 name= 在全文件里猜，跨行指令、注释、重名都不会改错行。
export interface PropertySyncOptions {
    lineNumber?: number | null;
}

const PARAMETER_ALIASES: Record<ObjectPropertyKey, string[]> = {
    x: ['x'],
    y: ['y'],
    radius: ['radius', 'r'],
    radiusX: ['radiusX', 'rx'],
    radiusY: ['radiusY', 'ry'],
    rotation: ['rotation', 'angle'],
    width: ['width', 'w'],
    height: ['height', 'h'],
};

// POINT 的 frozen 是布尔属性，单独处理（见 updateDslObjectFrozen）。
const FROZEN_ALIASES = ['frozen'];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isObjectDefinitionLine(line: string, name: string): boolean {
    const escapedName = escapeRegExp(name);
    return new RegExp(`(?:^|\\s)name=(?:"${escapedName}"|'${escapedName}'|${escapedName})(?=\\s|$)`, 'i').test(line);
}

// 整行注释不参与对象定义匹配，避免 `# name=foo ...` 这类注释被改到。
function isCommentLine(line: string): boolean {
    return /^\s*#/.test(line);
}

// 判断某个下标是否落在引号字符串内部。参数值里经常出现长得像参数的片段
// （例如 TEXT 的 LaTeX `$x=1$`），改属性时必须跳过这些位置。
export function isInsideQuotes(line: string, index: number): boolean {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < index && i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "'" && !inDouble) inSingle = !inSingle;
    }
    return inDouble || inSingle;
}

function replaceParameter(line: string, aliases: string[], value: string): string | null {
    const found = findParameter(line, aliases);
    if (!found) return null;
    return line.slice(0, found.index) + found.prefix + value + line.slice(found.end);
}

interface ParameterMatch {
    index: number;
    end: number;
    // 形如 `frozen=` 的原文（含等号），保留用户写法的大小写和空格。
    prefix: string;
}

function findParameter(line: string, aliases: string[]): ParameterMatch | null {
    const aliasPattern = aliases.map(escapeRegExp).join('|');
    const parameter = new RegExp(`(\\b(?:${aliasPattern})\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s]+)`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = parameter.exec(line)) !== null) {
        if (!isInsideQuotes(line, match.index)) {
            return { index: match.index, end: match.index + match[0].length, prefix: match[1] };
        }
        parameter.lastIndex = match.index + 1;
    }
    return null;
}

// 行尾注释的起点（`... # 说明` 里 `#` 的位置），没有则返回 -1。
// 判定与解释器 parseLine 里的 `/(^|\s)#/` 保持一致：只有行首或空白后的 `#`
// 才是注释，`color=#eeeeee` 这种值内部的 `#` 不算。
function findTrailingCommentIndex(line: string): number {
    const match = /(^|\s)#/.exec(line);
    if (!match) return -1;
    return match.index + match[1].length;
}

// 在行尾补一个参数。新参数要插在行尾注释之前，否则会被当成注释内容而失效。
function appendParameter(line: string, key: string, value: string): string {
    const commentIndex = findTrailingCommentIndex(line);
    const head = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const tail = commentIndex >= 0 ? line.slice(commentIndex) : '';
    const trimmedHead = head.replace(/\s+$/, '');
    const separator = trimmedHead ? ' ' : '';
    const suffix = tail ? ` ${tail}` : '';
    return `${trimmedHead}${separator}${key}=${value}${suffix}`;
}

// 候选行按可靠性排序：
//   1. 解释器给出的真实行号（渲染时建立的映射，最准）；
//   2. 无 name 的 TEXT 生成的 text_<行号> 名称；
//   3. 兜底：按 name= 全文件匹配（仅限有 name 的对象）。
function collectCandidateLines(
    lines: string[],
    name: string,
    options?: PropertySyncOptions,
): { candidates: number[]; syntheticIndex: number } {
    const syntheticTextLine = /^text_(\d+)$/i.exec(name)?.[1];
    const syntheticIndex = syntheticTextLine ? Number(syntheticTextLine) - 1 : -1;
    const candidates: number[] = [];
    const seen = new Set<number>();
    const pushCandidate = (index: number) => {
        if (index < 0 || index >= lines.length || seen.has(index)) return;
        seen.add(index);
        candidates.push(index);
    };
    if (options?.lineNumber && options.lineNumber > 0) pushCandidate(options.lineNumber - 1);
    if (syntheticIndex >= 0) {
        pushCandidate(syntheticIndex);
    } else {
        lines.forEach((_, index) => pushCandidate(index));
    }
    return { candidates, syntheticIndex };
}

export function updateDslObjectProperty(
    script: string,
    name: string,
    key: ObjectPropertyKey,
    value: number,
    options?: PropertySyncOptions,
): DslPropertyUpdate | null {
    if (!name || !Number.isFinite(value)) return null;
    const aliases = PARAMETER_ALIASES[key];
    if (!aliases) return null;

    const lines = script.split('\n');
    const formattedValue = String(Math.round(value * 1_000_000) / 1_000_000);

    const { candidates, syntheticIndex } = collectCandidateLines(lines, name, options);

    for (const index of candidates) {
        const target = lines[index];
        if (isCommentLine(target)) continue;
        const matchesNamedObject = isObjectDefinitionLine(target, name);
        // 合成名称 text_<行号> 只允许落在对应行上的 TEXT 指令，避免误改其它文本。
        const matchesSyntheticText = index === syntheticIndex && /^\s*TEXT\b/i.test(target);
        if (!matchesNamedObject && !matchesSyntheticText) continue;
        const replaced = replaceParameter(target, aliases, formattedValue);
        if (replaced === null) return null;
        lines[index] = replaced;
        return { script: lines.join('\n'), lineNumber: index + 1 };
    }
    return null;
}

// 截止点参数的全部写法。三个名字等价，替换时保留用户原来用的那一个。
const CUT_POINT_ALIASES = ['cutPoints', 'cutoffPoints', 'cuts'];

// 能带 cutPoints 的指令。和 isPointDefinitionLine 同理：行号过期、指向了别的指令时直接放弃，
// 而不是把 cutPoints= 乱插到一条 CREATE CIRCLE 上。
function isLinearDefinitionLine(line: string): boolean {
    return /^\s*(?:CREATE\s+)?(?:LINE|SEGMENT|RAY|PERP_BISECTOR|PERPENDICULAR|PARALLEL|ANGLE_BISECTOR)\b/i.test(line);
}

// 把某个参数整个删掉（连同它前面多余的空格），没有则返回 null。
function removeParameter(line: string, aliases: string[]): string | null {
    const found = findParameter(line, aliases);
    if (!found) return null;
    const head = line.slice(0, found.index).replace(/\s+$/, '');
    const tail = line.slice(found.end).replace(/^\s+/, '');
    return tail ? `${head} ${tail}` : head;
}

/**
 * 把线性对象的 `cutPoints` 属性写回脚本。
 *
 * 它是一串「点名 + 方向」而不是数值，所以不能走 PARAMETER_ALIASES（那张表只处理数值）：
 *   - 值为空：把 `cutPoints=` 整个删掉（不再截断）；
 *   - 参数已存在：原地替换（保留用户原本写的 cutPoints / cutoffPoints / cuts）；
 *   - 参数不存在：补在行尾（行尾注释之前），否则会被当成注释内容而失效。
 *
 * 返回 null 表示脚本不需要变，调用方不要因此清空日志或重跑脚本。
 */
export function updateDslObjectCutPoints(
    script: string,
    name: string,
    value: string,
    options?: PropertySyncOptions,
): DslPropertyUpdate | null {
    if (!name) return null;

    const lines = script.split('\n');
    const { candidates } = collectCandidateLines(lines, name, options);
    const normalized = value.trim();

    for (const index of candidates) {
        const target = lines[index];
        if (isCommentLine(target)) continue;
        if (!isLinearDefinitionLine(target)) continue;
        if (!isObjectDefinitionLine(target, name)) continue;

        if (!normalized) {
            const stripped = removeParameter(target, CUT_POINT_ALIASES);
            if (stripped === null || stripped === target) return null;
            lines[index] = stripped;
            return { script: lines.join('\n'), lineNumber: index + 1 };
        }

        const next = replaceParameter(target, CUT_POINT_ALIASES, normalized)
            ?? appendParameter(target, 'cutPoints', normalized);
        if (next === target) return null;
        lines[index] = next;
        return { script: lines.join('\n'), lineNumber: index + 1 };
    }
    return null;
}

// `DRAW` 行上标签的全部写法（`l` 见 updateDslObjectLabel 的说明）。
const LABEL_ALIASES = ['label', 'l'];

// `DRAW obj=X` / `DRAW o=X,Y` 里是否画了 name。`DRAW` 允许一次画多个对象（逗号分隔），
// 所以要把值拆开逐个比，不能直接拿字符串相等去判。
function isDrawLineForObject(line: string, name: string): boolean {
    if (!/^\s*DRAW\b/i.test(line)) return false;
    const match = /(?:^|\s)(?:obj|o)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/i.exec(line);
    if (!match) return false;
    const value = match[1].replace(/^["']|["']$/g, '');
    return value.split(',').some(item => item.trim() === name);
}

/**
 * 标签值怎么落进脚本。
 *
 * 标签可以带空格（`label=点 P`），也可以带 `#`。裸写的话解释器会把空格后面当成
 * 下一个参数、把 `#` 当成行尾注释，值就被吃掉了，所以这种值必须加引号。
 * 不含特殊字符时保持裸写 —— 和用户手写的风格一致，读起来也干净。
 */
function formatLabelValue(value: string): string {
    if (/[\s"']/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
    return value;
}

/**
 * 把对象的 `label` 属性写回脚本。
 *
 * 标签是**字符串**（可以写中文、写 `$LaTeX$`），所以不能走 PARAMETER_ALIASES（那张表只处理数值）：
 *   - 值为空：把 `label=` 整个删掉 —— 空标签就等于不显示；
 *   - 参数已存在：原地替换（保留用户原本写的是 `label` 还是 `l`）；
 *   - 参数不存在：补在行尾（行尾注释之前），否则会被当成注释内容而失效。
 *
 * 写哪一行由解释器给的行号决定：定义行写了 `draw=true` 就写定义行，否则写真正把
 * 对象画出来的 `DRAW obj=X` —— 写在没被读的那一行上等于没写。
 *
 * `l` 这个别名只在 `DRAW` 行上收：文档里 `DRAW` 的 `l` 明确是「标签文本」，但在
 * `CREATE PERPENDICULAR_FOOT` / `CREATE REGION` 的定义行上 `l` 是「线」的意思。
 * 所以定义行只认 `label`，否则改标签会把 `l=AB`（一条线）当成标签覆盖掉。
 *
 * 返回 null 表示脚本不需要变，调用方不要因此清空日志或重跑脚本。
 */
export function updateDslObjectLabel(
    script: string,
    name: string,
    value: string,
    options?: PropertySyncOptions,
): DslPropertyUpdate | null {
    if (!name) return null;

    const lines = script.split('\n');
    const { candidates } = collectCandidateLines(lines, name, options);
    const normalized = value.trim();

    for (const index of candidates) {
        const target = lines[index];
        if (isCommentLine(target)) continue;
        // 能挂标签的只有两种行：对象自己的定义行，或把它画出来的 DRAW 行。
        // 其它带 obj= 的指令（FILL / MEASURE）不渲染标签，写上去不会生效。
        const onDrawLine = isDrawLineForObject(target, name);
        if (!onDrawLine && !isObjectDefinitionLine(target, name)) continue;
        const aliases = onDrawLine ? LABEL_ALIASES : ['label'];

        if (!normalized) {
            const stripped = removeParameter(target, aliases);
            if (stripped === null || stripped === target) return null;
            lines[index] = stripped;
            return { script: lines.join('\n'), lineNumber: index + 1 };
        }

        const formatted = formatLabelValue(normalized);
        const next = replaceParameter(target, aliases, formatted)
            ?? appendParameter(target, 'label', formatted);
        if (next === target) return null;
        lines[index] = next;
        return { script: lines.join('\n'), lineNumber: index + 1 };
    }
    return null;
}

// frozen 只存在于 POINT 指令上。限定指令类型有两个作用：
//   1. 面板传错 name（比如 TEXT 恰好同名）时不会往别的指令上乱加参数；
//   2. 行号过期、指向了别的指令时直接放弃，而不是改坏一行。
function isPointDefinitionLine(line: string): boolean {
    return /^\s*(?:CREATE\s+)?POINT\b/i.test(line);
}

/**
 * 把 POINT 的 `frozen` 属性写回脚本。
 *
 * 这是布尔属性，不能走 PARAMETER_ALIASES（那张表只处理数值），所以单独实现：
 *   - 参数已存在：原地替换成 true / false；
 *   - 参数不存在且要冻结：补在行尾（行尾注释之前）；
 *   - 参数不存在且要解冻：本来就没冻结，返回 null 让调用方当作「无需改动」。
 *
 * 返回 null 表示脚本不需要变，调用方不要因此清空日志或重跑脚本。
 */
export function updateDslObjectFrozen(
    script: string,
    name: string,
    frozen: boolean,
    options?: PropertySyncOptions,
): DslPropertyUpdate | null {
    if (!name) return null;

    const lines = script.split('\n');
    const { candidates } = collectCandidateLines(lines, name, options);

    for (const index of candidates) {
        const target = lines[index];
        if (isCommentLine(target)) continue;
        if (!isPointDefinitionLine(target)) continue;
        if (!isObjectDefinitionLine(target, name)) continue;

        const replaced = replaceParameter(target, FROZEN_ALIASES, String(frozen));
        if (replaced !== null) {
            if (replaced === target) return null; // 值没变，不必重跑脚本
            lines[index] = replaced;
            return { script: lines.join('\n'), lineNumber: index + 1 };
        }
        if (!frozen) return null; // 没有 frozen= 本来就没冻结，解冻无需写代码
        lines[index] = appendParameter(target, 'frozen', 'true');
        return { script: lines.join('\n'), lineNumber: index + 1 };
    }
    return null;
}
