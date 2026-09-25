// 删除对象 / 把线性对象裁剪成线段。
//
// 这两件事都是**改写脚本**，不是「追加一条指令」。原因是渲染是即时进行的：
// `createPoint` 里创建完对象就立刻调 `drawObject` 画上去，画布是只增不减的。
// 所以追加一条 `DRAW obj=X` 只能再画一遍，擦不掉已经画上去的东西；
// 想让某个对象消失、或者让一条直线变短，唯一的办法是**让脚本本身不再那样创建它**。
//
// 于是这里的函数都是纯函数：输入「脚本 + 解释器解析好的顶层指令表」，输出新脚本。
// 不碰 DOM、不碰解释器状态，可以离线断言。
//
// 为什么不自己解析脚本：解释器里那套 `parseParameters` 是手写扫描器，
// 引号值、空值（`text= color=blue`）、值里带 `=`（`label=a=b`）、行尾注释
// （`color=#eeeeee` 里的 `#` 不算注释）都有讲究，再抄一份必然跑偏。
// 这里直接消费 `DSLInterpreter.getTopLevelCommands()` 给出的解析结果。

import type { TopLevelCommandInfo } from './DSLInterpreter';
import { isInsideQuotes } from './dslPropertySync';

/**
 * 「这个参数的值一定是对象名」的参数白名单。
 *
 * 必须是白名单，不能是「值恰好等于某个对象名」：`CREATE POINT name=P label=A`
 * 里的 `label=A` 只是标签文字，按值判定会把 A 当成 P 的依赖，删除 A 时连带删掉 P。
 * 白名单漏掉某个新参数时的代价是「依赖没算全」—— 后果是脚本里留一处悬空引用，
 * 重跑时解释器报一条错（用户看得见、可以再删一次），比静默删掉无关对象轻得多。
 */
const REFERENCE_PARAM_KEYS = new Set([
    // 点
    'p', 'p1', 'p2', 'p3', 'point', 'point1', 'point2', 'points',
    // 对象 / 线性对象
    'obj', 'obj1', 'obj2', 'object', 'o', 'o1', 'o2',
    'line', 'line1', 'line2', 'l', 'l1', 'l2',
    // 圆 / 曲线 / 函数 / 点集
    'circle', 'curve', 'curve1', 'f1', 'f2', 'func', 'sets', 'pointsets',
    // 其余引用型参数
    'boundary', 'axis', 'from', 'on', 'center', 'vertex', 'start', 'end',
    'chord', 'chordpt1', 'chordpt2', 'region',
    // 直线/射线的截止点数组
    'cutpoints', 'cutoffpoints', 'cuts',
]);

/** 会「创建对象」的指令。只有这些指令上的 `name=` 才算定义，其余 `name=` 一律不碰。 */
const OBJECT_DEFINING_COMMANDS = new Set([
    'POINT', 'LINE', 'SEGMENT', 'RAY', 'MIDPOINT', 'PERPENDICULAR_FOOT',
    'REFLECTED_POINT', 'ROTATED_POINT', 'INTERSECT',
    'POINT_ON_LINE', 'POINT_ON_CIRCLE', 'PERP_BISECTOR', 'PERPENDICULAR', 'PARALLEL',
    'ANGLE_BISECTOR', 'CIRCUMCIRCLE', 'INCIRCLE', 'TANGENT', 'POLYGON', 'CIRCLE_CENTER',
    'POINTSET', 'REGION', 'TRIANGLE', 'RECTANGLE', 'CIRCLE', 'ELLIPSE',
    'PARABOLA', 'HYPERBOLA', 'ANGLE', 'FOCIS', 'CURVE', 'RANDOMPOINT', 'TEXT',
]);

/**
 * 可以被裁剪的线性对象指令。
 *
 * 除了直接定义的 LINE/SEGMENT/RAY，还包括派生线：中垂线、垂线、平行线、角平分线
 * 生成的都是 `Line`，只是它们的两个定义点是内部合成点（`name_<mid>` 之类），
 * DSL 里引用不到，所以裁剪只能靠「带方向的截止点」，不能靠交换定义点。
 */
const LINEAR_DEFINING_COMMANDS = new Set([
    'LINE', 'SEGMENT', 'RAY',
    'PERP_BISECTOR', 'PERPENDICULAR', 'PARALLEL', 'ANGLE_BISECTOR',
]);

/** 去掉截止点的方向前缀（`+A` / `-A` → `A`），用来判断「是不是同一个点」。 */
function normalizeCutToken(token: string): string {
    return token.trim().replace(/^[+-]\s*/, '');
}

