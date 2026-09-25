/**
 * 脚本撤销 / 重做历史（纯逻辑，不依赖 React，也不碰编辑器实例）。
 *
 * 为什么一个统一的栈就够了：
 * 这个应用里「用户的操作」几乎全部最终落成对脚本文本的一次改写 —— 打字、属性面板改数值、
 * 冻结/解冻点、删除对象、截取直线、右键作图追加指令、在画布上拖动点…… 改完脚本再重跑，
 * 画布、变量面板、SVG 导出都从同一份脚本派生。所以只要把「脚本 + 已渲染脚本」这一对快照
 * 按顺序存起来，就覆盖了全部操作，不需要给每种操作各写一套撤销。
 *
 * 快照为什么同时记 `script` 与 `generatedScript`：
 * 这两者会**合法地分叉** —— 用户改了脚本但还没点 Execute 时，画布渲染的仍是上一版。
 * 撤销必须精确回到当时那一对值，而不是「顺便把没执行的改动也执行掉」。
 *
 * 深度不设上限（用户要求「无限次」）。脚本是几 KB 的文本，历史几百步也只是几 MB，
 * 没必要为它做淘汰；真要限制反而会出现「撤销到一半突然没得撤了」这种难解释的行为。
 */

/** 一次可撤销的状态：编辑器里的脚本，以及当前画布实际渲染的那份脚本。 */
export interface ScriptSnapshot {
    /** 编辑器里的文本。 */
    script: string;
    /** 画布当前渲染的文本（点 Execute 或任何改写脚本的操作会把它同步成 script）。 */
    generatedScript: string;
}

export interface ScriptHistoryState {
    /** 可以回退到的历史状态，栈顶是「上一步」。 */
    past: ScriptSnapshot[];
    /** 撤销后可以再前进的状态，栈首是「下一步」。 */
    future: ScriptSnapshot[];
    /**
     * 上一条记录用的合并键。连续打字要合并成一步，靠它识别「还是同一段输入」。
     * `null` 表示上一条不是可合并的改动。
     */
    lastKey: string | null;
    /** 上一条记录的写入时间，用来判断这次改动是否还落在同一个输入段里。 */
    lastTime: number;
    /** 当前输入段的起始时间。 */
    groupStart: number;
}

/** 连续输入：相邻两次改动间隔小于这个值就并入同一步。 */
export const COALESCE_WINDOW_MS = 600;
/**
 * 一段输入最多合并这么久。
 * 不设上限的话，一直不停地打字会让整场输入塌成一步，一次 Ctrl+Z 抹掉几百个字符。
 */
export const COALESCE_MAX_MS = 2500;

/** 打字的合并键。非打字的改动（删除、截取、改属性……）一律传 `null`，各占一步。 */
export const TYPING_COALESCE_KEY = 'typing';

export function createHistory(): ScriptHistoryState {
    return { past: [], future: [], lastKey: null, lastTime: 0, groupStart: 0 };
}

/**
 * 记录一次改动：把改动**之前**的快照压入 `past`。
 *
 * `coalesceKey` 非空且与上一条相同、且还在时间窗内时**不压栈** ——
 * 因为这一段输入的第一个快照已经在栈顶了，再压就把一次连续输入拆成好几步。
 *
 * 任何新改动都会清空 `future`：这是撤销栈的标准语义，改了新东西之后旧的「重做」路径就作废了。
 */
export function recordHistory(
    state: ScriptHistoryState,
    previous: ScriptSnapshot,
    options: { coalesceKey?: string | null; now: number },
): ScriptHistoryState {
    const key = options.coalesceKey ?? null;
    const now = options.now;

    const continuing =
        key !== null &&
        state.lastKey === key &&
        now - state.lastTime <= COALESCE_WINDOW_MS &&
        now - state.groupStart <= COALESCE_MAX_MS;

    if (continuing) {
        // 只推进时间戳，不压栈 —— 这一段输入的起点已经在 past 栈顶。
        return { ...state, lastTime: now };
    }

    return {
        past: [...state.past, previous],
        future: [],
        lastKey: key,
        lastTime: now,
        groupStart: now,
    };
}

/**
 * 撤销：弹出栈顶作为新状态，把当前状态推进 `future`。
 * 栈空时返回 `null`，调用方当作无操作。
 *
 * 撤销后必须**打断合并**（把 `lastKey` 置空）：否则撤销完再打字会被并进撤销前那一段，
 * 一次 Ctrl+Z 会把撤销后新输入的内容一起带走。
 */
export function undoHistory(
    state: ScriptHistoryState,
    present: ScriptSnapshot,
): { state: ScriptHistoryState; restored: ScriptSnapshot } | null {
    if (state.past.length === 0) return null;

    return {
        state: {
            past: state.past.slice(0, -1),
            future: [present, ...state.future],
            lastKey: null,
            lastTime: 0,
            groupStart: 0,
        },
        restored: state.past[state.past.length - 1],
    };
}

/** 重做：撤销的逆操作。`future` 为空时返回 `null`。 */
export function redoHistory(
    state: ScriptHistoryState,
    present: ScriptSnapshot,
): { state: ScriptHistoryState; restored: ScriptSnapshot } | null {
    if (state.future.length === 0) return null;

    return {
        state: {
            past: [...state.past, present],
            future: state.future.slice(1),
            lastKey: null,
            lastTime: 0,
            groupStart: 0,
        },
        restored: state.future[0],
    };
}

export function canUndo(state: ScriptHistoryState): boolean {
    return state.past.length > 0;
}

export function canRedo(state: ScriptHistoryState): boolean {
    return state.future.length > 0;
}