/** 这条指令定义了哪些对象名。`name=A,B` 这种一条建多个的要拆开。 */
export function definedNamesOf(command: TopLevelCommandInfo): string[] {
    if (!OBJECT_DEFINING_COMMANDS.has(command.command)) return [];
    const raw = command.params.get('name') ?? command.params.get('n') ?? command.params.get('id');
    if (!raw) return [];
    return raw.split(',').map(part => part.trim()).filter(Boolean);
}

/** 这条指令引用了哪些对象名（只看白名单参数，且排除它自己定义的名字）。 */
export function referencedNamesOf(command: TopLevelCommandInfo): string[] {
    const own = new Set(definedNamesOf(command));
    const found = new Set<string>();
    command.params.forEach((value, key) => {
        if (!REFERENCE_PARAM_KEYS.has(key.toLowerCase())) return;
        const isCutPoints = key.toLowerCase() === 'cutpoints'
            || key.toLowerCase() === 'cutoffpoints'
            || key.toLowerCase() === 'cuts';
        for (const part of value.split(',')) {
            // `cutPoints=-A,+B` 里的 `-A` / `+B` 指的是对象 A / B，方向前缀不算名字的一部分。
            const name = isCutPoints ? normalizeCutToken(part) : part.trim();
            if (!name || own.has(name)) continue;
            found.add(name);
        }
    });
    return Array.from(found);
}

/**
 * 算出「删掉这些对象」实际要连带删掉哪些对象。
 *
 * 删掉 A 之后，任何 `p1=A` / `obj=A` 的定义都会失效（解释器会报 "not found"），
 * 所以依赖者必须一起删。这里做的是传递闭包：A 的依赖者如果又被别人依赖，那些也要删。
 *
 * 返回顺序是「先目标、后依赖」的 BFS 顺序，方便 UI 直接展示。
 */
export function collectDeletionClosure(
    commands: ReadonlyArray<TopLevelCommandInfo>,
    names: readonly string[],
): string[] {
    // 被引用者 -> 引用它的对象
    const dependents = new Map<string, Set<string>>();
    for (const command of commands) {
        const owners = definedNamesOf(command);
        if (owners.length === 0) continue;
        for (const target of referencedNamesOf(command)) {
            let bucket = dependents.get(target);
            if (!bucket) {
                bucket = new Set();
                dependents.set(target, bucket);
            }
            for (const owner of owners) bucket.add(owner);
        }
    }

    const closure = new Set<string>();
    const queue: string[] = [];
    for (const name of names) {
        const trimmed = name?.trim();
        if (!trimmed || closure.has(trimmed)) continue;
        closure.add(trimmed);
        queue.push(trimmed);
    }
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const dependent of dependents.get(current) ?? []) {
            if (closure.has(dependent)) continue;
            closure.add(dependent);
            queue.push(dependent);
        }
    }
    return Array.from(closure);
}

export interface ObjectDeletionPlan {
    /** 目标对象 + 全部依赖者。 */
    names: string[];
    /** 不能删除时的原因；可以删除时为空。 */
    blocked?: string;
}

/**
 * 删除前的预检：算出连带删除的闭包，并判断这次删除能不能安全落地。
 *
 * 右键菜单拿它来显示「删除 A（含 N 个依赖对象）」，并在不能删时置灰 + 给出原因，
 * 所以必须在用户点下去之前就能算出来。
 */
export function planObjectDeletion(
    commands: ReadonlyArray<TopLevelCommandInfo>,
    names: readonly string[],
): ObjectDeletionPlan {
    const closure = collectDeletionClosure(commands, names);

    for (const name of closure) {
        // 同名对象可能有多条定义（连续裁剪会留下「历史」定义），所以要把每条都查一遍。
        const definitions = commands.filter(command => definedNamesOf(command).includes(name));
        if (definitions.length === 0) {
            return {
                names: closure,
                blocked: `「${name}」在脚本顶层找不到创建它的指令（可能来自 CODE 块或动画），无法删除`,
            };
        }
        for (const definition of definitions) {
            // `CREATE INTERSECT name=A,B ...` 一条指令建两个对象：只删其中一个就得把这行拆开，
            // 而交点的名字是按位置分配的（names[0] / names[1]），拆了会错位，所以直接拒绝。
            const owners = definedNamesOf(definition);
            if (owners.length > 1 && !owners.every(owner => closure.includes(owner))) {
                const survivors = owners.filter(owner => !closure.includes(owner));
                return {
                    names: closure,
                    blocked: `「${name}」与「${survivors.join('、')}」由同一条指令创建，无法只删除其中一个`,
                };
            }
        }
    }

    return { names: closure };
}

export interface ObjectDeletionResult {
    script: string;
    /** 实际删掉的对象名。 */
    removed: string[];
    /** 顺带清掉的指令行数（DRAW / FILL / MEASURE 这类引用已删对象的行）。 */
    droppedCommandLines: number;
}

/**
 * 把对象从脚本里删掉。
 *
 * 要删两类行：
 *   1. 目标对象自己的定义行；
 *   2. 引用已删对象、但不创建对象的指令行（`DRAW obj=X`、`FILL obj=X`、`MEASURE p1=X`…）——
 *      留着它们会让解释器报「对象不存在」。
 *
 * 返回 null 表示这次改写落不了地（调用方当作无操作，并把 planObjectDeletion 的 blocked 展示给用户）。
 */
export function removeObjectsFromScript(
    script: string,
    commands: ReadonlyArray<TopLevelCommandInfo>,
    names: readonly string[],
): ObjectDeletionResult | null {
    const plan = planObjectDeletion(commands, names);
    if (plan.blocked || plan.names.length === 0) return null;
    const targets = new Set(plan.names);

    const lines = script.split('\n');
    const dropIndices = new Set<number>();
    const removed = new Set<string>();
    let droppedCommandLines = 0;

    for (const command of commands) {
        const owners = definedNamesOf(command);
        const index = command.lineNumber - 1;
        if (index < 0 || index >= lines.length) return null;
        // 跨行引号值 / 行末续行会让「删掉这一行」变成删掉半条指令，直接放弃。
        if (!isSingleLineCommand(lines[index])) return null;

        if (owners.length > 0 && owners.some(owner => targets.has(owner))) {
            // 一条指令建多个对象时，planObjectDeletion 已经确认它们会被一起删掉。
            if (!owners.every(owner => targets.has(owner))) return null;
            dropIndices.add(index);
            for (const owner of owners) removed.add(owner);
            continue;
        }

        // 不建对象、但引用了已删对象的指令（DRAW / FILL / MEASURE…）：整行清掉。
        if (owners.length === 0 && referencedNamesOf(command).some(name => targets.has(name))) {
            dropIndices.add(index);
            droppedCommandLines++;
        }
    }

    if (removed.size === 0) return null;

    const kept = lines.filter((_, index) => !dropIndices.has(index));
    return {
        script: kept.join('\n'),
        removed: Array.from(removed),
        droppedCommandLines,
    };
}

/** 这一行是不是一条「完整」的指令（没有跨行引号、也没有行末续行）。 */
function isSingleLineCommand(line: string): boolean {
    if (line.endsWith('\\')) return false;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "'" && !inDouble) inSingle = !inSingle;
    }
    return !inSingle && !inDouble;
}

export interface LinearTrimResultObject {
    /** 仍然沿用原对象名；不再生成替代对象。 */
    name: string;
    /** 原对象类型，截止点算法支持三种线性对象。 */
    resultType: 'line' | 'segment' | 'ray';
    /**
     * 线段是起点，射线是顶点。
     *
     * 只作说明用途：带方向的截止点已经能删掉任意一侧，定义点不再被改写
     * （派生线的定义点是内部合成点，也改不了）。
     */
    keepP1: string;
    /** 线段是终点，射线是方向点。同上，不再写回脚本。 */
    keepP2: string;
}

export interface LinearTrimRewrite {
    /** 被截取的原对象名。 */
    name: string;
    /** 截止点算法一次只更新原对象，不创建多个结果。 */
    results: readonly LinearTrimResultObject[];
    /**
     * 写入原定义的截止点数组，带方向前缀：`+A` 隐藏 A 的正方向一侧，`-A` 隐藏负方向一侧。
     * 必须存在，即使本次数组为空也表示新算法路径。
     */
    cutPointNames?: readonly string[];
    /**
     * 需要先追加到脚本末尾的指令。
     *
     * 鼠标停在无界尾部时会在这里生成一个边界点（`MEASURE` + `POINT_ON_LINE`），
     * 这些指令必须比「改写原定义行」先落地，否则截取写回时引用的点名还不存在。
     */
    preludeCommands?: readonly string[];
}

/** 把参数值换成新值（跳过引号内的同名片段）。 */
function replaceParamValue(line: string, key: string, value: string): string {
    const pattern = new RegExp("(\\b" + key + "\\s*=\\s*)(\"[^\"]*\"|'[^']*'|[^\\s]+)", 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
        if (isInsideQuotes(line, match.index)) {
            pattern.lastIndex = match.index + 1;
            continue;
        }
        return line.slice(0, match.index) + match[1] + value + line.slice(match.index + match[0].length);
    }
    return line;
}

/** 找行尾注释的起点，忽略颜色值里的 # 和引号里的内容。 */
function findCommentStart(line: string): number {
    let quote: 'single' | 'double' | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = null;
            if (ch === '\\') i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch === '"' ? 'double' : 'single';
            continue;
        }
        if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
    }
    return line.length;
}

/** 替换已有参数；没有时插在行尾注释之前。 */
function upsertParamValue(line: string, key: string, value: string): string {
    const replaced = replaceParamValue(line, key, value);
    if (replaced !== line) return replaced;
    const commentStart = findCommentStart(line);
    const before = line.slice(0, commentStart).trimEnd();
    const comment = line.slice(commentStart);
    return before + ' ' + key + '=' + value + (comment ? ' ' + comment : '');
}

/**
 * 把线性对象的定义改写成截止点数组。
 *
 * 这是唯一的线性裁剪写回路径：只修改原来的创建行（LINE/SEGMENT/RAY 以及
 * PERP_BISECTOR/PERPENDICULAR/PARALLEL/ANGLE_BISECTOR 这些派生线），
 * 不中和原对象、不删除 DRAW、不追加背景色遮罩，也不创建替代对象。
 *
 * 写入的截止点带方向（`+A` 砍正方向一侧、`-A` 砍负方向一侧），因此**不需要**
 * 交换定义点就能删掉任意一侧 —— 派生线的定义点是内部合成点，本来就交换不了。
 * cutPoints 由解释器解析为对真实 Point 对象的引用，所以截止点移动后，
 * 原线的可见区间也会随脚本重绘同步移动。
 */
export function rewriteLinearDefinition(
    script: string,
    commands: ReadonlyArray<TopLevelCommandInfo>,
    rewrite: LinearTrimRewrite,
): string | null {
    if (rewrite.results.length !== 1 || rewrite.cutPointNames === undefined) return null;

    // 同名定义以后者为生效对象，连续编辑时应更新最后一条定义。
    let definition: TopLevelCommandInfo | null = null;
    for (const command of commands) {
        if (definedNamesOf(command).includes(rewrite.name)) definition = command;
    }
    if (!definition || !LINEAR_DEFINING_COMMANDS.has(definition.command)) return null;
    if (definedNamesOf(definition).length !== 1) return null;

    const lines = script.split('\n');
    const definitionIndex = definition.lineNumber - 1;
    if (definitionIndex < 0 || definitionIndex >= lines.length) return null;
    if (!isSingleLineCommand(lines[definitionIndex])) return null;

    // 新算法不重建对象、也不改定义点，所以只校验「结果类型和原定义类型一致」，
    // 防止把一条射线写成 line 之类的错配。
    const expectedType = definition.command === 'RAY'
        ? 'ray'
        : definition.command === 'SEGMENT' ? 'segment' : 'line';
    if (rewrite.results[0].resultType !== expectedType) return null;

    const previousCuts = [
        definition.params.get('cutPoints'),
        definition.params.get('cutoffPoints'),
        definition.params.get('cuts'),
    ]
        .filter((value): value is string => value !== undefined)
        .flatMap(value => value.split(','));

    // 同一个点只保留最后一次写入的方向：连续裁剪时后一次操作应该覆盖前一次对它的设定，
    // 否则 `+A,-B` 之后再删右尾会写出 `+A,-B,+B`，两个方向互相抵消、整条线直接消失。
    const seen = new Set<string>();
    const orderedCuts: string[] = [];
    for (const token of [...previousCuts, ...rewrite.cutPointNames].reverse()) {
        const trimmed = token.trim();
        if (!trimmed) continue;
        const key = normalizeCutToken(trimmed);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        orderedCuts.unshift(trimmed);
    }
    if (orderedCuts.length === 0) return null;

    // 用户可能写的是 cutoffPoints / cuts，原地改那一个，别留下两份互相打架的参数。
    const value = orderedCuts.join(',');
    let line = lines[definitionIndex];
    for (const alias of ['cutPoints', 'cutoffPoints', 'cuts']) {
        const replaced = replaceParamValue(line, alias, value);
        if (replaced !== line) {
            line = replaced;
            break;
        }
    }
    if (line === lines[definitionIndex]) {
        line = upsertParamValue(line, 'cutPoints', value);
    }
    if (line === lines[definitionIndex]) return null;

    const rewritten = [...lines];
    rewritten[definitionIndex] = line;

    // 「在鼠标处生成截点」的情形：先把这个新点的指令追加到脚本末尾。
    // 追加而不是插在原定义行之前，是为了不改动任何已有行号 —— 调用方（和其他
    // cutPoints 写回路径）都按行号定位，插行会让它们全部错位。
    // 新点在定义行之后才创建，但脚本是整体重跑、解释器一次执行完，引用不会落空。
    if (rewrite.preludeCommands && rewrite.preludeCommands.length > 0) {
        rewritten.push(...rewrite.preludeCommands);
    }

    return rewritten.join('\n');
}
